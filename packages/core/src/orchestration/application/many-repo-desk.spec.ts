import { describe, expect, it } from 'vitest';
import { SessionBudget } from '../domain/session-budget.js';
import type { DeskHost } from './desk-host.js';
import { ManyRepoDesk, type RepoRunner } from './many-repo-desk.js';
import type { RunOutcome } from './minimal-loop.service.js';
import type { MemberResult } from './ports.js';
import type { TurnOutcome } from './turn-outcome.js';

/** 이 서비스가 읽는 것만 채운 작업 결과 */
const work = (title: string, files: string[], status: 'complete' | 'stopped' = 'complete'): TurnOutcome => ({
  kind: 'work',
  outcome: { status, title, changedInRun: files.map((path) => ({ path, kind: 'modified' })), guide: { stopMessage: () => (status === 'stopped' ? '테스트가 계속 실패했어요' : null) } } as unknown as RunOutcome,
});

const member = (output: unknown): MemberResult => ({
  output,
  error: null,
  fetched: [],
  usage: { model: 'sonnet', durationMs: 1, costUsd: 0, turns: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, denials: [], endReason: 'success' },
});

const PLAN = {
  parts: [
    { repo: 'api', request: '주문 응답에 couponDiscount 추가', dependsOn: [] },
    { repo: 'web', request: '주문 상세에 할인 줄', dependsOn: ['api'] },
    { repo: 'app', request: '주문 상세에 할인 줄', dependsOn: ['api'] },
  ],
  contract: [{ what: '쿠폰 할인액', between: ['api', 'web', 'app'], shape: '{ couponDiscount: number }' }],
  edgeCases: [{ case: '필드 없음', handling: '할인 줄 숨김', repo: 'web' }],
  decisions: ['원 단위 정수'],
};

/** 나누기·검사 출력을 차례로 돌려주는 가짜 host. 받은 호출을 남긴다. */
function hostWith(outputs: unknown[]) {
  const calls: { role: string; parts: readonly string[] }[] = [];
  const host: DeskHost = {
    member: async (role, parts) => {
      calls.push({ role, parts });
      return member(outputs.shift() ?? null);
    },
    settle: async () => ({ kind: 'notice', message: '' }),
    spent: () => 0,
    workspaceBlock: () => '',
  };
  return { host, calls };
}

/** 저장소마다 시작·끝을 기록하는 가짜 실행기. hold에 든 저장소는 release를 부를 때까지 끝나지 않는다. */
function runners(results: Record<string, TurnOutcome[]>, hold: string[] = []) {
  const log: string[] = [];
  const requests: Record<string, { request: string; block: string }[]> = {};
  const releases: Record<string, () => void> = {};
  const list: RepoRunner[] = Object.keys(results).map((name) => ({
    name,
    root: `/w/${name}`,
    work: async (request, block) => {
      (requests[name] ??= []).push({ request, block });
      log.push(`start ${name}`);
      if (hold.includes(name)) await new Promise<void>((r) => (releases[name] = r));
      log.push(`end ${name}`);
      return results[name]!.shift()!;
    },
  }));
  return { list, log, requests, releases };
}

const desk = (host: DeskHost, budget?: SessionBudget) => new ManyRepoDesk(host, { progress: { step: () => undefined }, now: () => 1000, ...(budget ? { budget: () => budget } : {}) });
const okCheck = { items: [{ what: '쿠폰 할인액', ok: true, repo: null, fix: null, evidence: 'api/order.ts:3 couponDiscount / web/order.tsx:9 couponDiscount' }] };

