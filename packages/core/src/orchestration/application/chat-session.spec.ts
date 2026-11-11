import { describe, expect, it, vi } from 'vitest';
import type { DesignInput, DesignResult } from '../../design/application/design.service.js';
import { Design } from '../../design/domain/design.js';
import { RepoRef } from '../../knowledge/domain/repo-ref.js';
import type { MemoryPort } from '../../memory/application/memory.port.js';
import type { MemoryEntry, MemoryNode, Recall } from '../../memory/domain/work-memory.js';
import type { CheckedClaim } from '../domain/fact-check.js';
import { LearningBook } from '../domain/learning-book.js';
import { CompanyBook } from '../domain/company-book.js';
import { SessionBudget } from '../domain/session-budget.js';
import type { AnalysisInput, AnalysisPort, AnalysisResult } from '../../analysis/application/ports.js';
import { AnalysisReach } from '../../analysis/domain/analysis-reach.js';
import { AnalysisRun } from '../../analysis/domain/analysis-run.js';
import { Blueprint } from '../../analysis/domain/blueprint.js';
import { DirectionSet } from '../../analysis/domain/direction.js';
import { Investigation } from '../../analysis/domain/investigation.js';
import { ChatSession, type RunContextBlocks } from './chat-session.js';
import { RoleSettingsDto, type MemberRole } from './dto/role-settings.dto.js';
import type { RunOutcome } from './minimal-loop.service.js';
import type { Assumption } from './dto/intake.dto.js';
import type { LearningPort, CompanyBookPort, FactAnswer, FileChange, MemberCall, MemberResult, PastCandidate, TeamMemberPort, UserPort } from './ports.js';

// ── 가짜들 ───────────────────────────────────────────────────

class FakeMemory implements MemoryPort {
  readonly nodes = new Map<string, MemoryNode>();
  readonly edges: MemoryEntry['edges'][number][] = [];
  async save(entry: MemoryEntry) {
    for (const n of entry.nodes) if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
    this.edges.push(...entry.edges);
  }
  async search(text: string, limit: number): Promise<Recall[]> {
    const words = text.split(/\s+/).filter((w) => w !== '');
    const heads = [...this.nodes.values()].filter((n) => (n.kind === 'work' || n.kind === 'question') && this.textOf(n.id).some((t) => words.some((w) => t.includes(w))));
    return heads
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((work) => ({ work, neighbors: this.edges.filter((e) => e.from === work.id && e.kind !== 'extends').map((e) => this.nodes.get(e.to)!).filter(Boolean) }));
  }
  async recent(limit: number) {
    return this.search('', limit);
  }
  private textOf(id: string): string[] {
    return [this.nodes.get(id)!.text, ...this.edges.filter((e) => e.from === id).map((e) => this.nodes.get(e.to)?.text ?? '')];
  }
}

type Script = (call: MemberCall) => unknown;

class FakeTeam implements TeamMemberPort {
  readonly calls: { role: MemberRole; message: string; signal: AbortSignal | undefined; dirs: readonly string[] | undefined; canWrite: (path: string) => boolean; tier: string }[] = [];
  readonly prepared: MemberRole[] = [];
  /** 라우터가 이 약속이 풀릴 때까지 답하지 않게 한다(동시에 도는지 보려고). */
  routerGate: Promise<void> = Promise.resolve();
  /** 역할별로 호출이 쓴 도구(없으면 어댑터가 모으지 않은 것) */
  tools: Partial<Record<MemberRole, { name: string; count: number }[]>> = {};
  constructor(
    private readonly scripts: Partial<Record<MemberRole, Script[]>>,
    private readonly limitOn: MemberRole | null = null,
    private readonly blockReason: 'usage-limit' | 'login' = 'usage-limit',
  ) {}
  prepare(call: Omit<MemberCall, 'userMessage' | 'signal'>): void {
    this.prepared.push(call.role);
  }
  async run(call: MemberCall): Promise<MemberResult> {
    this.calls.push({ role: call.role, message: call.userMessage, signal: call.signal, dirs: call.additionalDirectories, canWrite: call.canWrite, tier: call.setting.tier });
    if (call.role === 'router') await this.routerGate;
    if (call.role === this.limitOn) {
      const limited = "You've hit your session limit · resets 9:40pm";
      return { output: null, error: limited, blocked: { reason: this.blockReason, message: limited }, fetched: [], usage: { model: call.setting.tier, durationMs: 1, costUsd: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, denials: [], endReason: 'error' } };
    }
    const queue = this.scripts[call.role] ?? [];
    const script = queue.length > 1 ? (queue.shift() as Script) : queue[0];
    return {
      output: script ? script(call) : null,
      error: null,
      usage: { model: call.setting.tier, durationMs: 5, costUsd: 0.002, turns: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, denials: [], endReason: 'success', ...(this.tools[call.role] !== undefined ? { tools: this.tools[call.role] } : {}) },
      fetched: [],
    };
  }
}

class FakeUser implements UserPort {
  readonly pastAsked: PastCandidate[][] = [];
  constructor(
    readonly interactive: boolean,
    private readonly pick: (candidates: readonly PastCandidate[]) => string | null = (c) => c[0]?.id ?? null,
  ) {}
  async choose(_a: Assumption) {
    return 0;
  }
  async confirmFact(_c: CheckedClaim): Promise<FactAnswer> {
    return { kind: 'unsure' };
  }
  async pickPast(candidates: readonly PastCandidate[]) {
    this.pastAsked.push([...candidates]);
    return this.pick(candidates);
  }
}

const blank = { path: null, line: null, quote: null, name: null, url: null, text: null };

function outcome(over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    status: 'complete',
    stopReason: null,
    title: 'Money에 퍼센트 할인 discount 추가',
    calls: 4,
    implementerAttempts: 1,
    costUsd: 0.05,
    durationMs: 60_000,
    usage: { haiku: { calls: 2, tokens: 100 }, sonnet: { calls: 2, tokens: 50 }, opus: { calls: 0, tokens: 0 } },
    escalated: false,
    finalTier: 'haiku',
    facts: {
      checked: [{ kind: 'decision', text: 'Math.floor를 할인 후 금액에 씀 — 정한 해석', evidence: [], verified: [{ kind: 'user', text: 'x' }], isGuess: false }],
      reviewerGuesses: [],
      unconfirmed: [],
      reviewRounds: 1,
      reviewMissing: false,
    },
    changedInRun: [{ path: 'src/money.ts', kind: 'modified' }],
    snapshotAfter: new Map([['src/money.ts', 'modified:h1']]),
    lockedTests: ['src/money.spec.ts'],
    assumptions: [{ question: '버림 대상', chosen: '할인 후 금액에서 버림', confirmed: false }],
    explanation: null,
    logDir: '/runs/x',
    basis: null,
    guide: { toMarkdown: () => '# 안내서', toTerminal: () => '# 안내서', stopMessage: () => null } as unknown as RunOutcome['guide'],
    ...over,
  };
}

class FakeLoops {
  readonly runs: { request: string; context: RunContextBlocks; carried: ReadonlyMap<string, string> }[] = [];
  constructor(private readonly outcomes: RunOutcome[] = [outcome()]) {}
  newLoop = (carried: ReadonlyMap<string, string>) => ({
    run: async (request: string, context: RunContextBlocks) => {
      this.runs.push({ request, context, carried });
      return this.outcomes.length > 1 ? (this.outcomes.shift() as RunOutcome) : this.outcomes[0]!;
    },
  });
}

const route = (mode: 'work' | 'question' | 'task' | 'feature' | 'ops' | 'debug' | 'risk' | 'ideate' | 'company' | 'launch', refersToPast = false, pastQuery: string | null = null, extra: { department?: string; member?: string | null; depth?: 'light' | 'deep'; reach?: 'investigate' | 'compare' | 'plan' } = {}) => () => ({ mode, refersToPast, pastQuery, ...extra });

type SessionParts = { team: FakeTeam; loops?: FakeLoops; memory?: FakeMemory; user?: UserPort; files?: Record<string, string>; steps?: string[]; changes?: FileChange[]; budget?: SessionBudget; company?: CompanyBookPort; learning?: LearningPort };

function session(p: SessionParts) {
  return ChatSession.start(sessionDeps(p));
}

function sessionDeps(p: SessionParts) {
  let clock = Date.parse('2026-10-25T07:00:00.000Z');
  let id = 0;
  return {
    newLoop: (p.loops ?? new FakeLoops()).newLoop,
    team: p.team,
    workspace: { readFile: async (path: string) => p.files?.[path] ?? null, reviewChanges: async () => p.changes ?? [] },
    memory: p.memory ?? new FakeMemory(),
    user: p.user ?? new FakeUser(true),
    progress: { step: (message: string) => void p.steps?.push(message) },
    roles: RoleSettingsDto.defaults(),
    now: () => (clock += 60_000),
    newId: () => `id${(id += 1)}`,
    today: () => '2026-10-25',
    nowText: () => '2026년 10월 25일 일요일 오후 11:40 (Asia/Seoul)',
    ...(p.budget !== undefined ? { budget: () => p.budget! } : {}),
    ...(p.company !== undefined ? { company: p.company } : {}),
    ...(p.learning !== undefined ? { learning: p.learning } : {}),
  };
}

// ── 테스트 ───────────────────────────────────────────────────

describe('ChatSession — 질문', () => {
  it('답변 팀원에게 지금 날짜와 시각을 알려 준다 (시계를 못 읽는다며 답을 피하지 않게)', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '오후 11:40입니다.', claims: [{ text: '지금은 오후 11:40', evidence: [] }] })] });
    await session({ team }).handle('지금은 몇시야?');
    const message = team.calls.find((c) => c.role === 'answerer')!.message;
    expect(message).toContain('<now>2026년 10월 25일 일요일 오후 11:40 (Asia/Seoul)</now>');
  });

  it('라우터·답변 팀원은 누구인지·어떤 모델인지 없이 그냥 작업 중이라고 알린다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [{ text: 'a', evidence: [] }] })] });
    const steps: string[] = [];
    await session({ team, steps }).handle('이거 뭐야?');
    expect(steps).toEqual(['작업 중…', '작업 중…']);
  });

  it('질문이면 테스트·구현 없이 답하고, 근거가 확인된 주장과 추측을 나눈다', async () => {
    const team = new FakeTeam({
      router: [route('question')],
      answerer: [
        () => ({
          answer: 'Money.discount는 할인 후 금액을 버립니다.',
          claims: [
            { text: 'floor를 쓴다', evidence: [{ ...blank, kind: 'code', path: 'src/money.ts', line: 3, quote: 'Math.floor(this.amount * rate)' }] },
            { text: '예전엔 round였다', evidence: [] },
          ],
        }),
      ],
    });
    const loops = new FakeLoops();
    const turn = await session({ team, loops, files: { 'src/money.ts': 'return Money.of(Math.floor(this.amount * rate))' } }).handle('discount는 왜 floor야?');
    expect(team.calls.map((c) => c.role)).toEqual(['router', 'answerer']);
    expect(loops.runs).toEqual([]);
    expect(turn.kind).toBe('answer');
    if (turn.kind !== 'answer') return;
    expect(turn.checked.map((c) => c.isGuess)).toEqual([false, true]);
  });

  it('왜 이렇게 짰냐는 질문에는 기억된 결정을 근거로 답한다', async () => {
    const memory = new FakeMemory();
    const team = new FakeTeam({
      router: [route('work'), route('question')],
      answerer: [() => ({ answer: '정한 해석 때문입니다.', claims: [{ text: '할인 후 금액에서 버리기로 정했다', evidence: [{ ...blank, kind: 'record', text: 'Math.floor를 할인 후 금액에 씀' }] }] })],
    });
    const chat = session({ team, memory });
    await chat.handle('Money에 할인 넣어줘');
    const turn = await chat.handle('discount 왜 이렇게 짰어?');
    const message = team.calls.filter((c) => c.role === 'answerer').at(-1)!.message;
    expect(message).toContain('<memory>');
    expect(message).toContain('Math.floor를 할인 후 금액에 씀');
    expect(turn.kind === 'answer' && turn.checked[0]!.isGuess).toBe(false);
  });

  it('근거가 필요 없는 짧은 질문은 근거 없이 답해도 된다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '안녕하세요.', claims: [] })] });
    const turn = await session({ team }).handle('안녕');
    expect(turn).toMatchObject({ kind: 'answer', answer: '안녕하세요.', checked: [] });
  });
});

