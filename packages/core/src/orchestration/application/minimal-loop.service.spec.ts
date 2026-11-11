import { describe, expect, it } from 'vitest';
import type { KnowledgePort } from '../../knowledge/application/ports.js';
import { RepoRef } from '../../knowledge/domain/repo-ref.js';
import { DomainError } from '../../shared/domain-error.js';
import { TestRun } from '../domain/test-run.js';
import type { CheckedClaim } from '../domain/fact-check.js';
import type { CheckResult } from '../domain/verification.js';
import type { Assumption } from './dto/intake.dto.js';
import { RoleSettingsDto, type MemberRole } from './dto/role-settings.dto.js';
import { MinimalLoopService } from './minimal-loop.service.js';
import type {
  ChecksPort,
  FactAnswer,
  FileChange,
  MemberCall,
  MemberResult,
  ProgressPort,
  RunLogPort,
  TeamMemberPort,
  TestsResult,
  UserPort,
  WorkspacePort,
  WorkspaceSnapshot,
} from './ports.js';

// ── 가짜 작업 공간: 파일 내용 = 해시 ─────────────────────────
class FakeWorkspace implements WorkspacePort {
  readonly files = new Map<string, string>([['src/money.ts', 'v1']]);
  private readonly head = new Map(this.files);
  constructor(private readonly dirty: string[] | null = []) {}

  async dirtyFiles() {
    return this.dirty;
  }
  async snapshot(): Promise<WorkspaceSnapshot> {
    const changed = new Map<string, string>();
    for (const [p, v] of this.files) if (this.head.get(p) !== v) changed.set(p, v);
    return { files: changed };
  }
  changesBetween(a: WorkspaceSnapshot, b: WorkspaceSnapshot): FileChange[] {
    const paths = new Set([...a.files.keys(), ...b.files.keys()]);
    return [...paths]
      .filter((p) => a.files.get(p) !== b.files.get(p))
      .map((p) => ({ path: p, kind: this.head.has(p) ? 'modified' : 'added' }));
  }
  async changesSinceHead() {
    return this.changesBetween({ files: new Map() }, await this.snapshot());
  }
  async reviewChanges() {
    return this.changesSinceHead();
  }
  async listFiles() {
    return [...this.files.keys()];
  }
  async readFile(path: string) {
    return this.files.get(path) ?? null;
  }
}

class FakeUser implements UserPort {
  readonly asked: string[] = [];
  readonly factsAsked: string[] = [];
  constructor(
    readonly interactive: boolean,
    private readonly answers: number[] = [],
    private readonly factAnswers: FactAnswer[] = [],
  ) {}
  async choose(assumption: Assumption) {
    this.asked.push(assumption.question);
    return this.answers.shift() ?? 0;
  }
  async pickPast() {
    return null;
  }
  async confirmFact(claim: CheckedClaim): Promise<FactAnswer> {
    this.factsAsked.push(claim.text);
    return this.factAnswers.shift() ?? { kind: 'correct' };
  }
}

type Script = (call: MemberCall, ws: FakeWorkspace) => unknown;

class FakeTeam implements TeamMemberPort {
  readonly calls: MemberRole[] = [];
  readonly log: { role: MemberRole; tier: string; message: string }[] = [];
  constructor(
    private readonly ws: FakeWorkspace,
    private readonly scripts: Partial<Record<MemberRole, Script[]>>,
    /** 이 역할을 부르면 구독 사용 한도(또는 로그인 필요) 오류를 낸다 */
    private readonly limitOn: MemberRole | null = null,
    private readonly blockReason: 'usage-limit' | 'login' | 'cancelled' = 'usage-limit',
  ) {}
  async run(call: MemberCall): Promise<MemberResult> {
    this.calls.push(call.role);
    this.log.push({ role: call.role, tier: call.setting.tier, message: call.userMessage });
    const queue = this.scripts[call.role] ?? [];
    const script = queue.length > 1 ? (queue.shift() as Script) : queue[0];
    const limited = call.role === this.limitOn ? "You've hit your session limit · resets 5:40pm" : null;
    return {
      output: script && limited === null ? script(call, this.ws) : null,
      error: limited,
      blocked: limited === null ? null : { reason: this.blockReason, message: limited },
      usage: { model: call.setting.tier, durationMs: 10, costUsd: 0.001, turns: 3, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, denials: [], endReason: 'success' },
      fetched: [],
    };
  }
}

