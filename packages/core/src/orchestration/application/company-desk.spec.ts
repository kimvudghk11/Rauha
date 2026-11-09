import { describe, expect, it } from 'vitest';
import { CompanyDesk } from './company-desk.js';
import type { DeskHost } from './desk-host.js';
import type { MemberResult } from './ports.js';
import type { TurnOutcome } from './turn-outcome.js';

const done: MemberResult['usage'] = { model: 'sonnet', durationMs: 1, costUsd: 0.5, turns: 4, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' };
const ok = (output: unknown): MemberResult => ({ output, error: null, fetched: [], usage: done });
const stoppedAt = (usage: Partial<MemberResult['usage']>, partial: string | null = null): MemberResult => ({ output: null, error: null, fetched: [], usage: { ...done, ...usage }, partial });
const turnLimit = (partial: string | null = null) => stoppedAt({ turns: 25, endReason: 'error_max_turns' }, partial);

interface Settled {
  label: string;
  answer: string;
  remembered: string;
}

function setup(script: Partial<Record<string, MemberResult[]>>) {
  const settled: Settled[] = [];
  const calls: string[] = [];
  const host: DeskHost = {
    member: async (role) => {
      calls.push(role);
      const next = script[role]?.shift();
      if (next === undefined) throw new Error(`예상 못한 호출: ${role}`);
      return next;
    },
    settle: async (label, _input, answer, remembered) => {
      settled.push({ label, answer, remembered });
      return { kind: 'notice', message: answer } satisfies TurnOutcome;
    },
    spent: () => 0,
    workspaceBlock: () => '',
  };
  const desk = new CompanyDesk(host, { today: () => '2026-11-09', now: () => 0, progress: { step: () => undefined } });
  return { desk, settled, calls };
}

const route = (over: Record<string, unknown>) => ({ mode: 'company', member: null, department: 'planning', ...over }) as never;

describe('CompanyDesk 팀원이 멈췄을 때', () => {
  it('혼자 하는 분석이 턴 한도로 멈추면 이유와 부분 결과를 보이고 앞 대화에는 이어서 쓸 글을 남긴다', async () => {
    const { desk, settled } = setup({ debugger: [turnLimit('결제 재시도 코드까지 봤어요')] });
    await desk.analyze('debugger', '디버깅 팀원', '왜 두 번 결제돼?', null, 0);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.answer).toContain('턴 한도');
    expect(settled[0]!.answer).toContain('25턴');
    expect(settled[0]!.answer).toContain('결제 재시도 코드까지 봤어요');
    expect(settled[0]!.remembered).toContain('마지막으로 한 일: 결제 재시도 코드까지 봤어요');
    expect(settled[0]!.answer).not.toContain('보고를 읽지 못했어요');
    expect(settled[0]!.answer).not.toMatch(/\$|USD/);
  });

  it('도구 거절로 멈추면 거절된 도구를 보인다', async () => {
    const { desk, settled } = setup({ debugger: [stoppedAt({ denials: ['Bash: rm -rf dist'] })] });
    await desk.analyze('debugger', '디버깅 팀원', '왜 두 번 결제돼?', null, 0);
    expect(settled[0]!.answer).toContain('Bash 호출 1번');
  });

  it('멈춘 분석은 회사 장부에 남기지 않는다', async () => {
    const saved: unknown[] = [];
    const host = { member: async () => turnLimit(), settle: async (_l: string, _i: string, a: string) => ({ kind: 'notice', message: a }) as TurnOutcome, spent: () => 0, workspaceBlock: () => '' };
    const desk = new CompanyDesk(host as DeskHost, {
      today: () => 'd',
      now: () => 0,
      progress: { step: () => undefined },
      company: { load: async () => ({ block: () => '', with: () => ({}) }) as never, save: async (b: unknown) => void saved.push(b) } as never,
    });
    await desk.analyze('planner', '기획 팀원', '아이디어', null, 0, 'planning');
    expect(saved).toHaveLength(0);
  });

  it('정상 보고는 그대로 보이고 멈춘 이유 문장이 붙지 않는다', async () => {
    const { desk, settled } = setup({ debugger: [ok({ answer: '원인은 재시도예요', files: ['src/pay.ts'] })] });
    await desk.analyze('debugger', '디버깅 팀원', '왜?', null, 0);
    expect(settled[0]!.answer).toContain('원인은 재시도예요');
    expect(settled[0]!.answer).not.toContain('멈췄어요');
  });

  it('부서장이 일을 나누다 멈추면 이유를 보이고 팀원을 부르지 않는다', async () => {
    const { desk, settled, calls } = setup({ chief: [turnLimit()] });
    await desk.company('수익 모델 짜줘', null, route({}), 0);
    expect(calls).toEqual(['chief']);
    expect(settled[0]!.answer).toContain('턴 한도');
  });

  it('여러 팀원 중 하나만 멈추면 끝난 보고 뒤에 멈춘 팀원의 이유를 붙인다', async () => {
    const plan = ok({ assignments: [{ member: 'planner', brief: 'a' }, { member: 'bm', brief: 'b' }] });
    const { desk, settled, calls } = setup({
      chief: [plan],
      planner: [ok({ answer: '아이디어는 이래요', files: [] })],
      bm: [turnLimit('가격표 초안까지 했어요')],
    });
    await desk.company('사업 구상', null, route({}), 0);
    expect(calls).toEqual(['chief', 'planner', 'bm']);
    expect(settled[0]!.answer).toContain('아이디어는 이래요');
    expect(settled[0]!.answer).toContain('사업 모델 팀원');
    expect(settled[0]!.answer).toContain('턴 한도');
    expect(settled[0]!.answer).toContain('가격표 초안까지 했어요');
  });

  it('팀원이 모두 멈추면 종합하지 않고 이유만 보인다', async () => {
    const plan = ok({ assignments: [{ member: 'planner', brief: 'a' }, { member: 'bm', brief: 'b' }] });
    const { desk, settled, calls } = setup({ chief: [plan], planner: [turnLimit()], bm: [turnLimit()] });
    await desk.company('사업 구상', null, route({}), 0);
    expect(calls).toEqual(['chief', 'planner', 'bm']);
    expect(settled[0]!.answer).toContain('기획 팀원');
    expect(settled[0]!.answer).toContain('사업 모델 팀원');
  });

  it('종합이 멈춰도 팀원이 끝낸 보고는 함께 보인다', async () => {
    const plan = ok({ assignments: [{ member: 'planner', brief: 'a' }, { member: 'bm', brief: 'b' }] });
    const { desk, settled } = setup({
      chief: [plan, turnLimit()],
      planner: [ok({ answer: '아이디어는 이래요', files: [] })],
      bm: [ok({ answer: '가격은 이래요', files: [] })],
    });
    await desk.company('사업 구상', null, route({}), 0);
    expect(settled[0]!.answer).toContain('턴 한도');
    expect(settled[0]!.answer).toContain('아이디어는 이래요');
    expect(settled[0]!.answer).toContain('가격은 이래요');
  });

  it('런칭 계획 중 한 부서가 멈추면 거기까지 쓴 부서 글과 이유를 보인다', async () => {
    const section = ok({ answer: '기획 글', files: [] });
    const { desk, settled, calls } = setup({ chief: [section, turnLimit()] });
    await desk.launch('앱 런칭', null, 0);
    expect(calls).toEqual(['chief', 'chief']);
    expect(settled[0]!.answer).toContain('기획 글');
    expect(settled[0]!.answer).toContain('턴 한도');
  });
});