describe('ChatSession — 설계 대화', () => {
  const task = (id: string, dependsOn: string[] = []) => ({ id, title: `작업 ${id}`, scope: [`src/${id}/**`], acceptance: [`${id}는 10% 쿠폰이 10,000원을 9,000원으로`], dependsOn });
  const designOf = (tasks = [task('t1'), task('t2', ['t1'])]) =>
    Design.of({
      title: '쿠폰 할인',
      purpose: '쿠폰 적용',
      goals: [],
      nonGoals: [],
      scenarios: [{ given: '10,000원', when: '10% 쿠폰', then: '9,000원' }],
      decisions: [{ what: '원 미만 버림', by: 'rauha' }],
      tasks,
      risks: [],
      architecture: { overview: 'Coupon 값 객체', components: [{ name: 'Coupon', responsibility: '할인 계산', location: 'src/t1/coupon.ts' }], flow: [], alternatives: [] },
      edgeCases: [{ case: '할인율 0%', handling: '거절', task: tasks[0]?.id ?? 't1' }],
    });
  const cost = { calls: 3, costUsd: 0.05, tier: 'sonnet' as const };
  const approved = (design = designOf()): DesignResult => ({ kind: 'approved', design, path: 'C:/designs/a.md', cost });
  const designerThat = (result: DesignResult) => {
    const inputs: DesignInput[] = [];
    return { inputs, port: { run: async (input: DesignInput) => (inputs.push(input), result) } };
  };
  const talking = new FakeUser(true);
  Object.assign(talking, { discuss: async () => '네', approve: async () => ({ kind: 'approve' }) });
  const withDesigner = (p: SessionParts, designer: ReturnType<typeof designerThat>['port'], user: UserPort = talking) => ChatSession.start({ ...sessionDeps({ ...p, user }), designer, repoName: 'shop-api' });
  const stopped = () => outcome({ status: 'stopped', stopReason: 'halted' });

  it('기능 요청이면 설계 대화를 하고, 승인된 설계의 작업을 순서대로 최소 루프에 넣는다', async () => {
    const loops = new FakeLoops([outcome(), outcome()]);
    const designer = designerThat(approved());
    const team = new FakeTeam({ router: [route('feature')] });
    const turn = await withDesigner({ team, loops }, designer.port).handle('쿠폰 기능 만들어줘');
    expect(loops.runs.map((r) => r.request.split('\n')[0])).toEqual(['작업 t1', '작업 t2']);
    expect(loops.runs[0]!.context.design).toContain('<design');
    expect(loops.runs[0]!.context.design).toContain('C:/designs/a.md');
    expect(loops.runs[1]!.context.design).toContain('작업 t2');
    expect(turn).toMatchObject({ kind: 'design', title: '쿠폰 할인', path: 'C:/designs/a.md' });
    if (turn.kind === 'design') expect(turn.tasks.map((t) => t.status)).toEqual(['complete', 'complete']);
  });

  it('승인된 설계의 목적과 정한 해석(누가 정했는지)을 기억에 남긴다 ("그 기능 왜 이렇게 만들었어?"에 설계의 이유로 답하려고)', async () => {
    const memory = new FakeMemory();
    await withDesigner({ team: new FakeTeam({ router: [route('feature')] }), loops: new FakeLoops([outcome(), outcome()]), memory }, designerThat(approved()).port).handle('쿠폰 기능 만들어줘');
    const texts = [...memory.nodes.values()].map((n) => n.text);
    expect(texts.some((t) => t.includes('원 미만 버림') && t.includes('rauha가 정함'))).toBe(true);
  });

  it('설계 팀원은 저장소 지식·기억·앞 대화를 받는다', async () => {
    const knowledge = { current: async () => ({ block: '<repo_knowledge repo="shop-api" basis="main (a1b2c3d)">요약</repo_knowledge>', basis: RepoRef.of({ branch: 'main', commit: 'a1b2c3d'.padEnd(40, '0'), dirty: false }) }), noteChanged: async () => undefined };
    const designer = designerThat(approved());
    const team = new FakeTeam({ router: [route('feature')] });
    await ChatSession.start({ ...sessionDeps({ team, loops: new FakeLoops([outcome(), outcome()]), user: talking }), designer: designer.port, knowledge, repoName: 'shop-api' }).handle('쿠폰 기능 만들어줘');
    expect(designer.inputs[0]).toMatchObject({ request: '쿠폰 기능 만들어줘', repo: 'shop-api', basis: 'main (a1b2c3d)' });
    expect(designer.inputs[0]!.knowledge).toContain('<repo_knowledge');
  });

  it('앞 작업이 멈추면 그것에 의존하는 작업은 하지 않고, 의존하지 않는 작업은 계속한다', async () => {
    const design = designOf([task('t1'), task('t2', ['t1']), task('t3')]);
    const loops = new FakeLoops([stopped(), outcome()]);
    const turn = await withDesigner({ team: new FakeTeam({ router: [route('feature')] }), loops }, designerThat(approved(design)).port).handle('쿠폰 기능 만들어줘');
    expect(loops.runs.map((r) => r.request.split('\n')[0])).toEqual(['작업 t1', '작업 t3']);
    if (turn.kind === 'design') expect(turn.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['t1:stopped', 't2:skipped', 't3:complete']);
  });

  it('설계를 그만두면 작업하지 않고 알린다', async () => {
    const loops = new FakeLoops();
    const turn = await withDesigner({ team: new FakeTeam({ router: [route('feature')] }), loops }, designerThat({ kind: 'cancelled', cost }).port).handle('쿠폰 기능 만들어줘');
    expect(loops.runs).toEqual([]);
    expect(turn.kind).toBe('notice');
  });

  it('설계를 만들지 못하면 이유를 알린다', async () => {
    const turn = await withDesigner({ team: new FakeTeam({ router: [route('feature')] }) }, designerThat({ kind: 'failed', message: '순환 의존', cost }).port).handle('쿠폰 기능 만들어줘');
    expect(turn).toMatchObject({ kind: 'notice' });
    if (turn.kind === 'notice') expect(turn.message).toContain('순환 의존');
  });

  it('구독 한도나 로그인 문제로 막히면 그대로 알린다', async () => {
    const turn = await withDesigner({ team: new FakeTeam({ router: [route('feature')] }) }, designerThat({ kind: 'blocked', block: { reason: 'login', message: 'x' }, cost }).port).handle('쿠폰 기능 만들어줘');
    expect(turn).toMatchObject({ kind: 'blocked', reason: 'login' });
  });

  it('화면이 없으면(-p) 설계 대화 없이 바로 작업으로 진행한다', async () => {
    const loops = new FakeLoops();
    const designer = designerThat(approved());
    const turn = await withDesigner({ team: new FakeTeam({ router: [route('feature')] }), loops }, designer.port, new FakeUser(false)).handle('쿠폰 기능 만들어줘');
    expect(designer.inputs).toEqual([]);
    expect(loops.runs).toHaveLength(1);
    expect(turn.kind).toBe('work');
  });

  it('/design은 라우터를 거치지 않고 바로 설계부터 한다', async () => {
    const team = new FakeTeam({});
    const designer = designerThat(approved());
    await withDesigner({ team, loops: new FakeLoops([outcome(), outcome()]) }, designer.port).handle('쿠폰 기능 만들어줘', [], 'design');
    expect(team.calls.map((c) => c.role)).not.toContain('router');
    expect(designer.inputs).toHaveLength(1);
  });

  it('다른 저장소가 읽기 전용 참고로만 넘어온 기능 요청은 이 저장소의 설계 대화로 간다', async () => {
    const loops = new FakeLoops();
    const turn = await withDesigner({ team: new FakeTeam({ router: [route('feature')] }), loops }, designerThat(approved()).port).handle('web처럼 만들어줘', [{ name: 'web', root: 'E:/w/web', knowledge: null }]);
    expect(turn.kind).toBe('design');
  });

  it('설계 팀원이 쓴 호출과 비용이 사용량에 더해진다', async () => {
    const chat = withDesigner({ team: new FakeTeam({ router: [route('feature')] }), loops: new FakeLoops([outcome(), outcome()]) }, designerThat(approved()).port);
    await chat.handle('쿠폰 기능 만들어줘');
    expect(chat.usage().calls.sonnet).toBeGreaterThanOrEqual(3);
    expect(chat.usage().costUsd).toBeGreaterThanOrEqual(0.05);
  });
});

describe('ChatSession — 저장소 지식', () => {
  const knowledge = {
    current: async () => ({ block: '<repo_knowledge repo="shop" basis="main (a1b2c3d)">\n요약\n</repo_knowledge>', basis: RepoRef.of({ branch: 'main', commit: 'a1b2c3d'.padEnd(40, '0'), dirty: false }) }),
    noteChanged: async () => undefined,
  };

  it('답변 팀원은 지식 묶음을 받고 답에 읽은 기준이 붙는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('Money는 뭐야?');
    const message = team.calls.find((c) => c.role === 'answerer')!.message;
    expect(message.startsWith('<repo_knowledge')).toBe(true);
    expect(turn).toMatchObject({ kind: 'answer', basis: 'main (a1b2c3d)' });
  });

  it('라우터는 지식을 받지 않는다(빨라야 해서)', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('Money는 뭐야?');
    expect(team.calls.find((c) => c.role === 'router')!.message).not.toContain('<repo_knowledge');
  });
});