class FakeChecks implements ChecksPort {
  constructor(
    private readonly ws: FakeWorkspace,
    private readonly suite: () => CheckResult[] = () => [{ name: 'tests', status: 'pass', failures: [], command: 'npm run test', summary: '통과' }],
  ) {}
  async runTests(files: readonly string[]): Promise<TestsResult> {
    const implemented = this.ws.files.get('src/money.ts')?.startsWith('v2') === true;
    const run = implemented ? TestRun.of({ passed: 2, failed: 0 }) : TestRun.of({ passed: 0, failed: 2, failedNames: ['discount'] });
    return {
      run,
      ids: [...run.failedNames],
      passed: implemented ? ['Money discount 10% 할인', 'Money discount 범위 밖 할인율'] : [],
      digest: implemented ? '' : 'discount: expected 9000',
      command: `vitest ${files.join(' ')}`,
    };
  }
  suiteRuns = 0;
  quickRuns: (readonly string[])[] = [];
  /** quick을 주면 바뀐 곳만 좁혀 돌리는 검사기로 동작한다. 안 주면 좁히지 못하고 전체를 돈다. */
  quick: ((changed: readonly string[]) => CheckResult[]) | null = null;
  async runQuick(changed: readonly string[]) {
    this.quickRuns.push(changed);
    return this.quick === null ? { results: await this.runSuite(), narrowed: false } : { results: this.quick(changed), narrowed: true };
  }
  async runSuite() {
    this.suiteRuns += 1;
    return this.suite();
  }
}

class FakeLog implements RunLogPort {
  readonly labels: string[] = [];
  async recordCall() {}
  async recordChecks(label: string) {
    this.labels.push(label);
  }
  async finish() {
    return '/runs/x';
  }
}

const intake = (overrides: Record<string, unknown> = {}) => ({
  title: 'Money 할인',
  fileCount: 2,
  crossModule: false,
  sensitive: false,
  scope: ['src/money.ts', 'src/money.spec.ts'],
  acceptance: [
    { kind: 'happy', text: '10% 할인' },
    { kind: 'error', text: '범위 밖 할인율' },
  ],
  doneWhen: 'discount 테스트 통과',
  forbidden: [],
  ...overrides,
});

const report = { result: 'done', did: ['했다'], changedFiles: [], passed: 0, failed: 0, failedTests: [], remaining: null, question: null };
const explanation = {
  decisions: [{ what: 'Money에 둠', why: '같은 자리', rejected: null }],
  readingOrder: [
    { path: 'src/money.ts', line: 3, note: '여기' },
    { path: 'src/money.spec.ts', line: 1, note: '테스트' },
  ],
  manualChecks: ['해 보기'],
  untested: [],
};

const writeTest: Script = (_c, ws) => {
  ws.files.set('src/money.spec.ts', 'test');
  return report;
};
const implement: Script = (_c, ws) => {
  ws.files.set('src/money.ts', 'v2');
  return { ...report, explanation };
};
const implementWrong: Script = (_c, ws) => {
  ws.files.set('src/money.ts', `bad-${Math.random()}`);
  return { ...report, explanation };
};

function fakeKnowledge(noted: string[]): KnowledgePort {
  return {
    current: async () => ({ block: '<repo_knowledge repo="shop" basis="main (a1b2c3d)">\n요약\n</repo_knowledge>', basis: RepoRef.of({ branch: 'main', commit: 'a1b2c3d'.padEnd(40, '0'), dirty: false }) }),
    noteChanged: async (paths) => void noted.push(...paths),
  };
}

function deps(ws: FakeWorkspace, team: FakeTeam) {
  return {
    threePass: false,
    team,
    workspace: ws,
    checks: new FakeChecks(ws),
    log: new FakeLog(),
    progress: { step: () => {} },
    roles: RoleSettingsDto.defaults(),
    user: new FakeUser(false),
    newId: () => 'w1',
    now: () => 0,
    today: () => '2026-10-25',
    badge: '[personal]',
    requireClean: true,
  };
}

function service(
  ws: FakeWorkspace,
  team: FakeTeam,
  checks: ChecksPort,
  log = new FakeLog(),
  user: UserPort = new FakeUser(false),
  progress: ProgressPort = { step: () => {} },
  threePass = false,
  carried?: ReadonlyMap<string, string>,
) {
  return new MinimalLoopService({
    threePass,
    ...(carried !== undefined ? { carried } : {}),
    team,
    workspace: ws,
    checks,
    log,
    progress,
    roles: RoleSettingsDto.defaults(),
    user,
    newId: () => 'w1',
    now: () => 0,
    today: () => '2026-10-25',
    badge: '[personal]',
    requireClean: true,
  });
}

