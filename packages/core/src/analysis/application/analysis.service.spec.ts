import { describe, expect, it } from 'vitest';
import { RoleSettingsDto } from '../../orchestration/application/dto/role-settings.dto.js';
import type { MemberCall, MemberResult } from '../../orchestration/application/ports.js';
import { SessionBudget } from '../../orchestration/domain/session-budget.js';
import { DomainError } from '../../shared/domain-error.js';
import { AnalysisService, ASK_WAIT_MS, type AnalysisServiceDeps } from './analysis.service.js';
import type { AnalysisDocsPort, AnalysisInput, AnalysisUserPort, ApprovalCard, ApprovalReply, DirectionCard, DirectionReply } from './ports.js';

const usage = { model: 'sonnet', durationMs: 1, costUsd: 0.01, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' } as const;
const ok = (output: unknown): MemberResult => ({ output, error: null, fetched: [], usage });
const blocked = (reason: 'usage-limit' | 'login' | 'cancelled' = 'usage-limit'): MemberResult => ({ output: null, error: 'x', fetched: [], usage, blocked: { reason, message: reason === 'usage-limit' ? "You've hit your session limit" : '멈춤' } });

const investigationOut = (path = 'packages/api/src/pay/retry.ts:42') => ({
  symptom: '결제가 두 번 깎인다',
  facts: [{ text: '재시도가 같은 번호로 승인을 다시 부른다', evidence: path }],
  causes: [{ text: '멱등 키가 없다', confidence: 'high', check: '로그를 본다' }],
  unknowns: [],
});
const directionsOut = {
  options: [
    { id: 'a', title: '멱등 키', summary: '키를 붙인다', pros: ['단순'], cons: [], risk: '호출부 변경', reversibility: 'easy', touches: [] },
    { id: 'b', title: '락', summary: '락을 건다', pros: [], cons: ['느림'], risk: '교착', reversibility: 'medium', touches: [] },
  ],
  recommendedId: 'a',
  recommendedReason: '되돌리기 쉽다',
};
const blueprintOut = {
  goal: '한 번만 결제',
  nonGoals: [],
  changes: [{ where: 'packages/api/src/pay', what: '키' }],
  flow: [],
  edgeCases: ['동시에 두 번 요청'],
  rejected: [],
  testStrategy: '가짜 PG',
  steps: [{ title: '키 값 객체', testFirst: '같은 키는 한 번', files: ['packages/api/src/pay/key.ts'], verify: 'yarn test' }],
  risks: [],
};

class FakeTeam {
  readonly calls: MemberCall[] = [];
  constructor(private readonly script: (MemberResult | unknown)[]) {}
  async run(call: MemberCall): Promise<MemberResult> {
    this.calls.push(call);
    const next = this.script.shift();
    if (next === undefined) throw new Error('예상보다 많이 불렀어요');
    return typeof next === 'object' && next !== null && 'usage' in next && 'fetched' in next ? (next as MemberResult) : ok(next);
  }
}

class FakeDocs implements AnalysisDocsPort {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  failCreate = false;
  async create(where: { date: string; topic: string }, markdown: string): Promise<string> {
    if (this.failCreate) throw new DomainError('IO', '디스크가 가득 찼어요');
    const path = `docs/analysis/${where.date}-test.md`;
    this.files.set(path, markdown);
    this.writes.push('create');
    return path;
  }
  async update(path: string, _runId: string, markdown: string): Promise<void> {
    this.files.set(path, markdown);
    this.writes.push('update');
  }
}

/** 카드에 정해 둔 답을 한다. 답이 없으면 카드를 닫을 때까지(abort) 기다린 뒤 stop으로 답한다(실제 화면 어댑터와 같다). */
function fakeUser(script: { directions?: DirectionReply[]; decisions?: ApprovalReply[] }) {
  const cards = { directions: [] as DirectionCard[], approvals: [] as ApprovalCard[] };
  const closed: boolean[] = [];
  const hang = (signal: AbortSignal) =>
    new Promise<{ kind: 'stop' }>((resolve) => {
      signal.addEventListener('abort', () => {
        closed.push(true);
        resolve({ kind: 'stop' });
      });
    });
  const port: AnalysisUserPort = {
    chooseDirection: (card, signal) => {
      cards.directions.push(card);
      const reply = script.directions?.shift();
      return reply === undefined ? hang(signal) : Promise.resolve(reply);
    },
    decide: (card, signal) => {
      cards.approvals.push(card);
      const reply = script.decisions?.shift();
      return reply === undefined ? hang(signal) : Promise.resolve(reply);
    },
  };
  return { port, cards, closed };
}

const never = () => ({ expired: new Promise<void>(() => undefined), cancel: () => undefined });
const input = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  request: '결제가 왜 두 번 깎여?',
  role: 'debugger',
  reach: 'plan',
  routedFeature: false,
  repos: 1,
  repo: 'shop-api',
  knowledge: '<repo_knowledge/>',
  memory: null,
  conversation: null,
  workspace: '',
  basis: 'main (a1b2c3d)',
  ...over,
});