describe('ChatSession — 여러 저장소', () => {
  const knowledgeAt = (repo: string, branch: string, c: string) => ({
    current: async () => ({ block: `<repo_knowledge repo="${repo}" basis="${branch} (${c})">\n요약\n</repo_knowledge>`, basis: RepoRef.of({ branch, commit: c.padEnd(40, '0'), dirty: false }) }),
    noteChanged: async () => undefined,
  });
  const also = [{ name: 'shop-web', root: 'E:/w/shop-web', knowledge: knowledgeAt('shop-web', 'dev', 'bbbbbbb') }];

  it('다른 저장소도 묻는 질문은 그 저장소 지식과 읽기 경로를 함께 받는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '차이는…', claims: [] })] });
    await ChatSession.start({ ...sessionDeps({ team }), knowledge: knowledgeAt('shop-api', 'main', 'a1b2c3d'), repoName: 'shop-api' }).handle('두 저장소 Money 차이', also);
    const call = team.calls.find((c) => c.role === 'answerer')!;
    expect(call.message).toContain('<repo_knowledge repo="shop-api"');
    expect(call.message).toContain('<repo_knowledge repo="shop-web"');
    expect(call.dirs).toEqual(['E:/w/shop-web']);
  });

  it('저장소가 2개 이상인 작업 공간에서는 레포 하나만 가리켜도 답변 팀원에게 작업 공간 폴더를 열어 준다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '구조는…', claims: [] })] });
    const folder = { root: 'E:/w', repos: [{ name: 'shop-api', root: 'E:/w/shop-api' }, { name: 'shop-web', root: 'E:/w/shop-web' }] };
    await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder }).handle('폴더 구조 훑어줘');
    expect(team.calls.find((c) => c.role === 'answerer')!.dirs).toEqual(['E:/w']);
  });

  it('저장소가 하나뿐인 작업 공간이면 답변 팀원에게 작업 공간 폴더를 열지 않는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네', claims: [] })] });
    const folder = { root: 'E:/w', repos: [{ name: 'shop-api', root: 'E:/w/shop-api' }] };
    await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder }).handle('Money는 뭐야?');
    expect(team.calls.find((c) => c.role === 'answerer')!.dirs).toBeUndefined();
  });

  it('읽기 전용으로만 넘어온 다른 저장소가 있어도 이 저장소의 작업은 멈추지 않고 하며, 다른 저장소는 참고로 넘긴다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work')] });
    const turn = await ChatSession.start({ ...sessionDeps({ team, loops }), repoName: 'shop-api' }).handle('shop-web처럼 shop-api에 할인 추가해줘', also);
    expect(turn.kind).toBe('work');
    expect(loops.runs).toHaveLength(1);
    const references = loops.runs[0]!.context.references ?? '';
    expect(references).toContain('shop-web');
    expect(references).toContain('<repo_knowledge repo="shop-web"');
    expect(references).toContain('읽기 전용');
  });

  it('멈춘 작업의 멈춘 이유가 앞 대화에 남아 다시 맡길 때 같은 길로 가지 않게 한다', async () => {
    const stoppedOutcome = outcome({ status: 'stopped', stopReason: 'escalation-exhausted', guide: { toMarkdown: () => '', toTerminal: () => '', stopMessage: () => '여러 번 시도했지만 검사를 통과시키지 못했어요' } as unknown as RunOutcome['guide'] });
    const team = new FakeTeam({ router: [route('work'), route('work')] });
    const chat = ChatSession.start({ ...sessionDeps({ team, loops: new FakeLoops([stoppedOutcome]) }), repoName: 'shop-api' });
    await chat.handle('할인 추가해줘');
    await chat.handle('다시 해줘');
    const second = team.calls.filter((c) => c.role === 'router')[1]!;
    expect(second.message).toContain('검사를 통과시키지 못했어요');
  });

  it('다른 저장소가 없으면 참고 블록도 없다', async () => {
    const loops = new FakeLoops();
    await ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('work')] }), loops }), repoName: 'shop-api' }).handle('할인 추가해줘');
    expect(loops.runs[0]!.context.references ?? null).toBeNull();
  });

  it('코드가 아닌 결과물(커밋을 모은 포트폴리오 .md 등)은 크기와 상관없이 받아서 문서 팀원이 만든다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('task')], writer: [() => ({ summary: '저장소 2개의 내 커밋으로 포트폴리오를 만들었어요.', files: ['docs/portfolio.md'] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team, loops }), repoName: 'shop-api' }).handle('모든 레포에서 내 커밋 확인해서 포폴 md 만들어줘', also);
    expect(loops.runs).toEqual([]);
    const call = team.calls.find((c) => c.role === 'writer')!;
    expect(call.dirs).toEqual(['E:/w/shop-web']);
    expect(call.message).toContain('shop-web');
    // 문서 팀원은 문서만 쓴다(코드는 건드리지 않는다).
    expect(call.canWrite('docs/portfolio.md')).toBe(true);
    expect(call.canWrite('src/money.ts')).toBe(false);
    expect(turn.kind).toBe('answer');
    if (turn.kind !== 'answer') return;
    expect(turn.answer).toContain('포트폴리오를 만들었어요');
    expect(turn.answer).toContain('docs/portfolio.md');
  });

  describe('작업 공간 폴더와 저장소가 많을 때', () => {
    const folder = (n: number) => ({ root: 'E:/w', repos: Array.from({ length: n }, (_, i) => ({ name: i === 0 ? 'shop-api' : `repo${i}`, root: `E:/w/${i === 0 ? 'shop-api' : `repo${i}`}` })) });
    const alsoOf = (n: number) => folder(n).repos.slice(1).map((r) => ({ name: r.name, root: r.root, knowledge: null }));
    const done = () => ({ summary: '정리했어요.', files: ['RESUME.md'] });

    it('문서 팀원은 작업 공간 폴더(저장소들의 부모)에도 쓸 수 있게 열린다', async () => {
      const team = new FakeTeam({ router: [route('task')], writer: [done] });
      await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder: folder(3) }).handle('이력서 정리해줘', alsoOf(3));
      const call = team.calls.find((c) => c.role === 'writer')!;
      expect(call.dirs).toContain('E:/w');
      expect(call.message).toContain('<workspace root="E:/w"');
    });

    it('답변 팀원은 여러 저장소 작업 공간이면 폴더 위치와 저장소 목록을 안다 (작업 폴더를 잘못 설명하지 않게)', async () => {
      const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
      await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder: folder(3) }).handle('상위 폴더 스캔해줘', alsoOf(3));
      const message = team.calls.find((c) => c.role === 'answerer')!.message;
      expect(message).toContain('<workspace root="E:/w"');
      expect(message).toContain('repo1');
    });

    it('저장소 하나짜리 작업 공간이면 폴더 안내를 넣지 않는다', async () => {
      const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
      await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder: folder(1) }).handle('이 함수 뭐 해?');
      expect(team.calls.find((c) => c.role === 'answerer')!.message).not.toContain('<workspace');
    });

    it('저장소가 4개 넘으면 저장소마다 싼 모델이 나눠 읽고(문서는 쓰지 않음), 모은 요약으로 문서 한 번 쓴다', async () => {
      const team = new FakeTeam({ router: [route('task')], writer: [(c) => (c.userMessage.includes('<gather') ? { summary: `요약-${c.userMessage.match(/<gather repo="([^"]+)"/)![1]}`, files: [] } : done())] });
      const steps: string[] = [];
      const turn = await ChatSession.start({ ...sessionDeps({ team, steps }), repoName: 'shop-api', folder: folder(6) }).handle('모든 레포 이력서 정리', alsoOf(6));
      const writers = team.calls.filter((c) => c.role === 'writer');
      const gathers = writers.filter((c) => c.message.includes('<gather'));
      expect(gathers).toHaveLength(6);
      expect(gathers.every((c) => c.tier === 'haiku' && !c.canWrite('RESUME.md'))).toBe(true);
      // 각 저장소는 자기 폴더만 열어 읽는다.
      expect(gathers.find((c) => c.message.includes('repo3'))!.dirs).toEqual(['E:/w/repo3']);
      const last = writers.at(-1)!;
      expect(last.message).not.toContain('<gather');
      expect(last.message).toContain('<digests>');
      expect(last.message).toContain('요약-repo5');
      expect(last.tier).toBe('sonnet');
      expect(last.canWrite('RESUME.md')).toBe(true);
      expect(steps.some((s) => /저장소 읽는 중 \d+\/6/.test(s))).toBe(true);
      expect(turn.kind === 'answer' && turn.answer).toContain('RESUME.md');
    });

    it('저장소가 4개 이하면 나누지 않고 문서 팀원 한 번으로 쓴다', async () => {
      const team = new FakeTeam({ router: [route('task')], writer: [done] });
      await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder: folder(4) }).handle('모든 레포 이력서 정리', alsoOf(4));
      expect(team.calls.filter((c) => c.role === 'writer')).toHaveLength(1);
    });
  });

  it('답에 저장소마다 읽은 기준이 붙는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), knowledge: knowledgeAt('shop-api', 'main', 'a1b2c3d'), repoName: 'shop-api' }).handle('비교해줘', also);
    expect(turn).toMatchObject({ kind: 'answer', basis: 'shop-api: main (a1b2c3d), shop-web: dev (bbbbbbb)' });
  });
});

describe('ChatSession — 내 변경 검토', () => {
  it('바뀐 파일이 없으면 리뷰어를 부르지 않는다', async () => {
    const team = new FakeTeam({});
    const turn = await session({ team }).review(null);
    expect(turn).toMatchObject({ kind: 'review', files: [], checked: [] });
    expect(team.calls).toEqual([]);
  });

  it('근거가 확인된 지적과 추측을 나누고 기억에는 남기지 않는다', async () => {
    const memory = new FakeMemory();
    const team = new FakeTeam({
      reviewer: [
        () => ({
          verdict: 'changes',
          summary: '덧셈이 뺄셈으로 되어 있습니다.',
          issues: [
            { problem: 'add가 빼기를 한다', path: 'src/money.ts', line: 1, evidence: [{ ...blank, kind: 'code', path: 'src/money.ts', line: 1, quote: 'return this.amount - other.amount' }] },
            { problem: '예전에도 그랬다', path: null, line: null, evidence: [] },
          ],
        }),
      ],
    });
    const turn = await session({ team, memory, changes: [{ path: 'src/money.ts', kind: 'modified' }], files: { 'src/money.ts': 'return this.amount - other.amount' } }).review(null);
    expect(turn.kind).toBe('review');
    if (turn.kind !== 'review') return;
    expect(turn.checked.map((c) => c.isGuess)).toEqual([false, true]);
    expect(turn.summary).toBe('덧셈이 뺄셈으로 되어 있습니다.');
    expect(memory.nodes.size).toBe(0);
  });

  it('리뷰어는 바뀐 파일 내용을 <files>로 받는다', async () => {
    const team = new FakeTeam({ reviewer: [() => ({ verdict: 'pass', summary: '좋습니다', issues: [] })] });
    await session({ team, changes: [{ path: 'src/money.ts', kind: 'modified' }], files: { 'src/money.ts': 'export class Money {}' } }).review('develop');
    const message = team.calls[0]!.message;
    expect(message).toContain('<file path="src/money.ts">\n1\texport class Money {}\n</file>');
    expect(message).toContain('develop');
  });
});

describe('ChatSession — 저장소 지식은 필요할 때만', () => {
  const counting = () => {
    const reads = { n: 0 };
    return { reads, knowledge: { current: async () => { reads.n += 1; return null; }, noteChanged: async () => undefined } };
  };

  it('작업 요청은 저장소 지식을 읽지 않는다 (처음 파악하는 조사 팀원을 부르지 않는다)', async () => {
    const { reads, knowledge } = counting();
    await ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('work')] }) }), knowledge }).handle('Money에 할인 넣어줘');
    expect(reads.n).toBe(0);
  });

  it('인사에는 저장소 지식을 읽지 않고 답한다', async () => {
    const { reads, knowledge } = counting();
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '안녕하세요.', claims: [] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('안녕');
    expect(turn).toMatchObject({ kind: 'answer', answer: '안녕하세요.' });
    expect(reads.n).toBe(0);
  });

  it('코드에 대한 질문은 저장소 지식을 읽는다', async () => {
    const { reads, knowledge } = counting();
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('이 함수 뭐 해?');
    expect(reads.n).toBe(1);
  });
});

describe('ChatSession — 빠른 답', () => {
  it('세션을 시작해도 팀원을 미리 띄우지 않는다 (미리 시작 호출이 없다)', () => {
    const team = new FakeTeam({});
    session({ team });
    expect(team.prepared).toEqual([]);
  });

  it('라우터 판정이 끝나기 전에는 답변 팀원을 부르지 않는다', async () => {
    let openGate = () => {};
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    team.routerGate = new Promise((resolve) => (openGate = resolve));
    const pending = session({ team }).handle('이거 뭐야?');
    await vi.waitFor(() => expect(team.calls.map((c) => c.role)).toEqual(['router']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(team.calls.map((c) => c.role)).toEqual(['router']);
    openGate();
    expect(await pending).toMatchObject({ kind: 'answer', answer: '네.' });
  });

  it('시키는 말이면 답변 팀원을 미리 부르지 않고, 답을 기억에 남기지도 않는다 (호출을 버리지 않는다)', async () => {
    const memory = new FakeMemory();
    const team = new FakeTeam({ router: [route('work')], answerer: [() => ({ answer: '버릴 답', claims: [] })] });
    const turn = await session({ team, memory }).handle('Money에 할인 넣어줘');
    expect(turn.kind).toBe('work');
    expect(team.calls.some((c) => c.role === 'answerer')).toBe(false);
    expect([...memory.nodes.values()].some((n) => n.kind === 'question')).toBe(false);
  });

  it('질문처럼 안 보였어도 라우터가 질문이라 하면 그때 답한다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '그렇습니다.', claims: [] })] });
    const turn = await session({ team }).handle('결제 모듈에 할인 쿠폰 적용 순서를 장바구니 단위로 바꾸는 방향으로 정리하고 싶어요');
    expect(turn).toMatchObject({ kind: 'answer', answer: '그렇습니다.' });
    expect(team.calls.map((c) => c.role)).toEqual(['router', 'answerer']);
  });

  it('저장소가 많은 질문은 다른 저장소의 지식을 미리 만들지 않는다 (조사 팀원을 수십 번 부르지 않게)', async () => {
    const touched: string[] = [];
    const spy = (name: string) => ({ current: async () => (touched.push(name), null), noteChanged: async () => undefined });
    const repos = Array.from({ length: 5 }, (_, i) => ({ name: `r${i}`, root: `E:/w/r${i}`, knowledge: spy(`r${i}`) }));
    const ask = (also: typeof repos) => ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] }) }), repoName: 'a' }).handle('비교해줘', also);
    await ask(repos);
    expect(touched).toEqual([]);
    await ask(repos.slice(0, 3));
    expect(touched.sort()).toEqual(['r0', 'r1', 'r2']);
  });

  it('흐릿하게 지난 작업을 가리킨 질문은 고른 작업으로 다시 답한다', async () => {
    const memory = new FakeMemory();
    const team = new FakeTeam({ router: [route('work'), route('question', true, 'discount')], answerer: [() => ({ answer: '정한 해석 때문입니다.', claims: [] })] });
    const chat = session({ team, memory });
    await chat.handle('Money에 할인 넣어줘');
    await chat.handle('아까 그거 왜 그렇게 했어?');
    const answers = team.calls.filter((c) => c.role === 'answerer');
    expect(answers.at(-1)!.message).toContain('Money에 퍼센트 할인 discount 추가');
  });
});