describe('MinimalLoopService', () => {
  it('커밋하지 않은 변경이 있으면 시작하지 않는다', async () => {
    const ws = new FakeWorkspace(['src/a.ts']);
    const team = new FakeTeam(ws, {});
    await expect(service(ws, team, new FakeChecks(ws)).run('할인')).rejects.toThrow(DomainError);
    expect(team.calls).toEqual([]);
  });

  it('깨끗할 필요가 없게 정하면 커밋하지 않은 변경 위에서 일하고 그 파일을 결과에 남긴다', async () => {
    const ws = new FakeWorkspace(['README.md']);
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const steps: string[] = [];
    const loop = new MinimalLoopService({ ...deps(ws, team), requireClean: false, progress: { step: (m: string) => steps.push(m) } });
    const outcome = await loop.run('Money에 할인 추가');
    expect(outcome.status).toBe('complete');
    expect(outcome.userFiles).toEqual(['README.md']);
    expect(outcome.mixedFiles).toEqual([]);
    expect(steps.some((m) => m.includes('커밋하지 않은 변경 1개'))).toBe(true);
  });

  it('Red가 유효하면 구현 팀원을 부르고 검증이 통과하면 완료', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const log = new FakeLog();
    const outcome = await service(ws, team, new FakeChecks(ws), log).run('Money에 할인 추가');
    expect(team.calls).toEqual(['intake', 'tester', 'implementer']);
    expect(outcome.status).toBe('complete');
    expect(outcome.implementerAttempts).toBe(1);
    expect(outcome.usage.haiku.calls).toBe(2);
    expect(outcome.guide.toMarkdown()).toContain('src/money.ts:3');
    expect(outcome.logDir).toBe('/runs/x');
    expect(log.labels).toEqual(['baseline', 'red-1', 'green-1']);
  });

  it('구현 시도는 바뀐 곳 관련 검사만 돌리고, 통과하면 리뷰 직전에 전체 검사를 한 번만 돌린다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const checks = new FakeChecks(ws);
    checks.quick = () => [{ name: 'tests', status: 'pass', failures: [], command: 'vitest related', summary: '관련 테스트 통과' }];
    const log = new FakeLog();
    const outcome = await service(ws, team, checks, log).run('Money에 할인 추가');
    expect(outcome.status).toBe('complete');
    expect(checks.quickRuns).toEqual([['src/money.ts']]);
    expect(checks.suiteRuns).toBe(2); // 기준 검사 + 리뷰 직전 전체 검사
    expect(log.labels).toEqual(['baseline', 'red-1', 'quick-1', 'green-1']);
  });

  it('좁힌 검사가 실패하면 전체 검사를 돌리지 않고 다시 고친다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const checks = new FakeChecks(ws);
    checks.quick = () => [{ name: 'tests', status: 'fail', failures: ['cart total'], command: 'vitest related', summary: '실패', detail: 'cart total: boom' }];
    const log = new FakeLog();
    await service(ws, team, checks, log).run('Money에 할인 추가');
    expect(checks.suiteRuns).toBe(1); // 기준 검사뿐
    expect(log.labels).toEqual(expect.arrayContaining(['quick-1']));
    expect(log.labels).not.toContain('green-1');
  });

  it('좁힌 검사는 통과했는데 전체 검사에서 새 실패가 나오면 그 실패로 다시 고친다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement, implement] });
    let full = 0;
    const checks = new FakeChecks(ws, () => (full++ === 0 ? [{ name: 'tests', status: 'pass', failures: [], command: 't', summary: '통과' }] : [{ name: 'tests', status: 'fail', failures: ['other'], command: 't', summary: '실패' }]));
    checks.quick = () => [{ name: 'tests', status: 'pass', failures: [], command: 'vitest related', summary: '통과' }];
    const log = new FakeLog();
    await service(ws, team, checks, log).run('Money에 할인 추가');
    expect(log.labels.slice(0, 5)).toEqual(['baseline', 'red-1', 'quick-1', 'green-1', 'quick-2']);
    expect(team.calls.filter((c) => c === 'implementer').length).toBeGreaterThanOrEqual(2);
  });

  it('다른 rauha가 같은 폴더에서 작업 중이면 팀원을 부르지 않고 알린다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()] });
    const loop = new MinimalLoopService({ ...deps(ws, team), lock: { acquire: async () => null } });
    await expect(loop.run('Money에 할인 추가')).rejects.toThrow(/다른 rauha/);
    expect(team.calls).toEqual([]);
  });

  it('작업이 끝나면 성공이든 실패든 잠금을 푼다', async () => {
    const released: string[] = [];
    const lock = { acquire: async () => ({ release: async () => void released.push('x') }) };
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    await new MinimalLoopService({ ...deps(ws, team), lock }).run('Money에 할인 추가');
    const dirty = new FakeWorkspace(['src/a.ts']);
    await expect(new MinimalLoopService({ ...deps(dirty, new FakeTeam(dirty, {})), lock }).run('할인')).rejects.toThrow(DomainError);
    expect(released).toEqual(['x', 'x']);
  });

  it('지식이 있으면 접수 팀장은 파일 목록 대신 지식 묶음을 맨 앞에 받는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    await new MinimalLoopService({ ...deps(ws, team), knowledge: fakeKnowledge([]) }).run('Money에 할인 추가');
    const message = team.log.find((c) => c.role === 'intake')!.message;
    expect(message).toContain('<repo_knowledge repo="shop"');
    expect(message).not.toContain('<project_files>');
    expect(message.indexOf('<repo_knowledge')).toBeLessThan(message.indexOf('<request>'));
  });

  it('결과에 작업 기준 커밋을 남기고, 끝나면 바뀐 파일을 지식에 알린다', async () => {
    const noted: string[] = [];
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const outcome = await new MinimalLoopService({ ...deps(ws, team), knowledge: fakeKnowledge(noted) }).run('Money에 할인 추가');
    expect(outcome.basis).toBe('main (a1b2c3d)');
    expect(outcome.guide.toMarkdown()).toContain('작업 기준: main (a1b2c3d)');
    expect(noted.sort()).toEqual(['src/money.spec.ts', 'src/money.ts']);
  });

  it('테스트 팀원은 접수 팀장이 고른 파일의 현재 내용을 받는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake({ readFirst: ['src/money.ts'] })], tester: [writeTest], implementer: [implement] });
    await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(team.log.find((c) => c.role === 'tester')!.message).toContain('<file path="src/money.ts">\n1\tv1\n</file>');
  });

  it('팀원은 rauha가 쓰는 검사 명령을 받아 직접 찾지 않는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    for (const role of ['tester', 'implementer'] as const) expect(team.log.find((c) => c.role === role)!.message).toContain('- tests: npm run test');
  });

  it('구현 팀원은 잠긴 테스트와 고른 파일을 부르기 직전 내용으로 받는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake({ readFirst: ['src/money.ts'] })], tester: [writeTest], implementer: [implement] });
    await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    const message = team.log.find((c) => c.role === 'implementer')!.message;
    expect(message).toContain('<file path="src/money.spec.ts">\n1\ttest\n</file>');
    expect(message).toContain('<file path="src/money.ts">');
  });

  it('리뷰어는 바뀐 파일의 지금 내용을 받는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, {
      intake: [() => intake()],
      tester: [writeTest],
      implementer: [implement],
      reviewer: [() => ({ verdict: 'pass', summary: '문제 없음', issues: [] })],
    });
    await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), { step: () => {} }, true).run('Money에 할인 추가');
    expect(team.log.find((c) => c.role === 'reviewer')!.message).toContain('<file path="src/money.ts">\n1\tv2\n</file>');
  });

  it('팀원을 부를 때 진행 알림에 어느 팀원인지 함께 알린다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const steps: [string, MemberRole | undefined][] = [];
    await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), {
      step: (message, role) => steps.push([message, role]),
    }).run('Money에 할인 추가');
    expect(steps.filter(([, role]) => role !== undefined).map(([, role]) => role)).toEqual(['intake', 'tester', 'implementer']);
    expect(steps.find(([m]) => m.startsWith('검증 묶음'))?.[1]).toBeUndefined();
  });

  it('진행 알림에는 모델 이름을 넣지 않는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const steps: string[] = [];
    await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), { step: (message) => steps.push(message) }).run('Money에 할인 추가');
    expect(steps).toContain('팀장 접수 작업 중…');
    for (const step of steps) expect(step).not.toMatch(/haiku|sonnet|opus/);
  });

  it('주니어가 두 번 실패하면 시니어(sonnet)가 실패 요약을 받아 이어서 하고 완료된다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWrong, implementWrong, implement] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    const implementers = team.log.filter((c) => c.role === 'implementer');
    expect(implementers.map((c) => c.tier)).toEqual(['haiku', 'haiku', 'sonnet']);
    expect(implementers[2]!.message).toContain('<handoff>');
    expect(implementers[2]!.message).toContain('<escalation>');
    expect(implementers[2]!.message).toContain('<last_failure>');
    expect(implementers[1]!.message).not.toContain('<escalation>');
    expect(outcome.status).toBe('complete');
    expect(outcome.escalated).toBe(true);
    expect(outcome.finalTier).toBe('sonnet');
  });

  it('시니어도 실패하면 needs-support로 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWrong] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(team.calls.filter((r) => r === 'implementer')).toHaveLength(3);
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'needs-support', escalated: true });
  });

  it('3단 범위는 시니어가 처음 실패해도 멈추지 않고 지원 요청을 건너뛰고 다시 시도하다 사다리를 다 오르면 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWrong] });
    const steps: string[] = [];
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), { step: (m: string) => steps.push(m) }, true).run('Money에 할인 추가');
    const tiers = team.log.filter((c) => c.role === 'implementer').map((c) => c.tier);
    expect(tiers).toEqual(['haiku', 'haiku', 'sonnet', 'sonnet', 'sonnet']);
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'escalation-exhausted' });
    expect(steps.some((m) => m.includes('원인부터'))).toBe(true);
  });

  it('시니어 시도에서 잠긴 테스트를 고치면 쓰기 거부로 실패 처리한다', async () => {
    const ws = new FakeWorkspace();
    const touchLocked: Script = (_c, w) => {
      w.files.set('src/money.spec.ts', 'weakened');
      w.files.set('src/money.ts', 'v2');
      return { ...report, explanation };
    };
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWrong, implementWrong, touchLocked] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(outcome.stopReason).toBe('needs-support');
  });

  it('승격이 없으면 escalated는 false이고 마지막 구현 모델은 haiku', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(outcome).toMatchObject({ escalated: false, finalTier: 'haiku' });
  });

  it('앞 요청이 남긴 미커밋 변경은 이번 요청의 테스트 팀원 변경으로 세지 않는다', async () => {
    const ws = new FakeWorkspace(['src/cart.ts']);
    ws.files.set('src/cart.ts', 'prev');
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), { step: () => {} }, false, new Map([['src/cart.ts', 'prev']])).run('Money에 할인 추가');
    expect(outcome.status).toBe('complete');
    expect(outcome.changedInRun.map((c) => c.path).sort()).toEqual(['src/money.spec.ts', 'src/money.ts']);
    expect(outcome.guide.toMarkdown()).not.toContain('src/cart.ts');
    expect(outcome.snapshotAfter.get('src/cart.ts')).toBe('prev');
  });

  it('구현 팀원이 턴 한도로 멈추면 결과와 안내서에 그 이유를 담고 달러는 보이지 않는다', async () => {
    const ws = new FakeWorkspace();
    const steps: string[] = [];
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWrong] });
    const run = team.run.bind(team);
    team.run = async (call) => {
      const result = await run(call);
      return call.role !== 'implementer' ? result : { ...result, output: null, usage: { ...result.usage, turns: 30, endReason: 'error_max_turns' } };
    };
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), { step: (m) => steps.push(m) }).run('Money에 할인 추가');
    expect(outcome.status).toBe('stopped');
    expect(outcome.memberStop).toContain('30턴');
    expect(outcome.memberStop).toContain('턴 한도');
    expect(outcome.guide.stopMessage()).toContain('턴 한도');
    expect(steps.some((s) => s.includes('턴 한도'))).toBe(true);
    expect(`${outcome.guide.toMarkdown()}${outcome.memberStop}`).not.toContain('$');
  });

  it('도구 거절로 output이 비면 거절된 도구를 멈춘 이유에 담는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWrong] });
    const run = team.run.bind(team);
    team.run = async (call) => {
      const result = await run(call);
      return call.role !== 'implementer' ? result : { ...result, output: null, usage: { ...result.usage, denials: ['Bash: rm -rf x'] } };
    };
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(outcome.memberStop).toContain('Bash 호출 1번');
  });

  it('팀원이 끝까지 마친 작업은 멈춘 이유가 없다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(outcome.memberStop).toBeNull();
  });

  it('구독 사용 한도에 걸리면 더 부르지 않고 바로 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const steps: string[] = [];
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest] }, 'tester');
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(false), { step: (m) => steps.push(m) }).run('Money에 할인 추가');
    expect(team.calls).toEqual(['intake', 'tester']);
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'usage-limit' });
    expect(steps.some((s) => s.includes('resets 5:40pm'))).toBe(true);
    expect(outcome.guide.toMarkdown()).toContain('사용 한도');
  });

  it('로그인이 안 돼 있으면 더 부르지 않고 로그인하라고 알리며 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()] }, 'intake', 'login');
    const outcome = await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(team.calls).toEqual(['intake']);
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'login-required' });
    expect(outcome.guide.toMarkdown()).toContain('rauha login');
  });

  it('사용자가 멈추면 다시 부르지 않고 바로 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest] }, 'tester', 'cancelled');
    const outcome = await service(ws, team, new FakeChecks(ws)).run('Money에 할인 추가');
    expect(team.calls).toEqual(['intake', 'tester']);
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'cancelled' });
    expect(outcome.guide.stopMessage()).toContain('직접 멈췄');
  });

  it('접수에서 한도에 걸려도 다시 접수하지 않고 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()] }, 'intake');
    const outcome = await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(team.calls).toEqual(['intake']);
    expect(outcome.stopReason).toBe('usage-limit');
  });

  it('L급(민감) 접수도 돌려보내지 않고 테스트 팀원부터 일을 시작한다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake({ sensitive: true })], tester: [writeTest], implementer: [implement] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('결제 바꿔줘');
    expect(team.calls.slice(0, 2)).toEqual(['intake', 'tester']);
    expect(outcome.stopReason).not.toBe('too-large');
  });

  it('수용 기준이 모자라면 접수를 한 번 다시 받는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, {
      intake: [() => intake({ acceptance: [{ kind: 'happy', text: 'a' }] }), () => intake()],
      tester: [writeTest],
      implementer: [implement],
    });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(team.calls.filter((r) => r === 'intake')).toHaveLength(2);
    expect(outcome.status).toBe('complete');
  });

  it('접수가 두 번 실패하면 intake-failed로 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => ({ nonsense: true })] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('?');
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'intake-failed' });
  });

  it('테스트를 만들지 않은 Red는 무효이고 다시 맡긴다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [() => report, writeTest], implementer: [implement] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(team.calls).toEqual(['intake', 'tester', 'tester', 'implementer']);
    expect(outcome.status).toBe('complete');
  });

  it('잠긴 테스트를 바꾼 구현은 실패로 치고, 시니어까지 실패하면 needs-support로 멈춘다', async () => {
    const ws = new FakeWorkspace();
    const cheat: Script = (_c, w) => {
      w.files.set('src/money.ts', 'v2');
      w.files.set('src/money.spec.ts', `cheat-${Math.random()}`);
      return { ...report, explanation };
    };
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [cheat] });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(outcome).toMatchObject({ status: 'stopped', stopReason: 'needs-support', implementerAttempts: 3 });
    expect(outcome.guide.toMarkdown()).toContain('되돌리려면');
  });

  it('기준선에서 이미 깨진 테스트는 Green을 막지 않는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implement] });
    const broken = () => [{ name: 'tests', status: 'fail', failures: ['old'], command: 'npm run test', summary: '실패 1' }] as CheckResult[];
    const outcome = await service(ws, team, new FakeChecks(ws, broken)).run('할인');
    expect(outcome.status).toBe('complete');
    expect(outcome.guide.toMarkdown()).toContain('원래 깨져 있던 것: old');
  });

  it('구현 팀원에게는 잠긴 테스트 쓰기를 허락하지 않는다', async () => {
    const ws = new FakeWorkspace();
    let allowed: boolean | null = null;
    const team = new FakeTeam(ws, {
      intake: [() => intake()],
      tester: [writeTest],
      implementer: [
        (call, w) => {
          allowed = call.canWrite('src/money.spec.ts');
          return implement(call, w);
        },
      ],
    });
    await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(allowed).toBe(false);
  });
});