function service(team: FakeTeam, docs: FakeDocs, over: Partial<AnalysisServiceDeps> = {}) {
  let n = 0;
  return new AnalysisService({
    team,
    roles: RoleSettingsDto.defaults(),
    docs,
    progress: { step: () => undefined },
    today: () => '2026-11-08',
    newId: () => `run-${(n += 1)}`,
    timer: never,
    ...over,
  });
}

const full = () => [investigationOut(), directionsOut, blueprintOut];

describe('AnalysisService', () => {
  it('조사 → 방향 비교 → 방향 고르기 → 설계·계획 → 승인까지 가면 작업 루프에 넘길 계획이 나온다', async () => {
    const team = new FakeTeam(full());
    const docs = new FakeDocs();
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'proceed' }] });
    const result = await service(team, docs, { user: user.port }).run(input());

    expect(team.calls.map((c) => c.role)).toEqual(['debugger', 'debugger', 'designer']);
    expect(result.run.next()).toBe('done');
    expect(result.brief).not.toBeNull();
    expect(result.brief!.block).toContain('<design');
    expect(result.brief!.block).toContain('고른 방향: 멱등 키');
    expect(result.brief!.block).toContain('먼저 쓸 테스트: 같은 키는 한 번');
    expect(result.brief!.request).toContain('한 번만 결제');
    expect(result.path).toBe('docs/analysis/2026-11-08-test.md');
    expect(result.summary).toContain('문서: docs/analysis/2026-11-08-test.md');
  });

  it('문서에 단계마다 이어 써서 조사·방향 비교·설계·계획이 한 파일에 남는다', async () => {
    const docs = new FakeDocs();
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'proceed' }] });
    await service(new FakeTeam(full()), docs, { user: user.port }).run(input());
    const md = docs.files.get('docs/analysis/2026-11-08-test.md')!;
    expect(md.startsWith('<!-- rauha-analysis:run-1 -->')).toBe(true);
    for (const heading of ['## 1. 조사', '## 2. 방향 비교', '## 3. 설계', '## 4. 단계별 계획']) expect(md).toContain(heading);
    expect(md).toContain('- AI 추천: 멱등 키');
    expect(md).toContain('내 선택: 멱등 키 (AI 추천과 같아요)');
    expect(docs.writes[0]).toBe('create');
    expect(docs.writes.slice(1).every((w) => w === 'update')).toBe(true);
  });

  it('범위가 조사까지면 팀원을 한 번만 부르고 사용자에게 묻지 않는다', async () => {
    const team = new FakeTeam([investigationOut()]);
    const user = fakeUser({});
    const result = await service(team, new FakeDocs(), { user: user.port }).run(input({ reach: 'investigate' }));
    expect(team.calls).toHaveLength(1);
    expect(user.cards.directions).toEqual([]);
    expect(result.brief).toBeNull();
    expect(result.summary).toContain('조사까지 마침');
  });

  it('범위가 방향 비교까지면 카드로 고르게 하고 설계로 가지 않는다', async () => {
    const team = new FakeTeam([investigationOut(), directionsOut]);
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'b', reason: '락이 단순하다' }] });
    const result = await service(team, new FakeDocs(), { user: user.port }).run(input({ reach: 'compare' }));
    expect(team.calls).toHaveLength(2);
    expect(user.cards.directions[0]!.canGoOn).toBe(true);
    expect(result.run.choice?.divergedFromAi()).toBe(true);
    expect(result.brief).toBeNull();
  });

  it('방향 비교만 하기로 했어도 "설계·계획까지"를 고르면 이어 간다', async () => {
    const team = new FakeTeam(full());
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a', goOn: true }], decisions: [{ kind: 'proceed' }] });
    const result = await service(team, new FakeDocs(), { user: user.port }).run(input({ reach: 'compare' }));
    expect(team.calls.map((c) => c.role)).toEqual(['debugger', 'debugger', 'designer']);
    expect(result.brief).not.toBeNull();
  });

  it('AI 추천이 아닌 방향이나 직접 쓴 방향을 고르면 설계 호출이 그 방향을 받는다', async () => {
    const team = new FakeTeam(full());
    const user = fakeUser({ directions: [{ kind: 'custom', text: '결제 모듈을 새로 만든다' }], decisions: [{ kind: 'proceed' }] });
    const result = await service(team, new FakeDocs(), { user: user.port }).run(input());
    expect(team.calls[2]!.userMessage).toContain('<chosen_direction>\n결제 모듈을 새로 만든다\n</chosen_direction>');
    expect(result.run.choice?.custom).toBe(true);
    expect(result.run.choice?.recommended).toBe('멱등 키');
  });

  it('조사와 방향 비교 호출은 같은 앞부분을 받아 프롬프트 캐시가 맞는다', async () => {
    const team = new FakeTeam([investigationOut(), directionsOut]);
    await service(team, new FakeDocs(), { user: fakeUser({ directions: [{ kind: 'stop' }] }).port }).run(input());
    const first = team.calls[0]!.userMessage.split('<job>')[0]!;
    expect(team.calls[1]!.userMessage.startsWith(first)).toBe(true);
  });

  it('조사·방향 비교는 sonnet 보고 팀원이, 설계와 계획은 설계 팀원이 effort high로 한다', async () => {
    const team = new FakeTeam(full());
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'proceed' }] });
    await service(team, new FakeDocs(), { user: user.port }).run(input());
    expect(team.calls[0]!.setting).toMatchObject({ tier: 'sonnet' });
    expect(team.calls[2]!.setting).toMatchObject({ tier: 'sonnet', effort: 'high' });
    expect(team.calls.every((c) => c.canWrite('docs/x.md') === false)).toBe(true);
  });

  it('큰 변경(영역이 셋 이상)이면 설계 팀원만 opus로 올린다', async () => {
    const wide = { ...investigationOut(), facts: ['packages/a/src/x.ts', 'packages/b/src/y.ts', 'docs/z.md'].map((p) => ({ text: p, evidence: p })) };
    const team = new FakeTeam([wide, directionsOut, blueprintOut]);
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'proceed' }] });
    const result = await service(team, new FakeDocs(), { user: user.port }).run(input());
    expect(team.calls.map((c) => c.setting.tier)).toEqual(['sonnet', 'sonnet', 'opus']);
    expect(result.cost.find((c) => c.tier === 'opus')?.calls).toBe(1);
  });

  it('한도가 빠듯하면(70% 이상) 큰 변경이어도 opus를 쓰지 않는다', async () => {
    const wide = { ...investigationOut(), facts: ['packages/a/src/x.ts', 'packages/b/src/y.ts', 'docs/z.md'].map((p) => ({ text: p, evidence: p })) };
    const team = new FakeTeam([wide, directionsOut, blueprintOut]);
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'proceed' }] });
    await service(team, new FakeDocs(), { user: user.port, budget: () => SessionBudget.fromWindows([{ percent: 75, resetsAt: null }]) }).run(input());
    expect(team.calls[2]!.setting.tier).toBe('sonnet');
  });

  it('한도가 90%를 넘었으면 시작부터 조사까지만 한다', async () => {
    const team = new FakeTeam([investigationOut()]);
    const result = await service(team, new FakeDocs(), { user: fakeUser({}).port, budget: () => SessionBudget.fromWindows([{ percent: 95, resetsAt: null }]) }).run(input());
    expect(team.calls).toHaveLength(1);
    expect(result.summary).toContain('조사까지 마침');
  });

  it('방향을 고르길 기다리는 동안 한도가 90%를 넘으면 설계를 부르지 않고 멈춘다', async () => {
    let percent = 10;
    const team = new FakeTeam(full());
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }] });
    const port: AnalysisUserPort = { ...user.port, chooseDirection: async (card, signal) => ((percent = 95), user.port.chooseDirection(card, signal)) };
    const result = await service(team, new FakeDocs(), { user: port, budget: () => SessionBudget.fromWindows([{ percent, resetsAt: null }]) }).run(input());
    expect(team.calls).toHaveLength(2);
    expect(result.run.stopped?.reason).toBe('budget');
    expect(result.run.choice).not.toBeNull();
  });

  it('물어볼 화면이 없으면 방향 비교까지 하고 문서를 남긴 채 멈춘다(자동으로 설계로 가지 않는다)', async () => {
    const team = new FakeTeam(full());
    const docs = new FakeDocs();
    const result = await service(team, docs).run(input());
    expect(team.calls).toHaveLength(2);
    expect(result.run.stopped?.reason).toBe('no-screen');
    expect(docs.files.get(result.path!)).toContain('## 2. 방향 비교');
    expect(result.summary).toContain('방향 비교까지만 했어요');
  });

  it('답이 오지 않아 기다림 한도가 지나면 카드를 닫고 거기서 멈추며, 추천을 자동으로 고르지 않는다', async () => {
    const team = new FakeTeam(full());
    const user = fakeUser({});
    const waited: number[] = [];
    const timer = (ms: number) => (waited.push(ms), { expired: Promise.resolve(), cancel: () => undefined });
    const result = await service(team, new FakeDocs(), { user: user.port, timer }).run(input());
    expect(waited).toEqual([ASK_WAIT_MS]);
    expect(user.closed).toEqual([true]);
    expect(result.run.stopped?.reason).toBe('timeout');
    expect(result.run.choice).toBeNull();
    expect(team.calls).toHaveLength(2);
    expect(result.summary).toContain('추천대로 자동으로 진행하지는 않아요');
  });

  it('사용자가 기다림 한도를 넘기지 않고 답하면 타이머를 거둔다', async () => {
    let cancelled = 0;
    const timer = () => ({ expired: new Promise<void>(() => undefined), cancel: () => (cancelled += 1) });
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'proceed' }] });
    await service(new FakeTeam(full()), new FakeDocs(), { user: user.port, timer }).run(input());
    expect(cancelled).toBe(2);
  });

  it('방향 카드에서 그만두면 거기까지의 문서만 남는다', async () => {
    const docs = new FakeDocs();
    const result = await service(new FakeTeam(full()), docs, { user: fakeUser({ directions: [{ kind: 'stop' }] }).port }).run(input());
    expect(result.run.stopped?.reason).toBe('user');
    expect(docs.files.get(result.path!)).toContain('## 2. 방향 비교');
    expect(docs.files.get(result.path!)).not.toContain('## 3. 설계');
    expect(result.brief).toBeNull();
  });

  it('승인 카드에서 그만두면 구현을 넘기지 않고, 설계와 계획 문서는 남는다', async () => {
    const docs = new FakeDocs();
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'stop' }] });
    const result = await service(new FakeTeam(full()), docs, { user: user.port }).run(input());
    expect(result.brief).toBeNull();
    expect(docs.files.get(result.path!)).toContain('## 4. 단계별 계획');
    expect(docs.files.get(result.path!)).toContain('## 멈춘 이유');
  });

  it('고칠 점을 말하면 설계와 계획을 그 말과 함께 다시 쓴다', async () => {
    const second = { ...blueprintOut, goal: '두 번째 설계' };
    const team = new FakeTeam([investigationOut(), directionsOut, blueprintOut, second]);
    const user = fakeUser({ directions: [{ kind: 'pick', id: 'a' }], decisions: [{ kind: 'revise', note: '테스트를 더 잘게 나눠 줘' }, { kind: 'proceed' }] });
    const result = await service(team, new FakeDocs(), { user: user.port }).run(input());
    expect(team.calls).toHaveLength(4);
    expect(team.calls[3]!.userMessage).toContain('테스트를 더 잘게 나눠 줘');
    expect(result.brief!.request).toContain('두 번째 설계');
    expect(user.cards.approvals).toHaveLength(2);
  });

  it('계정 한도에 막히면 그 단계에서 멈추고 풀리는 시각 안내와 지금까지의 문서를 남긴다', async () => {
    const docs = new FakeDocs();
    const team = new FakeTeam([investigationOut(), blocked()]);
    const result = await service(team, docs, { user: fakeUser({}).port }).run(input());
    expect(result.run.stopped?.reason).toBe('blocked');
    expect(result.summary).toContain("You've hit your session limit");
    expect(docs.files.get(result.path!)).toContain('## 1. 조사');
  });

  it('작업을 멈추면(취소) 사용자가 그만둔 것으로 남긴다', async () => {
    const result = await service(new FakeTeam([blocked('cancelled')]), new FakeDocs()).run(input());
    expect(result.run.stopped?.reason).toBe('user');
  });

  it('보고 형식이 안 맞으면 이유를 달아 한 번 더 부르고, 읽히면 이어 간다', async () => {
    const team = new FakeTeam([{ symptom: '' }, investigationOut()]);
    const result = await service(team, new FakeDocs()).run(input({ reach: 'investigate' }));
    expect(team.calls).toHaveLength(2);
    expect(team.calls[1]!.userMessage).toContain('<previous_attempt>');
    expect(result.run.investigation).not.toBeNull();
  });

  it('두 번 다 읽히지 않으면 그 단계에서 멈춘다', async () => {
    const team = new FakeTeam([null, null]);
    const result = await service(team, new FakeDocs()).run(input({ reach: 'investigate' }));
    expect(result.run.stopped?.reason).toBe('unreadable');
    expect(result.brief).toBeNull();
  });

  it('팀원이 턴 한도로 멈추면 다시 부르지 않고 이유와 부분 결과를 남기며 멈춘다', async () => {
    const limited: MemberResult = { output: null, error: null, fetched: [], usage: { ...usage, turns: 25, endReason: 'error_max_turns' }, partial: '결제 재시도 코드까지 읽었어요' };
    const team = new FakeTeam([limited]);
    const docs = new FakeDocs();
    const result = await service(team, docs).run(input({ reach: 'investigate' }));
    expect(team.calls).toHaveLength(1);
    expect(result.run.stopped?.reason).toBe('unreadable');
    expect(result.run.stopNote()).toContain('25턴');
    expect(result.run.stopNote()).toContain('턴 한도');
    expect(result.run.stopNote()).toContain('결제 재시도 코드까지 읽었어요');
    expect(result.summary).toContain('턴 한도');
    expect(result.summary).not.toContain('$');
  });

  it('도구 거절로 멈추면 거절된 도구를 멈춘 이유에 보인다', async () => {
    const denied: MemberResult = { output: null, error: null, fetched: [], usage: { ...usage, denials: ['Bash: rm -rf x'] } };
    const result = await service(new FakeTeam([denied]), new FakeDocs()).run(input({ reach: 'investigate' }));
    expect(result.run.stopNote()).toContain('Bash 호출 1번');
  });

  it('SDK가 멈춘 이유를 주지 않은 빈 출력은 지금처럼 형식 오류로 다시 받는다', async () => {
    const team = new FakeTeam([null, investigationOut()]);
    await service(team, new FakeDocs()).run(input({ reach: 'investigate' }));
    expect(team.calls).toHaveLength(2);
  });

  it('함께 읽는 다른 저장소 폴더는 조사 팀원에게 읽기 폴더로 열어 주되 쓰기는 막는다', async () => {
    const team = new FakeTeam([investigationOut()]);
    await service(team, new FakeDocs()).run(input({ reach: 'investigate', readDirs: ['E:/w/shop-web'] }));
    expect(team.calls[0]!.additionalDirectories).toEqual(['E:/w/shop-web']);
    expect(team.calls[0]!.canWrite('E:/w/shop-web/a.ts')).toBe(false);
  });

  it('읽기 폴더를 주지 않으면 팀원 호출에 추가 폴더를 싣지 않는다', async () => {
    const team = new FakeTeam([investigationOut()]);
    await service(team, new FakeDocs()).run(input({ reach: 'investigate' }));
    expect(team.calls[0]!.additionalDirectories).toBeUndefined();
  });

  it('근거 없는 사실이 든 조사 보고는 받아들이지 않는다', async () => {
    const bad = { ...investigationOut(), facts: [{ text: '아마 그럴 것', evidence: ' ' }] };
    const team = new FakeTeam([bad, investigationOut()]);
    const result = await service(team, new FakeDocs()).run(input({ reach: 'investigate' }));
    expect(team.calls[1]!.userMessage).toContain('evidence');
    expect(result.run.investigation).not.toBeNull();
  });

  it('문서를 쓰지 못해도 분석은 계속하고 이유를 알린다', async () => {
    const docs = new FakeDocs();
    docs.failCreate = true;
    const result = await service(new FakeTeam([investigationOut()]), docs).run(input({ reach: 'investigate' }));
    expect(result.path).toBeNull();
    expect(result.docProblem).toContain('디스크');
    expect(result.summary).toContain('문서를 쓰지 못했어요');
    expect(result.run.investigation).not.toBeNull();
  });

  it('문서에는 비밀 모양을 가려서 쓴다', async () => {
    const leaky = { ...investigationOut(), symptom: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456 가 로그에 나온다' };
    const docs = new FakeDocs();
    const result = await service(new FakeTeam([leaky]), docs).run(input({ reach: 'investigate' }));
    expect(docs.files.get(result.path!)).not.toContain('sk-abcdefghijklmnop');
    expect(result.summary).not.toContain('sk-abcdefghijklmnop');
  });

  it('위험 점검 요청은 위험 점검 팀원이 조사와 방향 비교를 한다', async () => {
    const team = new FakeTeam([investigationOut(), directionsOut]);
    await service(team, new FakeDocs()).run(input({ role: 'riskchecker' }));
    expect(team.calls.map((c) => c.role)).toEqual(['riskchecker', 'riskchecker']);
  });

  it('분석 하나가 끝나도 다음 분석에 값이 남지 않는다', async () => {
    const svc = service(new FakeTeam([investigationOut(), investigationOut()]), new FakeDocs());
    const a = await svc.run(input({ reach: 'investigate' }));
    const b = await svc.run(input({ reach: 'investigate' }));
    expect(a.run.id).not.toBe(b.run.id);
    expect(b.cost).toEqual([{ tier: 'sonnet', calls: 1, costUsd: 0.01 }]);
  });
});