describe('ChatSession — 작업과 기억', () => {
  it('작업이 끝나면 기억에 남고 다음 질문에서 찾힌다', async () => {
    const memory = new FakeMemory();
    const team = new FakeTeam({ router: [route('work')] });
    await session({ team, memory }).handle('Money에 할인 넣어줘');
    const [found] = await memory.search('discount', 3);
    expect(found?.work.text).toContain('Money에 퍼센트 할인 discount 추가');
    expect(found?.neighbors.map((n) => n.kind).sort()).toEqual(['assumption', 'decision', 'file', 'test']);
  });

  it('clear 뒤 흐릿한 지시는 후보를 묻고, 고른 작업을 past_work로 넘기고 보충 선을 만든다', async () => {
    const memory = new FakeMemory();
    const loops = new FakeLoops();
    const user = new FakeUser(true);
    const team = new FakeTeam({ router: [route('work'), route('work', true, 'discount 할인')] });
    const chat = session({ team, memory, loops, user });
    await chat.handle('Money에 할인 넣어줘');
    chat.clear();
    await chat.handle('아까 그 기능에 음수 할인율도 막아줘');
    expect(user.pastAsked[0]!.map((c) => c.title)).toEqual(['Money에 퍼센트 할인 discount 추가']);
    expect(loops.runs[1]!.context.pastWork).toContain('Money에 퍼센트 할인 discount 추가');
    expect(loops.runs[1]!.context.conversation).toBeNull();
    expect(memory.edges.some((e) => e.kind === 'extends' && e.to === 'work:id1:0')).toBe(true);
  });

  it('흐릿하게 가리킨 작업 요청에는 지난 질문이 아니라 지난 작업만 후보로 보여 준다', async () => {
    const memory = new FakeMemory();
    const user = new FakeUser(true);
    const team = new FakeTeam({
      router: [route('work'), route('question'), route('work', true, '할인')],
      answerer: [() => ({ answer: '버립니다.', claims: [] })],
    });
    const chat = session({ team, memory, user });
    await chat.handle('Money에 할인 넣어줘');
    await chat.handle('할인은 원 미만을 어떻게 해?');
    await chat.handle('아까 그 할인에 음수도 막아줘');
    expect(user.pastAsked.at(-1)!.map((c) => c.title)).toEqual(['Money에 퍼센트 할인 discount 추가']);
  });

  it('후보를 새 작업으로 고르면 보충 선을 만들지 않는다', async () => {
    const memory = new FakeMemory();
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work'), route('work', true, 'discount')] });
    const chat = session({ team, memory, loops, user: new FakeUser(true, () => null) });
    await chat.handle('Money에 할인 넣어줘');
    await chat.handle('그거 고쳐줘');
    expect(loops.runs[1]!.context.pastWork).toBeNull();
    expect(memory.edges.some((e) => e.kind === 'extends')).toBe(false);
  });

  it('화면이 없으면 후보를 묻지 않고 새 작업으로 진행한다', async () => {
    const user = new FakeUser(false);
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work'), route('work', true, 'discount')] });
    const chat = session({ team, loops, user });
    await chat.handle('Money에 할인 넣어줘');
    await chat.handle('아까 그거 고쳐줘');
    expect(user.pastAsked).toEqual([]);
    expect(loops.runs[1]!.context.pastWork).toBeNull();
  });

  it('앞 대화도 지난 작업도 없는데 "아까 그거 이어서"라고 하면 팀을 부르지 않고 무엇을 이어서 할지 되묻는다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work', true, '아까 그거')] });
    const turn = await session({ team, loops }).handle('아까 그거 이어서 해줘');
    expect(turn).toMatchObject({ kind: 'notice', message: expect.stringContaining('이어서 할 작업을 찾지 못했어요') });
    expect(team.calls.map((c) => c.role)).toEqual(['router']);
    expect(loops.runs).toEqual([]);
  });

  it('라우터가 지난 일을 가리킨다고 표시하지 않아도 지시어와 맥락 없음이면 같은 안내로 끝낸다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work')] });
    const turn = await session({ team, loops }).handle('이어서 해줘');
    expect(turn.kind).toBe('notice');
    expect(loops.runs).toEqual([]);
  });

  it('되물은 턴은 대화 기록에 남기지 않아 다음 요청의 앞 대화가 되지 않는다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work', true), route('work')] });
    const chat = session({ team, loops });
    await chat.handle('아까 그거 이어서 해줘');
    await chat.handle('로그인 잠금 기능 만들어줘');
    expect(loops.runs[0]!.context.conversation).toBeNull();
  });

  it('지난 작업이 기억에 있으면(앞 대화가 없어도) 되묻지 않고 후보를 보여 준다', async () => {
    const memory = new FakeMemory();
    const loops = new FakeLoops();
    const user = new FakeUser(true);
    const team = new FakeTeam({ router: [route('work'), route('work', true, 'discount 할인')] });
    const chat = session({ team, memory, loops, user });
    await chat.handle('Money에 할인 넣어줘');
    chat.clear();
    const turn = await chat.handle('아까 그거 이어서 해줘');
    expect(turn.kind).toBe('work');
    expect(user.pastAsked).toHaveLength(1);
  });

  it('앞 대화가 있으면 지시어가 있어도 이어서 진행한다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work'), route('work')] });
    const chat = session({ team, loops });
    await chat.handle('Money에 할인 넣어줘');
    const turn = await chat.handle('아까 그거 이어서 해줘');
    expect(turn.kind).toBe('work');
    expect(loops.runs[1]!.context.conversation).toContain('Money에 할인 넣어줘');
  });

  it('이어폰·아까운 같은 말은 맥락이 없어도 새 작업으로 진행한다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work'), route('work')] });
    const chat = session({ team, loops });
    expect((await chat.handle('이어폰 버그 고쳐줘')).kind).toBe('work');
    chat.clear();
    expect((await chat.handle('아까운 메모리 줄여줘')).kind).toBe('work');
  });

  it('라우터 출력이 깨지면 작업으로 진행한다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [() => ({ nonsense: true })] });
    const turn = await session({ team, loops }).handle('뭔가 해줘');
    expect(turn.kind).toBe('work');
    expect(loops.runs).toHaveLength(1);
  });
});

describe('ChatSession — 사용 한도', () => {
  it('질문하다 구독 한도에 걸리면 한도 문장을 그대로 알린다', async () => {
    const team = new FakeTeam({ router: [route('question')] }, 'answerer');
    const turn = await session({ team }).handle('왜 floor야?');
    expect(turn).toMatchObject({ kind: 'blocked', reason: 'usage-limit', message: "You've hit your session limit · resets 9:40pm" });
  });

  it('라우터에서 한도에 걸리면 작업을 시작하지 않는다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({}, 'router');
    const turn = await session({ team, loops }).handle('Money에 할인 넣어줘');
    expect(turn.kind).toBe('blocked');
    expect(loops.runs).toEqual([]);
  });

  it('라우터가 로그인 안 돼 있으면 질문을 작업으로 넘기지 않고 로그인 필요를 알린다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({}, 'router', 'login');
    const turn = await session({ team, loops }).handle('ECS on EC2와 Fargate 차이 알려줘');
    expect(turn).toMatchObject({ kind: 'blocked', reason: 'login' });
    expect(loops.runs).toEqual([]);
    expect(team.calls.filter((c) => c.role === 'answerer').every((c) => c.signal!.aborted)).toBe(true);
  });
});

describe('ChatSession — 팀원이 찾아본 도구는 결과까지 남는다', () => {
  const ask = async (role: 'answerer' | 'operator' | 'writer', tools: { name: string; count: number }[] | undefined, mode: 'question' | 'ops' | 'task') => {
    const scripts = { answerer: () => ({ answer: '답', claims: [{ text: 'a', evidence: [] }] }), operator: () => ({ answer: '답', commands: [] }), writer: () => ({ summary: '썼어요', files: ['A.md'] }) };
    const team = new FakeTeam({ router: [route(mode)], [role]: [scripts[role]] });
    if (tools !== undefined) team.tools[role] = tools;
    return session({ team }).handle('폴더 훑어 줘');
  };
  const grepRead = [{ name: 'Grep', count: 3 }, { name: 'Read', count: 5 }];

  it('답변 팀원이 쓴 도구를 이름과 횟수 한 줄로 답 결과에 싣는다', async () => {
    expect(await ask('answerer', grepRead, 'question')).toMatchObject({ kind: 'answer', toolsLine: 'Grep 3 · Read 5' });
  });

  it('운영 팀원이 쓴 도구도 답 결과에 싣는다', async () => {
    expect(await ask('operator', grepRead, 'ops')).toMatchObject({ kind: 'answer', toolsLine: 'Grep 3 · Read 5' });
  });

  it('문서 팀원이 쓴 도구도 답 결과에 싣는다', async () => {
    expect(await ask('writer', grepRead, 'task')).toMatchObject({ kind: 'answer', toolsLine: 'Grep 3 · Read 5' });
  });

  it('도구를 쓰지 않았거나 모으지 못한 호출은 줄 자체를 싣지 않는다', async () => {
    expect(await ask('answerer', [], 'question')).not.toHaveProperty('toolsLine');
    expect(await ask('answerer', undefined, 'question')).not.toHaveProperty('toolsLine');
  });
});

describe('ChatSession — 운영 요청', () => {
  const ops = (answer: string, commands: string[] = []) => () => ({ answer, commands });

  it('ops로 가려진 요청은 운영 팀원이 명령으로 처리하고, 실행한 명령을 답 뒤에 붙인다 (작업 루프는 돌리지 않는다)', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('ops')], operator: [ops('버킷이 2개 있어요.', ['aws s3 ls'])] });
    const turn = await session({ team, loops }).handle('내 S3 버킷 목록 알려줘');
    expect(turn).toMatchObject({ kind: 'answer', answer: '버킷이 2개 있어요.\n\n■ 실행한 명령\n- aws s3 ls' });
    expect(loops.runs).toEqual([]);
    expect(team.calls.some((c) => c.role === 'operator' && c.message.includes('내 S3 버킷 목록 알려줘'))).toBe(true);
    expect(team.calls.filter((c) => c.role === 'answerer').every((c) => c.signal!.aborted)).toBe(true);
  });

  it('운영 팀원도 앞 대화를 받고, 이 턴은 다음 대화에 이어진다', async () => {
    const team = new FakeTeam({ router: [route('ops')], operator: [ops('첫 답'), ops('둘째 답')] });
    const chat = session({ team });
    await chat.handle('버킷 목록');
    await chat.handle('첫 번째 거 지워줘');
    const second = team.calls.filter((c) => c.role === 'operator')[1]!.message;
    expect(second).toContain('<conversation>');
    expect(second).toContain('버킷 목록');
    expect(second).toContain('첫 답');
  });

  it('사용 한도에 걸리면 막힘으로 알린다', async () => {
    const team = new FakeTeam({ router: [route('ops')] }, 'operator');
    expect(await session({ team }).handle('버킷 목록')).toMatchObject({ kind: 'blocked', reason: 'usage-limit' });
  });
});