describe('MinimalLoopService — 해석이 갈리는 요청과 재시도 정보', () => {
  const assumption = { question: '원 미만은 무엇을 버리나', chosen: '할인 후 금액', alternatives: ['할인액'], needsUser: true };

  it('사용자가 꼭 정해야 하는 해석이 아니면 묻지 않고 추천대로 진행해 안내서에 알아서 정한 해석으로 남긴다', async () => {
    const ws = new FakeWorkspace();
    const optional = { ...assumption, needsUser: false };
    const team = new FakeTeam(ws, { intake: [() => intake({ assumptions: [optional] })], tester: [writeTest], implementer: [implement] });
    const user = new FakeUser(true);
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), user).run('할인');
    expect(user.asked).toEqual([]);
    expect(team.calls.filter((r) => r === 'intake')).toHaveLength(1);
    expect(outcome.guide.toMarkdown()).toContain('알아서 정한 해석');
    expect(outcome.guide.toMarkdown()).toContain('원 미만은 무엇을 버리나 → 할인 후 금액');
  });

  it('꼭 물어볼 것과 아닌 것이 섞이면 꼭 물어볼 것만 묻는다', async () => {
    const ws = new FakeWorkspace();
    const other = { question: '빈 입력은', chosen: '0원', alternatives: ['오류'], needsUser: false };
    const team = new FakeTeam(ws, { intake: [() => intake({ assumptions: [other, assumption] })], tester: [writeTest], implementer: [implement] });
    const user = new FakeUser(true, [0]);
    await service(ws, team, new FakeChecks(ws), new FakeLog(), user).run('할인');
    expect(user.asked).toEqual(['원 미만은 무엇을 버리나']);
  });

  it('해석이 갈리면 사용자에게 묻고, 다른 해석을 고르면 확정해서 접수를 다시 받는다', async () => {
    const ws = new FakeWorkspace();
    const messages: string[] = [];
    const team = new FakeTeam(ws, {
      intake: [
        (c) => {
          messages.push(c.userMessage);
          return intake({ assumptions: [assumption] });
        },
        (c) => {
          messages.push(c.userMessage);
          return intake({ title: '확정된 할인', assumptions: [] });
        },
      ],
      tester: [writeTest],
      implementer: [implement],
    });
    const user = new FakeUser(true, [1]);
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), user).run('할인');
    expect(user.asked).toEqual(['원 미만은 무엇을 버리나']);
    expect(messages[1]).toContain('<clarifications>');
    expect(messages[1]).toContain('원 미만은 무엇을 버리나 → 할인액');
    expect(outcome.title).toBe('확정된 할인');
    expect(outcome.guide.toMarkdown()).toContain('원 미만은 무엇을 버리나 → 할인액 (직접 확인함)');
  });

  it('추천 해석을 그대로 고르면 접수를 다시 받지 않는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake({ assumptions: [assumption] })], tester: [writeTest], implementer: [implement] });
    await service(ws, team, new FakeChecks(ws), new FakeLog(), new FakeUser(true, [0])).run('할인');
    expect(team.calls.filter((r) => r === 'intake')).toHaveLength(1);
  });

  it('물어볼 화면이 없으면 추천 해석으로 진행하고 안내서에 알아서 정한 해석으로 남긴다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake({ assumptions: [assumption] })], tester: [writeTest], implementer: [implement] });
    const user = new FakeUser(false);
    const outcome = await service(ws, team, new FakeChecks(ws), new FakeLog(), user).run('할인');
    expect(user.asked).toEqual([]);
    expect(outcome.guide.toMarkdown()).toContain('알아서 정한 해석');
    expect(outcome.guide.toMarkdown()).toContain('원 미만은 무엇을 버리나 → 할인 후 금액');
  });

  it('접수 팀장에게 프로젝트 파일 목록과 오늘 날짜를 준다', async () => {
    const ws = new FakeWorkspace();
    let message = '';
    const team = new FakeTeam(ws, {
      intake: [
        (c) => {
          message = c.userMessage;
          return intake({ sensitive: true });
        },
      ],
    });
    await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(message).toContain('<today>2026-10-25</today>');
    expect(message).toContain('<project_files>\nsrc/money.ts\n</project_files>');
  });

  it('구현 재시도에는 지난 실패의 실제 메시지를 넘긴다', async () => {
    const ws = new FakeWorkspace();
    const second: string[] = [];
    const team = new FakeTeam(ws, {
      intake: [() => intake()],
      tester: [writeTest],
      implementer: [
        () => ({ ...report, explanation }),
        (c, w) => {
          second.push(c.userMessage);
          return implement(c, w);
        },
      ],
    });
    const outcome = await service(ws, team, new FakeChecks(ws)).run('할인');
    expect(outcome.status).toBe('complete');
    expect(second[0]).toContain('<last_failure>');
    expect(second[0]).toContain('discount: expected 9000');
  });
});