describe('ManyRepoDesk', () => {
  it('먼저 만들어야 하는 저장소(API)를 끝낸 뒤, 그것을 기다리던 저장소들(웹·앱)을 함께 시작한다', async () => {
    const { host } = hostWith([PLAN, okCheck]);
    const r = runners({ api: [work('쿠폰 응답', ['src/order.dto.ts'])], web: [work('할인 줄', ['src/order.tsx'])], app: [work('할인 줄', ['lib/order.dart'])] });
    const turn = await desk(host).run('쿠폰 할인 보여줘', null, r.list, [], 0);
    expect(r.log.slice(0, 2)).toEqual(['start api', 'end api']);
    expect(r.log.slice(2).filter((l) => l.startsWith('start')).sort()).toEqual(['start app', 'start web']);
    expect(turn).toMatchObject({ kind: 'repos', decisions: ['원 단위 정수'] });
    if (turn.kind !== 'repos') return;
    expect(turn.repos.map((x) => [x.repo, x.status])).toEqual([['api', 'complete'], ['web', 'complete'], ['app', 'complete']]);
    expect(turn.contract).toEqual([{ what: '쿠폰 할인액', checked: true, ok: true, evidence: okCheck.items[0]!.evidence, fixedIn: null }]);
  });

  it('뒤 저장소에는 약속·자기 엣지 케이스와 먼저 끝난 저장소가 바꾼 파일을 넘긴다', async () => {
    const { host } = hostWith([PLAN, okCheck]);
    const r = runners({ api: [work('쿠폰 응답', ['src/order.dto.ts'])], web: [work('할인 줄', [])], app: [work('할인 줄', [])] });
    await desk(host).run('쿠폰 할인 보여줘', null, r.list, [], 0);
    const web = r.requests['web']![0]!;
    expect(web.request).toContain('엣지 케이스: 필드 없음 → 할인 줄 숨김');
    expect(web.block).toContain('{ couponDiscount: number }');
    expect(web.block).toContain('api: 쿠폰 응답 (src/order.dto.ts)');
    expect(r.requests['app']![0]!.request).not.toContain('필드 없음');
  });

  it('앞 저장소가 멈추면 그것을 기다리던 저장소는 하지 않고, 약속도 검사하지 않는다', async () => {
    const { host, calls } = hostWith([PLAN]);
    const r = runners({ api: [work('쿠폰 응답', [], 'stopped')], web: [], app: [] });
    const turn = await desk(host).run('쿠폰 할인 보여줘', null, r.list, [], 0);
    expect(r.log).toEqual(['start api', 'end api']);
    if (turn.kind !== 'repos') throw new Error('repos expected');
    expect(turn.repos.map((x) => x.status)).toEqual(['stopped', 'skipped', 'skipped']);
    expect(turn.contract[0]).toMatchObject({ checked: false });
    expect(calls.filter((c) => c.parts.includes('<job>check</job>'))).toHaveLength(0);
  });

  it('약속이 어긋난 저장소는 한 번만 더 고친다', async () => {
    const mismatch = { items: [{ what: '쿠폰 할인액', ok: false, repo: 'web', fix: 'coupon_discount 대신 couponDiscount를 읽는다', evidence: 'web/order.tsx:9 order.coupon_discount' }] };
    const { host } = hostWith([PLAN, mismatch]);
    const r = runners({ api: [work('쿠폰 응답', ['a.ts'])], web: [work('할인 줄', ['w.tsx']), work('약속에 맞춤', ['w.tsx'])], app: [work('할인 줄', ['o.dart'])] });
    const turn = await desk(host).run('쿠폰 할인 보여줘', null, r.list, [], 0);
    expect(r.requests['web']).toHaveLength(2);
    expect(r.requests['web']![1]!.request).toContain('coupon_discount 대신 couponDiscount를 읽는다');
    if (turn.kind !== 'repos') throw new Error('repos expected');
    expect(turn.repos.find((x) => x.repo === 'web')!.fixed?.title).toBe('약속에 맞춤');
    expect(turn.contract[0]).toMatchObject({ ok: false, fixedIn: 'web' });
  });

  it('기다릴 것이 없는 저장소끼리는 함께 돌되, 한도가 빠듯하면 하나씩 돈다', async () => {
    const free = { parts: [{ repo: 'web', request: 'a', dependsOn: [] }, { repo: 'app', request: 'b', dependsOn: [] }], contract: [], edgeCases: [], decisions: [] };
    const together = runners({ web: [work('a', [])], app: [work('b', [])] }, ['web']);
    const running = desk(hostWith([free]).host).run('x', null, together.list, [], 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(together.log).toEqual(['start web', 'start app', 'end app']);
    together.releases['web']!();
    await running;

    const saving = SessionBudget.fromWindows([{ percent: 90, resetsAt: null }]);
    const oneByOne = runners({ web: [work('a', [])], app: [work('b', [])] }, ['web']);
    const paced = desk(hostWith([free]).host, saving).run('x', null, oneByOne.list, [], 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(oneByOne.log).toEqual(['start web']);
    oneByOne.releases['web']!();
    await paced;
    expect(oneByOne.log).toEqual(['start web', 'end web', 'start app', 'end app']);
  });

  it('나누기가 규칙을 어기면 이유를 알려 한 번 다시 받고, 또 어기면 알린다', async () => {
    const bad = { ...PLAN, parts: [{ repo: 'nope', request: 'x', dependsOn: [] }], contract: [], edgeCases: [] };
    const { host, calls } = hostWith([bad, bad]);
    const turn = await desk(host).run('x', null, runners({ api: [], web: [], app: [] }).list, [], 0);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.parts.join('\n')).toContain('작업 공간에 없는 저장소');
    expect(turn.kind).toBe('notice');
  });

  it('계정이 막히면(사용 한도) 새 저장소를 시작하지 않는다', async () => {
    const { host } = hostWith([PLAN]);
    const r = runners({ api: [{ kind: 'blocked', reason: 'usage-limit', message: '5시간 한도' }], web: [], app: [] });
    const turn = await desk(host).run('x', null, r.list, [], 0);
    expect(r.log).toEqual(['start api', 'end api']);
    if (turn.kind !== 'repos') throw new Error('repos expected');
    expect(turn.repos[0]).toMatchObject({ status: 'stopped', note: '5시간 한도' });
  });
});