describe('ChatSession — 디버깅·위험 점검', () => {
  const report = (answer: string, files: string[] = []) => () => ({ answer, files });

  it('debug로 가려진 요청은 디버깅 팀원이 원인을 찾아 보고하고, 살펴본 파일을 붙인다 (작업 루프는 돌리지 않는다)', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('debug')], debugger: [report('할인이 두 번 적용돼요.', ['src/money.ts'])] });
    const turn = await session({ team, loops }).handle('결제 금액이 왜 두 번 깎여?');
    expect(turn).toMatchObject({ kind: 'answer', answer: '할인이 두 번 적용돼요.\n\n■ 살펴본 파일\n- src/money.ts' });
    expect(loops.runs).toEqual([]);
    expect(team.calls.some((c) => c.role === 'debugger' && c.message.includes('결제 금액이 왜 두 번 깎여?'))).toBe(true);
    expect(team.calls.filter((c) => c.role === 'answerer').every((c) => c.signal!.aborted)).toBe(true);
  });

  it('risk로 가려진 요청은 위험 점검 팀원이 보고한다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('risk')], riskchecker: [report('cart.ts도 영향을 받아요.', ['src/cart.ts'])] });
    const turn = await session({ team, loops }).handle('Money 반올림 바꾸면 어디가 깨져?');
    expect(turn).toMatchObject({ kind: 'answer', answer: expect.stringContaining('cart.ts도 영향을 받아요.') });
    expect(loops.runs).toEqual([]);
  });

  it('디버깅 팀원도 앞 대화를 받고, 이 턴은 다음 대화에 이어진다', async () => {
    const team = new FakeTeam({ router: [route('debug')], debugger: [report('첫 진단'), report('둘째 진단')] });
    const chat = session({ team });
    await chat.handle('테스트가 왜 깨져?');
    await chat.handle('그 원인 고치면 다른 데도 영향 있어?');
    const second = team.calls.filter((c) => c.role === 'debugger')[1]!.message;
    expect(second).toContain('<conversation>');
    expect(second).toContain('첫 진단');
  });

  it('사용 한도에 걸리면 막힘으로 알린다', async () => {
    const team = new FakeTeam({ router: [route('risk')] }, 'riskchecker');
    expect(await session({ team }).handle('이 변경 위험해?')).toMatchObject({ kind: 'blocked', reason: 'usage-limit' });
  });
});

describe('ChatSession — 기획', () => {
  const report = (answer: string) => () => ({ answer, files: [] });

  it('ideate로 가려진 요청은 기획 팀원이 아이디어를 내고, 작업 루프는 돌리지 않는다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('ideate')], planner: [report('■ 아이디어 1 - 동네 모임 앱')] });
    const turn = await session({ team, loops }).handle('앱이랑 웹 둘 다 있는 사업 아이디어 좀 내줘');
    expect(turn).toMatchObject({ kind: 'answer', answer: expect.stringContaining('동네 모임 앱') });
    expect(loops.runs).toEqual([]);
    expect(team.calls.some((c) => c.role === 'planner' && c.message.includes('사업 아이디어'))).toBe(true);
  });

  it('기획 팀원도 앞 대화를 받는다 (아이디어를 고르며 이어 말할 수 있다)', async () => {
    const team = new FakeTeam({ router: [route('ideate')], planner: [report('첫 아이디어들'), report('더 구체화')] });
    const chat = session({ team });
    await chat.handle('아이디어 내줘');
    await chat.handle('두 번째 거 더 구체적으로');
    expect(team.calls.filter((c) => c.role === 'planner')[1]!.message).toContain('첫 아이디어들');
  });

  it('사용 한도에 걸리면 막힘으로 알린다', async () => {
    const team = new FakeTeam({ router: [route('ideate')] }, 'planner');
    expect(await session({ team }).handle('아이디어 내줘')).toMatchObject({ kind: 'blocked', reason: 'usage-limit' });
  });
});

describe('ChatSession — 회사 부서', () => {
  const memberReport = (answer: string, files: string[] = []) => () => ({ answer, files });
  /** 부서장: 계획 일이면 팀원 배정을, 종합·섹션 일이면 글을 돌려준다 */
  const chief = (assignments: { member: string; brief: string }[], text = '부서장 종합') => (call: { userMessage: string }) =>
    call.userMessage.includes('<job>plan</job>') ? { note: '나눔', assignments } : { answer: text, files: ['docs/x.md'] };
  const callsOf = (team: FakeTeam, role: string) => team.calls.filter((c) => c.role === role);

  it('팀원이 정해진 일은 부서장 없이 그 팀원이 혼자 한다 (호출 하나)', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'marketing', member: 'marketer' })], marketer: [memberReport('스토어 문구 초안', ['README.md'])] });
    const turn = await session({ team, loops }).handle('앱스토어 설명 써줘');
    expect(turn).toMatchObject({ kind: 'answer', answer: '스토어 문구 초안\n\n■ 살펴본 파일\n- README.md' });
    expect(callsOf(team, 'chief')).toEqual([]);
    expect(loops.runs).toEqual([]);
  });

  it('넓은 요청은 부서장이 팀원을 나눠 맡기고, 팀원은 자기 지시를 받아 일한다', async () => {
    const team = new FakeTeam({
      router: [route('company', false, null, { department: 'marketing', member: null })],
      chief: [chief([{ member: 'marketer', brief: '문구를 써라' }, { member: 'growth', brief: '지표를 짜라' }])],
      marketer: [memberReport('문구 안')],
      growth: [memberReport('지표 안', ['src/a.ts'])],
    });
    const turn = await session({ team }).handle('출시 마케팅 전반을 잡아줘');
    expect(callsOf(team, 'marketer')[0]!.message).toContain('문구를 써라');
    expect(callsOf(team, 'growth')[0]!.message).toContain('지표를 짜라');
    expect(callsOf(team, 'chief')).toHaveLength(2);
    expect(turn).toMatchObject({ kind: 'answer', answer: expect.stringContaining('부서장 종합') });
    expect(turn.kind === 'answer' && turn.answer).toContain('- docs/x.md');
    expect(turn.kind === 'answer' && turn.answer).toContain('- src/a.ts');
  });

  it('부서장이 한 명만 고르면 종합 호출을 건너뛰어 호출을 아낀다', async () => {
    const team = new FakeTeam({
      router: [route('company', false, null, { department: 'planning', member: null })],
      chief: [chief([{ member: 'bm', brief: '구독 모델' }])],
      bm: [memberReport('구독이 맞아요.')],
    });
    const turn = await session({ team }).handle('수익 구조 어떻게 하지');
    expect(callsOf(team, 'chief')).toHaveLength(1);
    expect(turn).toMatchObject({ kind: 'answer', answer: '구독이 맞아요.' });
  });

  it('부서장은 계획에는 sonnet, 종합에는 가장 높은 모델을 쓴다 (짧은 계획에 비싼 모델을 쓰지 않는다)', async () => {
    const team = new FakeTeam({
      router: [route('company', false, null, { department: 'design', member: null })],
      chief: [chief([{ member: 'uxdesigner', brief: 'a' }, { member: 'brand', brief: 'b' }])],
      uxdesigner: [memberReport('흐름')],
      brand: [memberReport('이름')],
    });
    await session({ team }).handle('디자인 전반');
    const [plan, merge] = callsOf(team, 'chief');
    expect([plan!.tier, merge!.tier]).toEqual(['sonnet', 'opus']);
  });

  it('부서장의 종합 입력에는 팀원들의 보고가 담긴다', async () => {
    const team = new FakeTeam({
      router: [route('company', false, null, { department: 'design', member: null })],
      chief: [chief([{ member: 'uxdesigner', brief: 'a' }, { member: 'brand', brief: 'b' }])],
      uxdesigner: [memberReport('흐름 명세')],
      brand: [memberReport('이름 후보')],
    });
    await session({ team }).handle('디자인 전반');
    const merge = callsOf(team, 'chief')[1]!.message;
    expect(merge).toContain('<job>merge</job>');
    expect(merge).toContain('흐름 명세');
    expect(merge).toContain('이름 후보');
  });

  it('부서 팀원도 앞 대화를 받는다', async () => {
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'design', member: 'brand' })], brand: [memberReport('첫 이름들'), memberReport('둘째')] });
    const chat = session({ team });
    await chat.handle('이름 지어줘');
    await chat.handle('두 번째 거 더 다듬어줘');
    expect(callsOf(team, 'brand')[1]!.message).toContain('첫 이름들');
  });

  it('운영 부서의 운영 팀원이 한 일은 실행한 명령이 답에 붙는다', async () => {
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'operations', member: 'operator' })], operator: [() => ({ answer: '버킷 2개', commands: ['aws s3 ls'] })] });
    const turn = await session({ team }).handle('버킷 보여줘');
    expect(turn).toMatchObject({ kind: 'answer', answer: '버킷 2개\n\n■ 실행한 명령\n- aws s3 ls' });
  });

  it('팀원이 사용 한도에 걸리면 막힘으로 알린다', async () => {
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'marketing', member: 'marketer' })] }, 'marketer');
    expect(await session({ team }).handle('광고 문구')).toMatchObject({ kind: 'blocked', reason: 'usage-limit' });
  });

  it('런칭 계획은 부서장이 부서마다 한 번씩 순서대로 쓰고, 앞 부서의 글을 뒤 부서가 받는다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('launch')], chief: [(call) => ({ answer: `${call.userMessage.includes('Planning') ? '기획안' : call.userMessage.includes('Design') ? '디자인안' : '다른 부서안'}`, files: [] })] });
    const steps: string[] = [];
    const turn = await session({ team, loops, steps }).handle('동네 모임 앱이랑 웹 런칭 계획 짜줘');
    expect(callsOf(team, 'chief')).toHaveLength(5);
    expect(callsOf(team, 'chief')[1]!.message).toContain('기획안');
    expect(turn.kind === 'answer' && turn.answer.indexOf('기획·전략부')).toBeLessThan(turn.kind === 'answer' ? turn.answer.indexOf('운영·유지보수부') : 0);
    expect(turn.kind === 'answer' && turn.answer).toContain('설계 시작');
    expect(loops.runs).toEqual([]);
    expect(steps.some((s) => s.includes('마케팅·그로스부'))).toBe(true);
  });

  it('런칭 계획 중 한도에 걸리면 막힘으로 알린다', async () => {
    const team = new FakeTeam({ router: [route('launch')] }, 'chief');
    expect(await session({ team }).handle('런칭 계획')).toMatchObject({ kind: 'blocked', reason: 'usage-limit' });
  });

  it('런칭 계획을 낸 턴은 다음 대화에서 앞 대화로 이어진다', async () => {
    const team = new FakeTeam({ router: [route('launch'), route('question')], chief: [() => ({ answer: '핵심 계획', files: [] })] });
    const chat = session({ team });
    await chat.handle('런칭 계획');
    await chat.handle('개발부터 시작하자');
    expect(callsOf(team, 'answerer').pop()!.message).toContain('핵심 계획');
  });
});