describe('MinimalLoopService — 사실 기반 3단 작업', () => {
  const blank = { path: null, line: null, quote: null, name: null, url: null, text: null };
  const CODE = 'v2 export function discount(rate) { return amount * rate }';
  const implementCode: Script = (_c, ws) => {
    ws.files.set('src/money.ts', CODE);
    return { ...report, explanation };
  };
  const implementFixed: Script = (_c, ws) => {
    ws.files.set('src/money.ts', 'v2 fixed export function discount(rate) { return Math.floor(amount * (100 - rate) / 100) }');
    return { ...report, explanation };
  };
  const implementWithGuess: Script = (_c, ws) => {
    ws.files.set('src/money.ts', CODE);
    return { ...report, explanation: { ...explanation, facts: [{ claim: '응답 필드 이름은 email이다', evidence: [] }] } };
  };
  const pass = () => ({ verdict: 'pass', summary: '문제 없음', issues: [] });
  const verifiedIssue = { problem: '할인율을 곱하기만 해서 10%가 10배가 된다', path: 'src/money.ts', line: 1, evidence: [{ ...blank, kind: 'code', path: 'src/money.ts', line: 1, quote: 'return amount * rate' }] };
  const guessIssue = { problem: '함수 이름이 어색하다', path: null, line: null, evidence: [] };
  const changes = (...issues: unknown[]) => () => ({ verdict: 'changes', summary: '고칠 것 있음', issues });
  const run = (team: FakeTeam, ws: FakeWorkspace, user: UserPort = new FakeUser(false), threePass = true) =>
    service(ws, team, new FakeChecks(ws), new FakeLog(), user, { step: () => {} }, threePass).run('Money에 할인 추가');

  it('검증을 통과하면 리뷰어가 보고, 문제없으면 완료한다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementCode], reviewer: [pass] });
    const outcome = await run(team, ws);
    expect(team.calls).toEqual(['intake', 'tester', 'implementer', 'reviewer']);
    expect(team.log.find((c) => c.role === 'reviewer')!.tier).toBe('sonnet');
    expect(outcome.status).toBe('complete');
    expect(outcome.facts.reviewRounds).toBe(1);
  });

  it('근거가 확인된 리뷰 지적이 있으면 2차 구현을 하고, 다시 리뷰를 받는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementCode, implementFixed], reviewer: [changes(verifiedIssue), pass] });
    const outcome = await run(team, ws);
    expect(team.calls).toEqual(['intake', 'tester', 'implementer', 'reviewer', 'implementer', 'reviewer']);
    const second = team.log.filter((c) => c.role === 'implementer')[1]!;
    expect(second.message).toContain('<review>');
    expect(second.message).toContain('할인율을 곱하기만 해서');
    expect(outcome).toMatchObject({ status: 'complete' });
    expect(outcome.facts.reviewRounds).toBe(2);
  });

  it('근거 없는 리뷰 지적은 2차 구현을 일으키지 않고 리뷰어 추측으로 남는다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementCode], reviewer: [changes(guessIssue)] });
    const outcome = await run(team, ws);
    expect(team.calls.filter((r) => r === 'implementer')).toHaveLength(1);
    expect(outcome.status).toBe('complete');
    expect(outcome.facts.reviewerGuesses.map((c) => c.text)).toEqual(['함수 이름이 어색하다']);
  });

  it('근거 있는 지적과 없는 지적이 섞이면 근거 있는 것만 넘긴다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementCode, implementFixed], reviewer: [changes(verifiedIssue, guessIssue), pass] });
    await run(team, ws);
    const second = team.log.filter((c) => c.role === 'implementer')[1]!;
    expect(second.message).toContain('할인율을 곱하기만 해서');
    expect(second.message).not.toContain('함수 이름이 어색하다');
  });

  it('코드에 들어간 추측은 사용자에게 묻고, 틀렸다고 하면 정정을 넣어 2차 구현한다', async () => {
    const ws = new FakeWorkspace();
    const user = new FakeUser(true, [], [{ kind: 'wrong', correction: '응답 필드 이름은 mail이다' }]);
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWithGuess, implementFixed], reviewer: [pass, pass] });
    const outcome = await run(team, ws, user);
    expect(user.factsAsked).toEqual(['응답 필드 이름은 email이다']);
    const second = team.log.filter((c) => c.role === 'implementer')[1]!;
    expect(second.message).toContain('응답 필드 이름은 mail이다');
    expect(outcome.status).toBe('complete');
  });

  it('사용자가 맞다고 한 추측은 다시 묻지 않고 사실로 남는다', async () => {
    const ws = new FakeWorkspace();
    const user = new FakeUser(true, [], [{ kind: 'correct' }]);
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWithGuess], reviewer: [pass] });
    const outcome = await run(team, ws, user);
    expect(user.factsAsked).toHaveLength(1);
    expect(outcome.facts.checked.find((c) => c.kind === 'fact')?.isGuess).toBe(false);
    expect(outcome.facts.unconfirmed).toEqual([]);
  });

  it('모르겠다고 하면 추측으로 남기고 2차 구현하지 않는다', async () => {
    const ws = new FakeWorkspace();
    const user = new FakeUser(true, [], [{ kind: 'unsure' }]);
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWithGuess], reviewer: [pass] });
    const outcome = await run(team, ws, user);
    expect(team.calls.filter((r) => r === 'implementer')).toHaveLength(1);
    expect(outcome.facts.checked.find((c) => c.kind === 'fact')?.isGuess).toBe(true);
    expect(outcome.facts.unconfirmed).toEqual([]);
  });

  it('화면이 없으면 추측을 묻지 않고 확인 필요로 남긴다', async () => {
    const ws = new FakeWorkspace();
    const user = new FakeUser(false);
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementWithGuess], reviewer: [pass] });
    const outcome = await run(team, ws, user);
    expect(user.factsAsked).toEqual([]);
    expect(outcome.facts.unconfirmed.map((c) => c.text)).toEqual(['응답 필드 이름은 email이다']);
    expect(outcome.status).toBe('complete');
  });

  it('업무 지시서에 적힌 그대로 질문 → 해석 형태로 인용한 정한 해석도 근거로 인정한다', async () => {
    const ws = new FakeWorkspace();
    const assumption = { question: '버림 대상', chosen: '할인 후 금액에서 원 미만 버림 (999원 → 899원)', alternatives: ['할인액을 먼저 버림'], needsUser: true };
    const cite: Script = (_c, w) => {
      w.files.set('src/money.ts', CODE);
      const decision = { what: 'floor를 할인 후 금액에 씀', why: '정한 해석', rejected: null, evidence: [{ ...blank, kind: 'user', text: '버림 대상 → 할인 후 금액에서 원 미만 버림 (999원 → 899원)' }] };
      return { ...report, explanation: { ...explanation, decisions: [decision] } };
    };
    const team = new FakeTeam(ws, { intake: [() => intake({ assumptions: [assumption] })], tester: [writeTest], implementer: [cite], reviewer: [pass] });
    const outcome = await run(team, ws);
    expect(outcome.facts.checked.find((c) => c.kind === 'decision')?.isGuess).toBe(false);
  });

  it('--quick이면 리뷰 없이 검증 통과로 완료한다', async () => {
    const ws = new FakeWorkspace();
    const team = new FakeTeam(ws, { intake: [() => intake()], tester: [writeTest], implementer: [implementCode] });
    const outcome = await run(team, ws, new FakeUser(false), false);
    expect(team.calls).not.toContain('reviewer');
    expect(outcome.status).toBe('complete');
    expect(outcome.facts.reviewRounds).toBe(0);
  });
});
