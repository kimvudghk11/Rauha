import { describe, expect, it } from 'vitest';
import { RoleSettingsDto, type MemberRole } from '../../orchestration/application/dto/role-settings.dto.js';
import type { MemberCall, MemberResult } from '../../orchestration/application/ports.js';
import { DesignService, type DesignApproval, type DesignUserPort } from './design.service.js';

const usage = { model: 'sonnet', durationMs: 1, costUsd: 0.01, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' } as const;
const ask = (question: string, suggestion: string | null = null) => ({ status: 'ask', question, suggestion, design: null });
const draft = (title = '쿠폰 할인') => ({
  status: 'draft',
  question: null,
  suggestion: null,
  design: {
    title,
    purpose: '쿠폰 적용',
    goals: ['g'],
    nonGoals: [],
    scenarios: [{ given: '10,000원', when: '10% 쿠폰', then: '9,000원' }],
    decisions: [{ what: '원 미만 버림', by: 'rauha' }],
    tasks: [{ id: 't1', title: 'Coupon', scope: ['src/**'], acceptance: ['10%면 9,000원'], dependsOn: [] }],
    risks: [],
    architecture: { overview: 'Coupon 값 객체', components: [{ name: 'Coupon', responsibility: '할인 계산', location: 'src/coupon.ts' }], flow: [], alternatives: [] },
    edgeCases: [{ case: '할인율 0%', handling: '거절', task: 't1' }],
  },
});

class FakeDesigner {
  readonly calls: MemberCall[] = [];
  constructor(private readonly replies: unknown[], private readonly blockedAt: number | null = null) {}
  async run(call: MemberCall): Promise<MemberResult> {
    this.calls.push(call);
    if (this.blockedAt === this.calls.length) return { output: null, error: 'limit', fetched: [], usage, blocked: { reason: 'usage-limit', message: "You've hit your session limit" } };
    return { output: this.replies.length > 1 ? this.replies.shift() : this.replies[0], error: null, fetched: [], usage };
  }
}

function user(script: { answers?: (string | null)[]; approvals?: DesignApproval[] }) {
  const asked: { question: string; suggestion: string | null; round: number }[] = [];
  const shown: { title: string; summary: readonly string[]; path: string }[] = [];
  const port: DesignUserPort = {
    discuss: async (q) => {
      asked.push(q);
      return script.answers?.shift() ?? null;
    },
    approve: async (plan) => {
      shown.push(plan);
      return script.approvals?.shift() ?? { kind: 'cancel' };
    },
  };
  return { port, asked, shown };
}

function service(designer: FakeDesigner, u: DesignUserPort, saved: { name: string; markdown: string }[] = []) {
  return new DesignService({
    team: designer,
    roles: RoleSettingsDto.defaults(),
    user: u,
    store: { save: async (name, markdown) => (saved.push({ name, markdown }), `C:/designs/${name}`) },
    progress: { step: (_m: string, _r?: MemberRole) => undefined },
    today: () => '2026-10-29',
  });
}

const input = { request: '쿠폰 기능 만들어줘', repo: 'shop-api', knowledge: '<repo_knowledge/>', memory: null, conversation: null, basis: 'main (a1b2c3d)' };

describe('DesignService', () => {
  it('요청이 분명하면 묻지 않고 바로 설계안을 만들어 승인받는다', async () => {
    const designer = new FakeDesigner([draft()]);
    const u = user({ approvals: [{ kind: 'approve' }] });
    const saved: { name: string; markdown: string }[] = [];
    const result = await service(designer, u.port, saved).run(input);
    expect(result).toMatchObject({ kind: 'approved', path: expect.stringContaining('C:/designs/') });
    expect(u.asked).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.markdown).toContain('# 쿠폰 할인');
    expect(saved[0]!.markdown).toContain('main (a1b2c3d)');
    expect(u.shown[0]!.summary.join('\n')).toContain('쿠폰 할인');
  });

  it('한 번에 질문 하나씩 묻고, 답을 쌓아 다음 호출에 넘긴다', async () => {
    const designer = new FakeDesigner([ask('쿠폰은 중복 사용이 되나요?', '주문당 1개'), ask('만료일이 있나요?'), draft()]);
    const u = user({ answers: ['안 돼요', '네, 30일'], approvals: [{ kind: 'approve' }] });
    await service(designer, u.port).run(input);
    expect(u.asked.map((q) => q.question)).toEqual(['쿠폰은 중복 사용이 되나요?', '만료일이 있나요?']);
    expect(u.asked[0]).toMatchObject({ suggestion: '주문당 1개', round: 1 });
    const last = designer.calls.at(-1)!.userMessage;
    expect(last).toContain('쿠폰은 중복 사용이 되나요?');
    expect(last).toContain('안 돼요');
    expect(last).toContain('네, 30일');
  });

  it('"알아서 해"라고 답하면 추천값으로 정했다고 기록해 넘긴다', async () => {
    const designer = new FakeDesigner([ask('만료일이 있나요?', '30일'), draft()]);
    await service(designer, user({ answers: ['알아서 해'], approvals: [{ kind: 'approve' }] }).port).run(input);
    expect(designer.calls.at(-1)!.userMessage).toContain('rauha가 추천값으로 정함: 30일');
  });

  it('질문이 8번을 넘으면 더 묻지 말고 설계안을 쓰라고 한다', async () => {
    const designer = new FakeDesigner([ask('질문'), ask('질문'), ask('질문'), ask('질문'), ask('질문'), ask('질문'), ask('질문'), ask('질문'), draft()]);
    const u = user({ answers: Array.from({ length: 8 }, () => '네'), approvals: [{ kind: 'approve' }] });
    await service(designer, u.port).run(input);
    expect(u.asked).toHaveLength(8);
    expect(designer.calls.at(-1)!.userMessage).toContain('더 묻지 말고');
  });

  it('질문에 답하지 않고 그만두면 설계를 멈춘다', async () => {
    const designer = new FakeDesigner([ask('만료일이 있나요?')]);
    const result = await service(designer, user({ answers: [null] }).port).run(input);
    expect(result.kind).toBe('cancelled');
  });

  it('고칠 점을 말하면 그 말과 지난 설계안을 넘겨 다시 쓰고, 승인되면 끝낸다', async () => {
    const designer = new FakeDesigner([draft('쿠폰 할인'), draft('쿠폰 할인 v2')]);
    const u = user({ approvals: [{ kind: 'revise', note: '만료일도 넣어 주세요' }, { kind: 'approve' }] });
    const saved: { name: string; markdown: string }[] = [];
    const result = await service(designer, u.port, saved).run(input);
    expect(result).toMatchObject({ kind: 'approved' });
    expect(designer.calls.at(-1)!.userMessage).toContain('만료일도 넣어 주세요');
    expect(designer.calls.at(-1)!.userMessage).toContain('# 쿠폰 할인');
    expect(saved).toHaveLength(2);
    if (result.kind === 'approved') expect(result.design.title).toBe('쿠폰 할인 v2');
  });

  it('승인 화면에서 그만두면 작업하지 않는다', async () => {
    const result = await service(new FakeDesigner([draft()]), user({ approvals: [{ kind: 'cancel' }] }).port).run(input);
    expect(result.kind).toBe('cancelled');
  });

  it('고쳐 달라는 요청이 다섯 번을 넘으면 멈춘다', async () => {
    const approvals: DesignApproval[] = Array.from({ length: 6 }, () => ({ kind: 'revise', note: '또 고쳐' }));
    const result = await service(new FakeDesigner([draft()]), user({ approvals }).port).run(input);
    expect(result.kind).toBe('cancelled');
  });

  it('설계안이 규칙을 어기면(순환 의존 등) 이유를 알려 한 번 다시 쓰게 하고, 또 어기면 실패로 알린다', async () => {
    const bad = { ...draft(), design: { ...draft().design, tasks: [{ id: 't1', title: 'a', scope: ['a'], acceptance: ['a'], dependsOn: ['t1'] }] } };
    const designer = new FakeDesigner([bad]);
    const result = await service(designer, user({}).port).run(input);
    expect(result.kind).toBe('failed');
    expect(designer.calls).toHaveLength(2);
    expect(designer.calls[1]!.userMessage).toContain('자기 자신에 의존');
  });

  it('구독 한도나 로그인 문제로 막히면 그대로 알린다', async () => {
    const result = await service(new FakeDesigner([draft()], 1), user({}).port).run(input);
    expect(result).toMatchObject({ kind: 'blocked', block: { reason: 'usage-limit' } });
  });

  it('설계 팀원은 지식·기억·앞 대화를 받고 읽기만 한다', async () => {
    const designer = new FakeDesigner([draft()]);
    await service(designer, user({ approvals: [{ kind: 'approve' }] }).port).run({ ...input, memory: '<memory>지난 결정</memory>', conversation: '- 사용자: 안녕' });
    const call = designer.calls[0]!;
    expect(call.role).toBe('designer');
    expect(call.userMessage).toContain('<repo_knowledge/>');
    expect(call.userMessage).toContain('지난 결정');
    expect(call.userMessage).toContain('<request>');
    expect(call.canWrite('src/a.ts')).toBe(false);
  });

  it('쓴 비용과 호출 수를 알려 준다', async () => {
    const result = await service(new FakeDesigner([draft()]), user({ approvals: [{ kind: 'approve' }] }).port).run(input);
    expect(result.cost.calls).toBe(1);
    expect(result.cost.costUsd).toBeCloseTo(0.01);
  });
});