describe('ChatSession — 한도 연동', () => {
  const memberReport = (answer: string) => () => ({ answer, files: [] });
  const chief = (assignments: { member: string; brief: string }[]) => (call: { userMessage: string }) =>
    call.userMessage.includes('<job>plan</job>') ? { note: '나눔', assignments } : { answer: '종합', files: [] };
  const used = (percent: number, resetsAt: string | null = null) => SessionBudget.fromWindows([{ percent, resetsAt }]);

  it('한도가 빠듯하면 부서장도 sonnet으로 돌리고, 한 번 알린다', async () => {
    const team = new FakeTeam({
      router: [route('company', false, null, { department: 'design', member: null })],
      chief: [chief([{ member: 'uxdesigner', brief: 'a' }, { member: 'brand', brief: 'b' }])],
      uxdesigner: [memberReport('흐름')],
      brand: [memberReport('이름')],
    });
    const steps: string[] = [];
    await session({ team, steps, budget: used(75) }).handle('디자인 전반');
    expect(team.calls.filter((c) => c.role === 'chief').map((c) => c.tier)).toEqual(['sonnet', 'sonnet']);
    expect(steps.filter((s) => s.includes('한도')).length).toBe(1);
  });

  it('한도가 넉넉하면 아무것도 바꾸지 않는다', async () => {
    const team = new FakeTeam({
      router: [route('company', false, null, { department: 'design', member: null })],
      chief: [chief([{ member: 'uxdesigner', brief: 'a' }, { member: 'brand', brief: 'b' }])],
      uxdesigner: [memberReport('흐름')],
      brand: [memberReport('이름')],
    });
    const steps: string[] = [];
    await session({ team, steps, budget: used(20) }).handle('디자인 전반');
    expect(team.calls.filter((c) => c.role === 'chief').map((c) => c.tier)).toEqual(['sonnet', 'opus']);
    expect(steps.some((s) => s.includes('한도'))).toBe(false);
  });

  it('한도가 위험하면 런칭 계획은 미루고, 어떻게 하면 되는지 알려 준다 (호출 없이)', async () => {
    const team = new FakeTeam({ router: [route('launch')] });
    const turn = await session({ team, budget: used(93, '2026-11-01T14:30:00.000Z') }).handle('런칭 계획 짜줘');
    expect(turn).toMatchObject({ kind: 'notice', message: expect.stringContaining('93%') });
    expect(turn.kind === 'notice' && turn.message).toContain('그래도 진행');
    expect(team.calls.filter((c) => c.role === 'chief')).toEqual([]);
  });

  it('위험할 때도 넓은 부서 요청은 미루지만, 팀원 하나로 되는 일과 질문은 한다', async () => {
    const wide = new FakeTeam({ router: [route('company', false, null, { department: 'marketing', member: null })] });
    expect(await session({ team: wide, budget: used(95) }).handle('마케팅 전반')).toMatchObject({ kind: 'notice' });
    const one = new FakeTeam({ router: [route('company', false, null, { department: 'marketing', member: 'marketer' })], marketer: [memberReport('문구')] });
    expect(await session({ team: one, budget: used(95) }).handle('스토어 문구')).toMatchObject({ kind: 'answer', answer: '문구' });
    const ask = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    expect(await session({ team: ask, budget: used(95) }).handle('이거 뭐야?')).toMatchObject({ kind: 'answer' });
  });

  it('미룬 뒤 "그래도 진행"이라고 하면 그 요청을 그대로 한다', async () => {
    const team = new FakeTeam({ router: [route('launch')], chief: [() => ({ answer: '섹션', files: [] })] });
    const chat = session({ team, budget: used(95) });
    await chat.handle('런칭 계획 짜줘');
    const turn = await chat.handle('그래도 진행');
    expect(turn).toMatchObject({ kind: 'answer', answer: expect.stringContaining('섹션') });
    expect(team.calls.filter((c) => c.role === 'chief')).toHaveLength(5);
    expect(team.calls.filter((c) => c.role === 'router')).toHaveLength(1);
  });

  it('미룬 요청도 대화에 남아, 다음 말이 그것을 가리켜도 이어진다', async () => {
    const team = new FakeTeam({ router: [route('launch'), route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    const chat = session({ team, budget: used(95) });
    await chat.handle('런칭 계획 짜줘');
    await chat.handle('그거 왜 안 했어?');
    expect(team.calls.find((c) => c.role === 'router' && c.message.includes('그거 왜'))!.message).toContain('런칭 계획 짜줘');
  });

  it('미룬 요청이 없을 때의 "그래도 진행"은 평범한 입력으로 라우터에 간다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    await session({ team, budget: used(95) }).handle('그래도 진행');
    expect(team.calls.filter((c) => c.role === 'router')).toHaveLength(1);
  });

  it('다른 말을 하면 미뤄 둔 요청은 잊는다', async () => {
    const team = new FakeTeam({ router: [route('launch'), route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    const chat = session({ team, budget: used(95) });
    await chat.handle('런칭 계획 짜줘');
    await chat.handle('이거 뭐야?');
    await chat.handle('그래도 진행');
    expect(team.calls.filter((c) => c.role === 'chief')).toEqual([]);
  });
});

describe('ChatSession — 회사 장부', () => {
  const memberReport = (answer: string) => () => ({ answer, files: [] });
  const chiefText = (text: string) => () => ({ answer: text, files: [] });
  class FakeBook {
    saved: CompanyBook[] = [];
    constructor(public book: CompanyBook = CompanyBook.empty(), private readonly failSave = false) {}
    async load() {
      return this.book;
    }
    async save(book: CompanyBook) {
      if (this.failSave) throw new Error('디스크 가득');
      this.book = book;
      this.saved.push(book);
    }
  }
  const planned = CompanyBook.empty().with({ department: 'planning', summary: '구독 모델로 간다', at: '2026-11-01T00:00:00.000Z' });

  it('부서 팀원은 회사가 이미 정한 것을 입력으로 받는다', async () => {
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'marketing', member: 'marketer' })], marketer: [memberReport('문구')] });
    await session({ team, company: new FakeBook(planned) }).handle('스토어 문구');
    expect(team.calls.find((c) => c.role === 'marketer')!.message).toContain('구독 모델로 간다');
  });

  it('부서 결과는 장부에 요약으로 남는다 (읽은 파일 목록은 빼고)', async () => {
    const book = new FakeBook();
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'marketing', member: 'marketer' })], marketer: [() => ({ answer: '■ 포지셔닝\n- 동네 모임', files: ['a.ts'] })] });
    await session({ team, company: book }).handle('포지셔닝');
    expect(book.book.entries).toEqual([{ department: 'marketing', summary: '■ 포지셔닝\n- 동네 모임', at: expect.any(String) }]);
  });

  it('기획 팀원의 아이디어도 기획부 결과로 남지만, 디버깅 결과는 남기지 않는다', async () => {
    const book = new FakeBook();
    const team = new FakeTeam({ router: [route('ideate'), route('debug')], planner: [memberReport('아이디어 A')], debugger: [memberReport('원인은 X')] });
    const chat = session({ team, company: book });
    await chat.handle('아이디어');
    await chat.handle('테스트가 왜 깨져?');
    expect(book.book.entries.map((e) => e.department)).toEqual(['planning']);
  });

  it('읽지 못한 보고는 장부에 남기지 않는다', async () => {
    const book = new FakeBook();
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'design', member: 'brand' })], brand: [() => null] });
    await session({ team, company: book }).handle('이름');
    expect(book.saved).toEqual([]);
  });

  it('장부를 저장하지 못해도 답은 돌려준다', async () => {
    const team = new FakeTeam({ router: [route('company', false, null, { department: 'design', member: 'brand' })], brand: [memberReport('이름 후보')] });
    expect(await session({ team, company: new FakeBook(CompanyBook.empty(), true) }).handle('이름')).toMatchObject({ kind: 'answer', answer: '이름 후보' });
  });

  it('런칭 계획은 부서마다 장부에 남기고, 뒤 부서에는 앞 부서 글의 요약만 넘긴다 (입력을 줄인다)', async () => {
    const book = new FakeBook();
    const team = new FakeTeam({ router: [route('launch')], chief: [chiefText('가'.repeat(2000))] });
    await session({ team, company: book }).handle('런칭 계획');
    expect(book.book.entries.map((e) => e.department).sort()).toEqual(['design', 'marketing', 'operations', 'planning', 'quality']);
    const second = team.calls.filter((c) => c.role === 'chief')[1]!.message;
    expect(second).not.toContain('가'.repeat(1000));
    expect(second).toContain('가'.repeat(100));
  });

  it('장부 내용은 /company에서 볼 수 있다', async () => {
    const chat = session({ team: new FakeTeam({}), company: new FakeBook(planned) });
    expect(await chat.companyEntries()).toEqual(planned.entries);
  });
});

describe('ChatSession — 같은 질문 다시', () => {
  const answerer = () => [() => ({ answer: '첫 답', claims: [] }), () => ({ answer: '새 답', claims: [] })];

  it('방금 한 질문을 그대로 다시 하면 새로 부르지 않고 앞 답을 보여 준다 (호출 0)', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: answerer() });
    const chat = session({ team });
    await chat.handle('이 함수 뭐 해?');
    const calls = team.calls.length;
    const again = await chat.handle('이  함수 뭐 해?');
    expect(again).toMatchObject({ kind: 'answer', answer: expect.stringContaining('첫 답') });
    expect(again.kind === 'answer' && again.answer).toContain('방금');
    expect(team.calls.length).toBe(calls);
  });

  it('다른 질문은 새로 묻는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: answerer() });
    const chat = session({ team });
    await chat.handle('이 함수 뭐 해?');
    expect(await chat.handle('저 함수는 뭐 해?')).toMatchObject({ answer: '새 답' });
  });

  it('그 사이 코드를 바꾸는 작업을 했으면 다시 묻는다 (옛 답이 틀릴 수 있다)', async () => {
    const team = new FakeTeam({ router: [route('question'), route('work'), route('question')], answerer: answerer() });
    const chat = session({ team });
    await chat.handle('이 함수 뭐 해?');
    await chat.handle('Money에 할인 넣어줘');
    expect(await chat.handle('이 함수 뭐 해?')).toMatchObject({ answer: '새 답' });
  });

  it('그 사이 운영 명령을 돌렸어도 다시 묻는다 (인프라가 바뀌었을 수 있다)', async () => {
    const team = new FakeTeam({ router: [route('question'), route('ops'), route('question')], answerer: answerer(), operator: [() => ({ answer: '올렸어요.', commands: [] })] });
    const chat = session({ team });
    await chat.handle('서버 몇 대야?');
    await chat.handle('서버 하나 더 띄워줘');
    expect(await chat.handle('서버 몇 대야?')).toMatchObject({ answer: '새 답' });
  });

  it('/clear 뒤에는 다시 묻는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: answerer() });
    const chat = session({ team });
    await chat.handle('이 함수 뭐 해?');
    chat.clear();
    expect(await chat.handle('이 함수 뭐 해?')).toMatchObject({ answer: '새 답' });
  });
});

describe('ChatSession — 학습 노트', () => {
  const explained = (decisions: { what: string; why: string }[]) => outcome({ explanation: { decisions } as unknown as RunOutcome['explanation'] });
  class FakeLearning {
    book = LearningBook.empty();
    constructor(private readonly failSave = false) {}
    async load() {
      return this.book;
    }
    async save(book: LearningBook) {
      if (this.failSave) throw new Error('디스크 가득');
      this.book = book;
    }
  }

  it('작업에서 패턴을 쓴 결정이 있으면 학습 노트에 쌓는다 (추가 호출 없이)', async () => {
    const learning = new FakeLearning();
    const loops = new FakeLoops([explained([{ what: '할인 계산을 전략 패턴(Strategy)으로 뺐다', why: '쿠폰 종류마다 규칙이 달라서' }])]);
    const team = new FakeTeam({ router: [route('work')] });
    await session({ team, loops, learning }).handle('쿠폰 할인 넣어줘');
    expect(learning.book.notes.map((n) => n.pattern)).toEqual(['전략(Strategy)']);
    expect(team.calls.map((c) => c.role)).toEqual(['router']);
  });

  it('패턴 이야기가 없는 작업은 노트를 만들지 않는다', async () => {
    const learning = new FakeLearning();
    const loops = new FakeLoops([explained([{ what: 'null 검사를 추가했다', why: '빈 값이 들어와서' }])]);
    await session({ team: new FakeTeam({ router: [route('work')] }), loops, learning }).handle('null 체크 넣어줘');
    expect(learning.book.notes).toEqual([]);
  });

  it('설명이 없는 작업도 문제없이 끝난다', async () => {
    const learning = new FakeLearning();
    expect(await session({ team: new FakeTeam({ router: [route('work')] }), learning }).handle('오타 고쳐줘')).toMatchObject({ kind: 'work' });
  });

  it('노트를 저장하지 못해도 작업 결과는 돌려준다', async () => {
    const loops = new FakeLoops([explained([{ what: '팩토리 패턴으로 만들었다', why: '생성이 복잡해서' }])]);
    expect(await session({ team: new FakeTeam({ router: [route('work')] }), loops, learning: new FakeLearning(true) }).handle('만들어줘')).toMatchObject({ kind: 'work' });
  });

  it('/learn에서 볼 노트를 돌려준다', async () => {
    const learning = new FakeLearning();
    learning.book = LearningBook.empty().add([{ pattern: '팩토리(Factory)', what: 'A', why: 'B', at: '2026-11-01T00:00:00.000Z' }]);
    expect((await session({ team: new FakeTeam({}), learning }).learningNotes()).notes).toHaveLength(1);
  });
});

describe('ChatSession — 세션', () => {
  it('두 번째 요청은 첫 요청이 남긴 변경 위에서 시작하고, 앞 대화를 함께 넘긴다', async () => {
    const loops = new FakeLoops([outcome(), outcome({ changedInRun: [{ path: 'src/cart.ts', kind: 'modified' }], snapshotAfter: new Map([['src/money.ts', 'modified:h1'], ['src/cart.ts', 'modified:h2']]) })]);
    const team = new FakeTeam({ router: [route('work')] });
    const chat = session({ team, loops });
    await chat.handle('Money에 할인 넣어줘');
    await chat.handle('방금 거 에러 메시지만 바꿔줘');
    expect(loops.runs[0]!.carried.size).toBe(0);
    expect([...loops.runs[1]!.carried]).toEqual([['src/money.ts', 'modified:h1']]);
    expect(loops.runs[1]!.context.conversation).toContain('Money에 할인 넣어줘');
    expect(chat.status().carriedFiles).toBe(2);
  });

  it('이어지는 질문에는 답변 팀원에게도 바로 앞 대화와 앞 답의 끝까지를 넘긴다', async () => {
    const long = `${'앞 답의 앞부분입니다. '.repeat(20)}마지막 문장입니다.`;
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: long, claims: [] }), () => ({ answer: '네.', claims: [] })] });
    const chat = session({ team });
    await chat.handle('ECS와 Fargate 차이 알려줘');
    await chat.handle('두 번째 거 더 자세히');
    const second = team.calls.filter((c) => c.role === 'answerer')[1]!.message;
    expect(second).toContain('<conversation>');
    expect(second).toContain('ECS와 Fargate 차이 알려줘');
    expect(second).toContain('마지막 문장입니다.');
  });

  it('첫 질문의 답변 팀원에게는 앞 대화 블록을 넘기지 않는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    await session({ team }).handle('안녕');
    expect(team.calls.find((c) => c.role === 'answerer')!.message).not.toContain('<conversation>');
  });

  it('이어 간 세션은 앞 대화와 이어 일할 파일을 그대로 쓴다', async () => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work')] });
    const first = session({ team, loops });
    await first.handle('Money에 할인 넣어줘');
    const saved = first.snapshot('2026-10-27T10:00:00.000Z');
    const resumed = ChatSession.resume(sessionDeps({ team, loops }), saved);
    await resumed.handle('에러 메시지만 바꿔줘');
    expect(loops.runs[1]!.context.conversation).toContain('Money에 할인 넣어줘');
    expect([...loops.runs[1]!.carried]).toEqual([['src/money.ts', 'modified:h1']]);
    expect(resumed.status()).toMatchObject({ turns: 2, lastTitle: 'Money에 퍼센트 할인 discount 추가' });
  });

  it('clear는 세션 대화만 비우고 기억과 이어 일할 파일은 남긴다', async () => {
    const memory = new FakeMemory();
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work')] });
    const chat = session({ team, loops, memory });
    await chat.handle('Money에 할인 넣어줘');
    chat.clear();
    await chat.handle('다른 거 해줘');
    expect(loops.runs[1]!.context.conversation).toBeNull();
    expect(loops.runs[1]!.carried.size).toBe(1);
    expect(memory.nodes.size).toBeGreaterThan(0);
    expect(chat.status().turns).toBe(1);
  });

  it('사용량은 팀원 호출과 작업 비용을 모두 더한다', async () => {
    const team = new FakeTeam({ router: [route('work')] });
    const chat = session({ team });
    await chat.handle('Money에 할인 넣어줘');
    expect(chat.usage().costUsd).toBeCloseTo(0.052);
  });
});

describe('ChatSession — 가벼운 질문 (light)', () => {
  const answer = () => ({ answer: '2입니다.', claims: [] });
  const basis = RepoRef.of({ branch: 'main', commit: 'a1b2c3d'.padEnd(40, '0'), dirty: false });
  const fullKnowledge = (log: string[]) => ({
    current: async () => (log.push('current'), { block: '<repo_knowledge>전체</repo_knowledge>', basis }),
    stored: async () => (log.push('stored'), null),
    noteChanged: async () => undefined,
  });

  it('인사·짧은 질문은 저장소 파악 팀원을 부르지 않고 저장소 지식도 새로 읽지 않는다', async () => {
    const log: string[] = [];
    const team = new FakeTeam({ router: [route('question', false, null, { depth: 'light' })], answerer: [answer] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), knowledge: fullKnowledge(log) }).handle('1+1은 얼마야?');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(turn).toMatchObject({ kind: 'answer', answer: '2입니다.' });
    expect(team.calls.map((c) => c.role)).toEqual(['router', 'answerer']);
    expect(log).not.toContain('current');
  });

  it('light 답은 haiku 등급 팀원이 답한다', async () => {
    const team = new FakeTeam({ router: [route('question', false, null, { depth: 'light' })], answerer: [answer] });
    await session({ team }).handle('1+1은 얼마야?');
    expect(team.calls.find((c) => c.role === 'answerer')!.tier).toBe('haiku');
  });

  it('light 답은 이미 저장된 저장소 지식이 있으면 그것만 쓴다', async () => {
    const stored = { block: '<repo_knowledge repo="shop">저장된 요약</repo_knowledge>', basis };
    const knowledge = { current: async () => { throw new Error('읽으면 안 됨'); }, stored: async () => stored, noteChanged: async () => undefined };
    const team = new FakeTeam({ router: [route('question', false, null, { depth: 'light' })], answerer: [answer] });
    await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('이 저장소 뭐 하는 거야?');
    expect(team.calls.find((c) => c.role === 'answerer')!.message).toContain('저장된 요약');
  });

  it('인사는 라우터가 deep이라 해도 light로 답한다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [answer] });
    await session({ team }).handle('안녕');
    expect(team.calls.find((c) => c.role === 'answerer')!.tier).toBe('haiku');
  });

  it('light 답은 더 깊게 알아볼 수 있다고 알리고, deep 답은 알리지 않는다', async () => {
    const light = await session({ team: new FakeTeam({ router: [route('question', false, null, { depth: 'light' })], answerer: [answer] }) }).handle('1+1은 얼마야?');
    const deep = await session({ team: new FakeTeam({ router: [route('question')], answerer: [answer] }) }).handle('이 함수 어디서 써?');
    expect(light).toMatchObject({ kind: 'answer', canGoDeeper: true });
    expect(deep).toMatchObject({ kind: 'answer', canGoDeeper: false });
  });

  it('더 깊게 알아보면 라우터 없이 sonnet 등급 팀원이 같은 질문에 다시 답한다', async () => {
    const team = new FakeTeam({ router: [route('question', false, null, { depth: 'light' })], answerer: [answer, () => ({ answer: '자세히: 2입니다.', claims: [] })] });
    const chat = session({ team });
    await chat.handle('1+1은 얼마야?');
    const deeper = await chat.handle('1+1은 얼마야?', [], 'deep');
    expect(deeper).toMatchObject({ kind: 'answer', answer: '자세히: 2입니다.', canGoDeeper: false });
    expect(team.calls.map((c) => c.role)).toEqual(['router', 'answerer', 'answerer']);
    expect(team.calls.at(-1)!.tier).toBe('sonnet');
  });
});

describe('ChatSession — 저장소 조사는 답한 뒤 배경에서', () => {
  const gated = () => {
    const log: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const knowledge = {
      current: async () => {
        log.push('current:start');
        await gate;
        log.push('current:end');
        return null;
      },
      stored: async () => null,
      noteChanged: async () => undefined,
    };
    return { log, release, knowledge };
  };

  it('deep 질문은 조사가 끝나길 기다리지 않고 답하며, 답한 뒤에 조사를 시작한다', async () => {
    const { log, release, knowledge } = gated();
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('이 함수 어디서 써?');
    expect(turn).toMatchObject({ kind: 'answer', answer: '네.' });
    await vi.waitFor(() => expect(log).toEqual(['current:start']));
    release();
  });

  it('조사는 세션에서 한 번만 돈다', async () => {
    const { log, release, knowledge } = gated();
    release();
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네.', claims: [] })] });
    const chat = ChatSession.start({ ...sessionDeps({ team }), knowledge });
    await chat.handle('이 함수 어디서 써?');
    await chat.handle('저 함수는 어디서 써?');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log.filter((l) => l === 'current:start')).toHaveLength(1);
  });

  it('light 답에는 조사를 돌리지 않는다 (한도를 아낀다)', async () => {
    const { log, release, knowledge } = gated();
    release();
    const team = new FakeTeam({ router: [route('question', false, null, { depth: 'light' })], answerer: [() => ({ answer: '2', claims: [] })] });
    await ChatSession.start({ ...sessionDeps({ team }), knowledge }).handle('1+1은 얼마야?');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual([]);
  });
});

describe('ChatSession — 문서 팀원이 만든 파일은 이어 일할 파일이다', () => {
  const snapshotOf = (...paths: string[]) => async () => ({ files: new Map(paths.map((p) => [p, 'added:h1'])) });
  const run = async (files: string[], snapshot: string[], workspaceRoot?: string) => {
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('task'), route('work')], writer: [() => ({ summary: '썼어요', files })] });
    const deps = sessionDeps({ team, loops });
    const chat = ChatSession.start({ ...deps, workspace: { ...deps.workspace, snapshot: snapshotOf(...snapshot) }, ...(workspaceRoot !== undefined ? { workRoot: workspaceRoot } : {}) });
    await chat.handle('NOTES.md 만들어 줘');
    await chat.handle('src/money.ts 고쳐 줘');
    return loops.runs[0]!.carried;
  };

  it('문서 팀원이 보고한 파일이 작업 폴더에 있으면 다음 코드 작업의 이어 일할 파일로 넘긴다 (커밋 안 한 새 파일이라며 거절하지 않게)', async () => {
    expect([...(await run(['NOTES.md'], ['NOTES.md'])).keys()]).toEqual(['NOTES.md']);
  });

  it('작업 폴더의 절대 경로로 보고해도 폴더 기준 경로로 등록한다', async () => {
    expect([...(await run(['E:/w/shop-api/docs/NOTES.md'], ['docs/NOTES.md'], 'E:/w/shop-api')).keys()]).toEqual(['docs/NOTES.md']);
  });

  it('실제로 없는 파일이나 작업 폴더 밖(다른 레포)에 쓴 파일은 등록하지 않는다', async () => {
    expect((await run(['GHOST.md', 'E:/w/shop-web/OTHER.md', '../shop-web/OTHER.md'], ['NOTES.md', 'OTHER.md'], 'E:/w/shop-api')).size).toBe(0);
  });
});

describe('ChatSession — 레포 하나짜리 작업 공간', () => {
  it('답변 팀원에게 이 세션은 레포 하나(이름)만 읽을 수 있다고 알려, 옆 레포를 "없다"고 단정하지 않게 한다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네', claims: [] })] });
    await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api' }).handle('shop-web 폴더 봐줘');
    const message = team.calls.find((c) => c.role === 'answerer')!.message;
    expect(message).toContain('<single_repo name="shop-api">');
    expect(message).toContain('parent folder');
  });

  it('문서 팀원에게도 같은 안내를 준다', async () => {
    const team = new FakeTeam({ router: [route('task')], writer: [() => ({ summary: '네', files: [] })] });
    await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api' }).handle('shop-web 정리해 줘');
    expect(team.calls.find((c) => c.role === 'writer')!.message).toContain('<single_repo name="shop-api">');
  });

  it('여러 레포 작업 공간에는 이 안내를 넣지 않는다', async () => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네', claims: [] })] });
    const folder = { root: 'E:/w', repos: [{ name: 'shop-api', root: 'E:/w/shop-api' }, { name: 'shop-web', root: 'E:/w/shop-web' }] };
    await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api', folder }).handle('shop-web 봐줘');
    expect(team.calls.find((c) => c.role === 'answerer')!.message).not.toContain('<single_repo');
  });
});

describe('ChatSession — 다른 레포를 근거로 든 인용', () => {
  const quote = 'Math.floor(this.amount * rate)';
  const claim = (path: string) => ({ text: 'floor를 쓴다', evidence: [{ ...blank, kind: 'code', path, line: 3, quote }] });
  const ask = async (path: string, read: (p: string) => Promise<string | null>) => {
    const team = new FakeTeam({ router: [route('question')], answerer: [() => ({ answer: '네', claims: [claim(path)] })] });
    const reads: string[] = [];
    const also = [{ name: 'shop-web', root: 'E:/w/shop-web', knowledge: null, read: async (p: string) => (reads.push(p), read(p)) }];
    const turn = await ChatSession.start({ ...sessionDeps({ team }), repoName: 'shop-api' }).handle('shop-web의 floor는?', also);
    return { turn, reads };
  };
  const found = async () => `return ${quote}`;

  it('현재 레포에 없고 함께 읽는 레포 안에 있는 파일이면 그 레포에서 읽어 근거를 확인한다', async () => {
    const { turn, reads } = await ask('E:/w/shop-web/src/money.ts', found);
    expect(reads).toEqual(['E:/w/shop-web/src/money.ts']);
    expect(turn.kind === 'answer' && turn.checked[0]!.isGuess).toBe(false);
  });

  it('레포 이름으로 시작하는 상대 경로는 그 레포 안의 경로로 읽는다', async () => {
    const { turn, reads } = await ask('shop-web/src/money.ts', async (p) => (p === 'src/money.ts' ? found() : null));
    expect(reads[0]).toBe('src/money.ts');
    expect(turn.kind === 'answer' && turn.checked[0]!.isGuess).toBe(false);
  });

  it('루트 밖으로 나가는 경로는 다른 레포를 읽지 않고 추측으로 남긴다', async () => {
    const { turn, reads } = await ask('E:/w/shop-web/../shop-api/src/money.ts', found);
    expect(reads).toEqual([]);
    expect(turn.kind === 'answer' && turn.checked[0]!.isGuess).toBe(true);
  });

  it('그 레포의 읽기가 비밀 파일이라며 null을 주면 추측으로 남긴다', async () => {
    const { turn } = await ask('E:/w/shop-web/.env', async () => null);
    expect(turn.kind === 'answer' && turn.checked[0]!.isGuess).toBe(true);
  });
});

describe('ChatSession — 문서만 고치는 요청', () => {
  it('라우터가 work라 해도 README만 고치는 요청은 테스트 팀원 없이 문서 팀원이 한다', async () => {
    const team = new FakeTeam({ router: [route('work')], writer: [() => ({ title: 'README', summary: '추가했어요', files: ['README.md'], claims: [] })] });
    const loops = new FakeLoops();
    await session({ team, loops }).handle('README.md 맨 아래에 hello rauha 한 줄을 추가해 줘');
    expect(loops.runs).toEqual([]);
    expect(team.calls.map((c) => c.role)).toEqual(['router', 'writer']);
  });

  it('코드 파일을 고치는 요청은 여전히 작업 루프로 간다', async () => {
    const loops = new FakeLoops();
    await session({ team: new FakeTeam({ router: [route('work')] }), loops }).handle('src/money.ts의 add 함수 고쳐줘');
    expect(loops.runs).toHaveLength(1);
  });
});

// ── 분석 흐름 (조사 → 방향 비교 → 설계·계획 → 승인하면 구현) ──────────

function finishedRun(input: { approve: boolean; pick?: string }): AnalysisRun {
  const run = AnalysisRun.start({ id: 'run-1', request: '결제가 왜 두 번 깎여?', reach: AnalysisReach.of('plan', ''), date: '2026-10-25' });
  run.recordInvestigation(Investigation.of({ symptom: '두 번 깎인다', facts: [{ text: '재시도', evidence: 'src/pay.ts:3' }], causes: [], unknowns: [] }));
  run.offerDirections(
    DirectionSet.of(
      [
        { id: 'a', title: '멱등 키', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'easy', touches: [] },
        { id: 'b', title: '락', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'medium', touches: [] },
      ],
      'a',
      '쉽다',
    ),
  );
  run.choose({ kind: 'pick', id: input.pick ?? 'a' });
  run.recordBlueprint(Blueprint.of({ goal: '한 번만 결제', nonGoals: [], changes: [{ where: 'src', what: 'x' }], flow: [], edgeCases: [], rejected: [], testStrategy: 't', steps: [{ title: '키', testFirst: '두 번이어도 한 번', files: ['src/pay.ts'], verify: 'yarn test' }], risks: [] }));
  if (input.approve) {
    run.approve();
    run.markImplemented();
  } else run.stop('user');
  return run;
}

class FakeAnalyst implements AnalysisPort {
  readonly inputs: AnalysisInput[] = [];
  constructor(private readonly result: (input: AnalysisInput) => AnalysisResult) {}
  async run(input: AnalysisInput): Promise<AnalysisResult> {
    this.inputs.push(input);
    return this.result(input);
  }
}

const analysisResult = (run: AnalysisRun, over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  run,
  path: 'docs/analysis/2026-10-25-결제.md',
  docProblem: null,
  cost: [{ tier: 'sonnet', calls: 3, costUsd: 0.03 }],
  brief: run.wasImplemented ? { request: '한 번만 결제\n- 1단계 키: 두 번이어도 한 번', block: '<design title="결제">계획</design>' } : null,
  summary: '분석: 결제가 왜 두 번 깎여?\n문서: docs/analysis/2026-10-25-결제.md',
  ...over,
});

describe('ChatSession — 분석 흐름', () => {
  it('debug이고 분석을 청한 말이면 분석 흐름을 타고 기존 한 번 호출 분석 팀원은 부르지 않는다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const team = new FakeTeam({ router: [route('debug', false, null, { reach: 'compare' })], debugger: [() => ({ answer: '옛 길', files: [] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), analyst }).handle('결제가 왜 두 번 깎여?');
    expect(turn.kind).toBe('analysis');
    expect(team.calls.map((c) => c.role)).toEqual(['router']);
    expect(analyst.inputs[0]).toMatchObject({ role: 'debugger', reach: 'compare', repo: expect.any(String) });
  });

  it('risk는 위험 점검 팀원이 맡도록 분석 흐름에 넘긴다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const team = new FakeTeam({ router: [route('risk')] });
    await ChatSession.start({ ...sessionDeps({ team }), analyst }).handle('이 변경 위험한 거 없는지 분석해줘');
    expect(analyst.inputs[0]!.role).toBe('riskchecker');
  });

  it('분석 낱말이 없는 debug는 지금처럼 팀원 한 번 호출로 간다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const team = new FakeTeam({ router: [route('debug')], debugger: [() => ({ answer: '원인', files: [] })] });
    const turn = await ChatSession.start({ ...sessionDeps({ team }), analyst }).handle('테스트 깨졌어 고쳐줘');
    expect(turn.kind).toBe('answer');
    expect(analyst.inputs).toEqual([]);
  });

  it('분석 팀이 없으면(설정에서 껐으면) 분석을 청해도 지금처럼 한 번 호출이다', async () => {
    const team = new FakeTeam({ router: [route('debug')], debugger: [() => ({ answer: '원인', files: [] })] });
    const turn = await session({ team }).handle('결제가 왜 두 번 깎여?');
    expect(turn.kind).toBe('answer');
  });

  it('다른 저장소를 함께 가리킨 분석은 그 저장소 폴더를 읽기 폴더로 분석 흐름에 넘긴다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const team = new FakeTeam({ router: [route('debug', false, null, { reach: 'compare' })] });
    const also = [{ name: 'shop-web', root: 'E:/w/shop-web', knowledge: null }];
    await ChatSession.start({ ...sessionDeps({ team }), analyst }).handle('결제가 왜 두 번 깎여? shop-web과 원인 비교 분석해줘', also);
    expect(analyst.inputs[0]!.readDirs).toEqual(['E:/w/shop-web']);
  });

  it('단순 수정 요청(work)과 질문은 분석 낱말이 있어도 분석 흐름을 타지 않는다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const loops = new FakeLoops();
    const team = new FakeTeam({ router: [route('work'), route('question', false, null, { depth: 'light' })], answerer: [() => ({ answer: '네', claims: [] })] });
    const chat = ChatSession.start({ ...sessionDeps({ team, loops }), analyst });
    await chat.handle('Money.add가 왜 빼기를 해? 고쳐줘');
    await chat.handle('분석이 뭐야?');
    expect(analyst.inputs).toEqual([]);
    expect(loops.runs).toHaveLength(1);
  });

  it('분석에 든 호출 수는 세션 호출 수에 합쳐진다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const chat = ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('debug')] }) }), analyst });
    await chat.handle('결제가 왜 두 번 깎여?');
    expect(chat.usage().calls.sonnet).toBe(3);
  });

  it('승인되면 계획이 그대로 작업 루프의 설계 블록이 되고, 사용자가 고른 방향이 결과에 담긴다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: true, pick: 'b' })));
    const loops = new FakeLoops();
    const turn = await ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('debug')] }), loops }), analyst }).handle('결제가 왜 두 번 깎여? 분석하고 계획까지');
    expect(loops.runs).toHaveLength(1);
    expect(loops.runs[0]!.context.design).toBe('<design title="결제">계획</design>');
    expect(loops.runs[0]!.request).toContain('한 번만 결제');
    expect(turn).toMatchObject({ kind: 'analysis', stopped: false, choice: { recommended: '멱등 키', chosen: '락', diverged: true } });
    expect(turn.kind === 'analysis' && turn.implemented !== null).toBe(true);
  });

  it('승인하지 않으면 작업 루프를 돌리지 않는다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const loops = new FakeLoops();
    const turn = await ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('debug')] }), loops }), analyst }).handle('결제가 왜 두 번 깎여?');
    expect(loops.runs).toEqual([]);
    expect(turn).toMatchObject({ kind: 'analysis', stopped: true, implemented: null });
  });

  it('쓴 분석 문서를 세션이 남긴 파일로 등록해 승인한 구현이 새 파일 때문에 거절되지 않는다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: true })));
    const loops = new FakeLoops();
    const deps = sessionDeps({ team: new FakeTeam({ router: [route('debug')] }), loops });
    const workspace = { ...deps.workspace, snapshot: async () => ({ files: new Map([['docs/analysis/2026-10-25-결제.md', 'added:h9']]) }) };
    await ChatSession.start({ ...deps, workspace, analyst }).handle('결제가 왜 두 번 깎여?');
    expect(loops.runs[0]!.carried.get('docs/analysis/2026-10-25-결제.md')).toBe('added:h9');
  });

  it('요약이 길어 잘려도 분석 문서 경로는 앞 대화에 남아 "아까 그 문서"를 알아듣는다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false }), { summary: `${'긴 요약 '.repeat(500)}\n문서: docs/analysis/2026-10-25-결제.md` }));
    const chat = ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('debug')] }) }), analyst });
    await chat.handle('결제가 왜 두 번 깎여?');
    expect(JSON.stringify(chat.snapshot('2026-10-27T10:00:00.000Z').turns)).toContain('docs/analysis/2026-10-25-결제.md');
  });

  it('분석 결과는 기억에 남아 다음 질문이 그 분석을 찾을 수 있다', async () => {
    const analyst = new FakeAnalyst(() => analysisResult(finishedRun({ approve: false })));
    const memory = new FakeMemory();
    await ChatSession.start({ ...sessionDeps({ team: new FakeTeam({ router: [route('debug')] }), memory }), analyst }).handle('결제가 왜 두 번 깎여?');
    expect([...memory.nodes.values()].some((n) => n.text.includes('분석: 결제가 왜 두 번 깎여?'))).toBe(true);
  });
});

describe('ChatSession — 한도에 닿아 멈춘 팀원', () => {
  class StoppedTeam extends FakeTeam {
    override async run(call: MemberCall): Promise<MemberResult> {
      const ok = await super.run(call);
      if (call.role !== 'answerer') return ok;
      return { ...ok, output: null, error: 'error_max_turns: ', partial: 'src/a.ts까지 읽었어요', usage: { ...ok.usage, turns: 25, endReason: 'error_max_turns' } };
    }
  }

  it('턴 한도로 멈추면 이유와 부분 결과를 답으로 보인다 ("질문을 구체적으로" 안내로 덮지 않는다)', async () => {
    const team = new StoppedTeam({ router: [route('question')], answerer: [() => null] });
    const out = await session({ team }).handle('전체 구조 설명해줘');
    expect(out.kind).toBe('answer');
    const answer = out.kind === 'answer' ? out.answer : '';
    expect(answer).toContain('턴 한도');
    expect(answer).toContain('src/a.ts까지 읽었어요');
    expect(answer).not.toContain('구체적으로');
  });

  it("멈춘 이유와 마지막으로 한 일을 앞 대화에 남겨 '이어서'가 볼 수 있다", async () => {
    const team = new StoppedTeam({ router: [route('question')], answerer: [() => null] });
    const chat = session({ team });
    await chat.handle('전체 구조 설명해줘');
    await chat.handle('이어서');
    const message = team.calls.filter((c) => c.role === 'router').at(-1)!.message;
    expect(message).toContain('턴 한도');
    expect(message).toContain('마지막으로 한 일: src/a.ts까지 읽었어요');
  });
});
