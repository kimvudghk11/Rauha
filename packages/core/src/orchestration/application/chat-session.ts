import type { DesignPort } from '../../design/application/design.service.js';
import { DesignDocDto } from '../../design/application/dto/design.dto.js';
import type { KnowledgePort } from '../../knowledge/application/ports.js';
import type { MemoryPort } from '../../memory/application/memory.port.js';
import { continuable, recallBlock, WorkMemory, type MemoryEntry, type Recall } from '../../memory/domain/work-memory.js';
import { citedPaths, FactCheck, normalizeUrl, type CheckedClaim } from '../domain/fact-check.js';
import { LearningBook } from '../domain/learning-book.js';
import type { CompanyEntry } from '../domain/company-book.js';
import { isSmallTalk, looksLikeQuestion, sameQuestionKey, wantsToProceed } from '../domain/question-hint.js';
import type { ModelTier } from '../domain/team.js';
import { AnswerDto } from './dto/answer.dto.js';
import type { MemberRole, RoleSettingsDto } from './dto/role-settings.dto.js';
import type { ChatSnapshot } from './dto/chat-snapshot.dto.js';
import { FilesBlockDto } from './dto/files-block.dto.js';
import { ReviewReportDto } from './dto/review-report.dto.js';
import { RouteDto, type Route } from './dto/route.dto.js';
import { ANSWER_SCHEMA, OPS_SCHEMA, REVIEWER_REPORT_SCHEMA, ROUTE_SCHEMA, WRITER_SCHEMA } from './dto/schemas.js';
import { WriterReportDto } from './dto/writer-report.dto.js';
import { OpsReportDto } from './dto/ops-report.dto.js';
import type { RunContextBlocks, RunOutcome } from './minimal-loop.service.js';
import type { SessionBudget } from '../domain/session-budget.js';
import { CompanyDesk, type MemberOptions } from './company-desk.js';
import type { CompanyBookPort, LearningPort, MemberResult, PreparedCall, ProgressPort, TeamMemberPort, UserPort, WorkspacePort } from './ports.js';
import { conversationBlock } from './prompt-blocks.js';
import type { DesignTaskResult, TurnOutcome } from './turn-outcome.js';

export type { RunContextBlocks };


/** 팀장에게 넘길 앞 대화 턴 수 */
const CONVERSATION_TURNS = 6;
/** 결과 글을 얼마나 남기고 넘기는지. 바로 앞 턴은 길게("두 번째 거 더 자세히"가 가리키는 곳이 거기다), 그 전은 짧게. */
const KEPT_RESULT_CHARS = 1200;
const OLDER_RESULT_CHARS = 300;
/** 기억 묶음 글자 수 상한 */
const MEMORY_CHARS = 3000;
const CANDIDATES = 3;

export type { DesignTaskResult, TurnOutcome } from './turn-outcome.js';

export interface ChatSessionDeps {
  /** 요청 하나를 돌릴 최소 루프. carried = 세션 중 rauha가 남긴 파일(그 위에서 이어 일함). */
  readonly newLoop: (carried: ReadonlyMap<string, string>) => { run(request: string, context: RunContextBlocks): Promise<RunOutcome> };
  readonly team: TeamMemberPort;
  readonly workspace: Pick<WorkspacePort, 'readFile' | 'reviewChanges'>;
  readonly memory: MemoryPort;
  readonly user: UserPort;
  readonly progress: ProgressPort;
  readonly roles: RoleSettingsDto;
  readonly now: () => number;
  readonly newId: () => string;
  readonly today: () => string;
  /** 지금 날짜와 시각을 사람이 읽는 글로(시간대 포함). 컴퓨터 시계에서 읽은 값이라 답변 팀원이 그대로 쓴다. */
  readonly nowText: () => string;
  /** 저장소 지식. 있으면 답변 팀원 메시지 맨 앞에 넣고 답에 기준을 밝힌다. 라우터에는 넣지 않는다. */
  readonly knowledge?: KnowledgePort;
  /** 작업 공간에서 이 세션의 저장소 이름. 여러 저장소 답의 기준에 쓴다. */
  readonly repoName?: string;
  /** 작업 공간 폴더(rauha를 띄운 폴더)와 그 안의 저장소들. 저장소가 둘 이상이면 답변·문서 팀원에게 알려 폴더 위치를 잘못 말하지 않게 한다. */
  readonly folder?: { readonly root: string; readonly repos: readonly { readonly name: string; readonly root: string }[] } | undefined;
  /** 설계 대화. 없거나 사용자와 주고받을 화면이 없으면 기능 요청도 바로 작업으로 진행한다. */
  readonly designer?: DesignPort | undefined;
  /** 구독 한도를 얼마나 썼는지. 빠듯하면 부서장이 sonnet으로, 위험하면 큰 요청을 미룬다. 없으면 넉넉하다고 본다. */
  readonly budget?: () => SessionBudget;
  /** 회사 장부. 있으면 부서 팀원 입력에 이미 정한 것을 싣고, 부서 결과를 요약해 남긴다. */
  readonly company?: CompanyBookPort;
  /** 학습 노트. 있으면 작업이 끝날 때 쓰인 패턴과 이유를 모아 둔다(새 호출 없이). */
  readonly learning?: LearningPort;
}

/** 저장소가 이 수를 넘으면 문서 팀원 한 명이 다 읽지 않고, 저장소마다 나눠 읽은 요약을 모아 쓴다. */
const GATHER_ABOVE = 4;
/** 저장소를 나눠 읽을 때 동시에 돌리는 수 */
const GATHER_PARALLEL = 4;
/** 함께 묻는 다른 저장소가 이 수를 넘으면 그 저장소들의 지식은 미리 만들지 않는다(저장소마다 조사 팀원이 돌아 오래 걸린다). 답변 팀원이 직접 읽는다. */
const ALSO_KNOWLEDGE_MAX = 3;

/** 라우터가 작업으로 판정해 멈춘 뒤에 뒤늦게 시작하려던 답변. 아무 일도 하지 않은 것으로 돌려준다. */
const STOPPED: MemberResult = {
  output: null,
  error: '멈춘 답변',
  fetched: [],
  usage: { model: 'sonnet', durationMs: 0, costUsd: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, denials: [], endReason: 'error' },
};

/** 답변 팀원에게 넘길 저장소 지식 묶음과 그 기준 */
interface Known {
  readonly block: string;
  readonly basis: string;
}

/** 여러 저장소에 걸친 질문에서 함께 읽을 다른 저장소 */
export interface AlsoRepo {
  readonly name: string;
  readonly root: string;
  readonly knowledge: KnowledgePort | null;
}

/** 함께 읽을 저장소와 그 지식(없으면 null) */
interface AlsoKnown {
  readonly name: string;
  readonly root: string;
  readonly known: Known | null;
}

const MANY_REPO_WORK = '여러 저장소를 한 번에 고치는 일은 아직 하지 않아요. 저장소마다 나눠서 요청해 주세요.';

/** 한도가 위험해 미뤄 둔 큰 요청. 사용자가 "그래도 진행"이라고 하면 이것을 그대로 한다. */
interface HeldRequest {
  readonly input: string;
  readonly route: Route;
}

/** 같은 질문을 다시 했을 때 앞 답을 다시 보여 주는 시간 */
const REPEAT_WINDOW_MS = 30 * 60_000;


interface Turn {
  readonly input: string;
  readonly result: string;
}

/** 끝난 실행 → 기억 그래프 점과 선. 대화 세션과 한 번 실행(-p)이 같은 규칙으로 남긴다. */
export function workMemoryFrom(outcome: RunOutcome, p: { id: string; at: string; request: string; extendsWork: string | null }): MemoryEntry {
  return WorkMemory.fromWork({
    id: p.id,
    at: p.at,
    title: outcome.title,
    request: p.request,
    status: outcome.status,
    changedFiles: outcome.changedInRun.filter((c) => c.kind !== 'deleted').map((c) => c.path),
    lockedTests: outcome.lockedTests,
    decisions: outcome.facts.checked.filter((c) => c.kind === 'decision').map((c) => ({ text: c.text, verified: !c.isGuess, rejected: null })),
    assumptions: outcome.assumptions.map((a) => ({ question: a.question, chosen: a.chosen })),
    extendsWork: p.extendsWork,
    basis: outcome.basis,
  });
}

/**
 * 대화 모드 한 세션. 입력마다 라우터가 작업/질문을 가르고, 작업은 최소 루프로, 질문은 답변 팀원으로 보낸다.
 * 끝난 일은 기억 그래프에 남긴다. /clear는 세션 대화만 비우고 기억과 이어 일할 파일은 둔다.
 */
export class ChatSession {
  private turns: Turn[] = [];
  /** 세션 중 rauha가 바꾼 파일 → 마지막으로 남긴 내용 값 */
  private carried = new Map<string, string>();
  private costUsd = 0;
  private readonly calls: Record<ModelTier, number> = { haiku: 0, sonnet: 0, opus: 0 };
  private lastTitle: string | null = null;
  private held: HeldRequest | null = null;
  /** 방금 한 질문과 그 답. 코드를 바꾸는 일이 있거나 /clear 하면 비운다. */
  private answered = new Map<string, { answer: string; at: number }>();

  /** 회사 부서가 하는 일(기획·디버깅·위험 점검·부서장 배분·런칭). 호출과 비용 합산은 세션이 빌려준다. */
  private readonly desk: CompanyDesk;

  private constructor(private readonly deps: ChatSessionDeps) {
    this.desk = new CompanyDesk(
      {
        member: (role, parts, schema, options) => this.member(role, parts, schema, options),
        settle: (label, input, answer, remembered, started, costBefore) => this.settle(label, input, answer, remembered, started, costBefore),
        spent: () => this.costUsd,
        workspaceBlock: () => this.workspaceBlock(),
      },
      { today: deps.today, now: deps.now, progress: deps.progress, budget: deps.budget, company: deps.company },
    );
  }

  /** 매 입력마다 부르는 라우터·답변 팀원은 미리 띄워 둔다(띄우는 데만 2초쯤 걸린다). */
  static start(deps: ChatSessionDeps): ChatSession {
    const session = new ChatSession(deps);
    deps.team.prepare?.(session.callFor('router', ROUTE_SCHEMA));
    deps.team.prepare?.(session.callFor('answerer', ANSWER_SCHEMA));
    return session;
  }

  /** 저장해 둔 대화를 이어 연다(rauha --continue, /update 뒤). 앞 대화와 이어 일할 파일을 그대로 쓴다. */
  static resume(deps: ChatSessionDeps, snapshot: ChatSnapshot): ChatSession {
    const session = ChatSession.start(deps);
    session.turns = snapshot.turns.map((t) => ({ input: t.input, result: t.result }));
    session.carried = new Map(snapshot.carried);
    session.lastTitle = snapshot.lastTitle;
    return session;
  }

  /** 다시 열 때 필요한 상태. savedAt: ISO 시각 */
  snapshot(savedAt: string): ChatSnapshot {
    return { version: 1, turns: [...this.turns], carried: [...this.carried], lastTitle: this.lastTitle, savedAt };
  }

  /**
   * 라우터의 판정을 기다리지 않고 답변 팀원도 함께 시작한다. 질문이면 판정 시간만큼 빨리 답하고,
   * 작업이거나 지난 작업을 골라야 하는 질문이면 미리 시작한 답변은 멈추고 버린다.
   */
  async handle(input: string, also: readonly AlsoRepo[] = [], force?: 'design'): Promise<TurnOutcome> {
    const started = this.deps.now();
    const conversation = this.conversation();
    const heldRequest = this.held;
    this.held = null;
    if (heldRequest !== null && wantsToProceed(input)) return this.rerun(heldRequest, conversation, started);
    const again = this.repeated(input);
    if (again !== null) return { kind: 'answer', answer: again, checked: [], costUsd: 0, durationMs: 0, basis: null };
    // /design: 라우터를 거치지 않고 바로 설계부터 한다.
    if (force === 'design') {
      if (also.length > 0) return { kind: 'notice', message: MANY_REPO_WORK };
      return this.canDesign() ? this.feature(input, conversation, started) : { kind: 'notice', message: '설계 대화는 터미널 대화 모드에서만 할 수 있어요.' };
    }
    const early = new AbortController();
    // 저장소 지식은 답변 팀원이 필요할 때 처음 한 번만 읽는다(처음이면 조사 팀원이 저장소를 훑는다). 작업·인사에는 읽지 않는다.
    const smallTalk = isSmallTalk(input);
    let knownRun: Promise<Known | null> | undefined;
    let othersRun: Promise<AlsoKnown[]> | undefined;
    const known = () => (knownRun ??= smallTalk ? Promise.resolve(null) : this.knowledgeOf());
    const others = () => (othersRun ??= smallTalk ? Promise.resolve([]) : Promise.all(also.map(async (r): Promise<AlsoKnown> => ({ name: r.name, root: r.root, known: also.length <= ALSO_KNOWLEDGE_MAX ? await this.knowledgeOf(r.knowledge) : null }))));
    // 질문처럼 보일 때만 미리 시작한다. 시키는 말에 미리 시작하면 판정이 나는 순간 버려질 호출이 하나 생긴다.
    const asked = looksLikeQuestion(input) ? Promise.all([known(), others()]).then(([k, o]) => this.askAnswerer(input, null, k, conversation, early.signal, o)) : null;
    // 라우터를 기다리는 동안 실패해도 처리 안 된 거절로 프로세스가 죽지 않게. 쓰기로 하면 answer()가 await에서 다시 받는다.
    asked?.catch(() => undefined);
    const routed = await this.member('router', [conversationBlock(conversation), `<message>\n${input}\n</message>`], ROUTE_SCHEMA, {});
    const route = RouteDto.read(routed.output);
    if (routed.blocked || route.mode !== 'question' || route.refersToPast) early.abort();
    if (routed.blocked) return { kind: 'blocked', ...routed.blocked };
    if (route.mode === 'task') return this.task(input, conversation, also, started);
    if (route.mode === 'ops') return this.ops(input, conversation, started);
    if (route.mode === 'debug') return this.desk.analyze('debugger', '디버깅', input, conversation, started);
    if (route.mode === 'company') return (route.member === null ? this.hold(input, route) : null) ?? this.desk.company(input, conversation, route, started);
    if (route.mode === 'launch') return this.hold(input, route) ?? this.desk.launch(input, conversation, started);
    if (route.mode === 'ideate') return this.desk.analyze('planner', '기획', input, conversation, started, 'planning');
    if (route.mode === 'risk') return this.desk.analyze('riskchecker', '위험 점검', input, conversation, started);
    const changesCode = route.mode === 'work' || route.mode === 'feature';
    if (changesCode && also.length > 0) return { kind: 'notice', message: MANY_REPO_WORK };
    const past = route.refersToPast ? await this.pickPast(route.pastQuery ?? input, route.mode) : null;
    // 기능 요청은 설계 대화부터. 사용자와 주고받을 화면이 없으면(-p) 작업으로 바로 진행한다.
    if (route.mode === 'feature' && past === null && this.canDesign()) return this.feature(input, conversation, started);
    if (changesCode) return this.work(input, conversation, past);
    const answered = await this.answer(input, route.refersToPast || asked === null ? this.askAnswerer(input, past, await known(), conversation, undefined, await others()) : asked, started);
    if (answered.kind === 'answer' && !route.refersToPast) this.answered.set(sameQuestionKey(input), { answer: answered.answer, at: this.deps.now() });
    return answered;
  }

  clear(): void {
    this.turns = [];
    this.answered.clear();
  }

  /** 작업의 결정에서 쓰인 패턴을 학습 노트에 모은다. 새 호출은 없고, 저장에 실패해도 작업 결과는 그대로 보인다. */
  private async learn(outcome: RunOutcome): Promise<void> {
    const decisions = outcome.explanation?.decisions ?? [];
    if (this.deps.learning === undefined || decisions.length === 0) return;
    const notes = LearningBook.notesFrom(decisions.map((d) => ({ what: d.what, why: d.why })), this.at());
    if (notes.length === 0) return;
    try {
      await this.deps.learning.save((await this.deps.learning.load()).add(notes));
    } catch {
      // 노트는 복습을 돕는 참고라서, 남기지 못해도 작업 결과는 그대로 보인다.
    }
  }

  /** /learn: 모인 학습 노트 */
  async learningNotes(): Promise<LearningBook> {
    return (await this.deps.learning?.load()) ?? LearningBook.empty();
  }

  /** /company: 회사가 이미 정한 것(부서별 가장 최근 결과의 요약) */
  async companyEntries(): Promise<readonly CompanyEntry[]> {
    return (await this.deps.company?.load())?.entries ?? [];
  }

  status(): { turns: number; carriedFiles: number; lastTitle: string | null } {
    return { turns: this.turns.length, carriedFiles: this.carried.size, lastTitle: this.lastTitle };
  }

  usage(): { costUsd: number; calls: Readonly<Record<ModelTier, number>> } {
    return { costUsd: this.costUsd, calls: { ...this.calls } };
  }

  // ── 작업 ──────────────────────────────────────────────────

  private async work(input: string, conversation: string | null, past: Recall | null, design: string | null = null): Promise<TurnOutcome> {
    const outcome = await this.deps.newLoop(new Map(this.carried)).run(input, { conversation, pastWork: past === null ? null : recallBlock([past], MEMORY_CHARS), design });
    this.costUsd += outcome.costUsd;
    for (const tier of Object.keys(this.calls) as ModelTier[]) this.calls[tier] += outcome.usage[tier].calls;

    // 세션 중 바뀐 파일만 이어 일할 대상으로 남긴다(사용자가 원래 바꿔 둔 파일은 넣지 않는다).
    const touched = new Set([...this.carried.keys(), ...outcome.changedInRun.map((c) => c.path)]);
    this.carried = new Map([...touched].filter((p) => outcome.snapshotAfter.has(p)).map((p) => [p, outcome.snapshotAfter.get(p)!]));

    await this.deps.memory.save(workMemoryFrom(outcome, { id: this.deps.newId(), at: this.at(), request: input, extendsWork: past?.work.id ?? null }));
    await this.learn(outcome);
    this.answered.clear();
    this.lastTitle = outcome.title;
    this.turns.push({ input, result: `작업 "${outcome.title}" ${outcome.status === 'complete' ? '완료' : `멈춤(${outcome.stopReason})`}, 바뀐 파일 ${outcome.changedInRun.map((c) => c.path).join(', ') || '없음'}` });
    return { kind: 'work', outcome };
  }

  // ── 설계 대화 ─────────────────────────────────────────────

  private canDesign(): boolean {
    return this.deps.designer !== undefined && this.deps.user.interactive && typeof this.deps.user.discuss === 'function';
  }

  /**
   * 기능 요청: 설계 팀원과 충분히 이야기해 설계를 승인받고, 승인된 설계의 작업을 순서대로 최소 루프에 넣는다.
   * 앞 작업이 멈추면 그것에 의존하는 작업은 하지 않고, 의존하지 않는 작업은 계속한다.
   * 승인 뒤의 접수는 설계 블록을 기준으로 거의 묻지 않는다.
   */
  private async feature(input: string, conversation: string | null, started: number): Promise<TurnOutcome> {
    const known = await this.knowledgeOf();
    const recalls = await this.deps.memory.search(input, CANDIDATES);
    const memory = recallBlock(recalls, MEMORY_CHARS);
    const result = await this.deps.designer!.run({
      request: input,
      repo: this.deps.repoName ?? '이 저장소',
      knowledge: known?.block ?? null,
      memory: memory !== '' ? `<memory>\n기억된 지난 작업과 그때의 결정입니다.\n${memory}\n</memory>` : null,
      conversation,
      basis: known?.basis ?? null,
    });
    this.costUsd += result.cost.costUsd;
    this.calls[result.cost.tier] += result.cost.calls;
    if (result.kind === 'blocked') return { kind: 'blocked', ...result.block };
    if (result.kind === 'cancelled') {
      this.turns.push({ input, result: '설계를 그만둠' });
      return { kind: 'notice', message: '설계를 그만뒀어요. 필요하면 다시 말씀해 주세요.' };
    }
    if (result.kind === 'failed') return { kind: 'notice', message: `설계를 끝내지 못했어요: ${result.message} 요청을 조금 더 구체적으로 다시 해 주세요.` };

    const { design, path } = result;
    // 설계의 이유를 기억에 남긴다. 나중에 질문에 설계의 이유로 답할 수 있다(작업 기억은 작업마다 따로 남는다).
    const decided = design.decisions.map((d) => `- ${d.what} (${d.by === 'user' ? '사용자가 정함' : 'rauha가 정함'})`);
    await this.deps.memory.save(
      WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: `설계 ${design.title}: ${input}`, answer: [design.purpose, ...decided].join('\n'), citedFiles: [], basis: known?.basis ?? null }),
    );
    const order = design.runOrder();
    const results: DesignTaskResult[] = [];
    const stopped = new Set<string>();
    for (const [i, task] of order.entries()) {
      if (design.isBlocked(task.id, stopped)) {
        stopped.add(task.id);
        results.push({ id: task.id, title: task.title, status: 'skipped', outcome: null });
        continue;
      }
      this.deps.progress.step(`설계 작업 ${i + 1}/${order.length}: ${task.title}`);
      const { request, block } = DesignDocDto.taskRequest(design, task, path);
      const turn = await this.work(request, null, null, block);
      const outcome = turn.kind === 'work' ? turn.outcome : null;
      const complete = outcome?.status === 'complete';
      if (!complete) stopped.add(task.id);
      results.push({ id: task.id, title: task.title, status: complete ? 'complete' : 'stopped', outcome });
    }
    this.turns.push({ input, result: `설계 "${design.title}" 작업 ${results.filter((r) => r.status === 'complete').length}/${results.length}개 완료` });
    return { kind: 'design', title: design.title, path, tasks: results, durationMs: this.deps.now() - started };
  }

  // ── 운영 요청 ─────────────────────────────────────────────

  /**
   * aws·terraform·kubectl 같은 명령으로 클라우드·인프라를 조회하거나 바꾸는 요청. 코드 작업이 아니라 TDD 루프를 돌리지 않는다.
   * 운영 팀원이 명령을 직접 실행하고, 위험한 명령은 도구 검사가 사용자에게 묻는다. 자격 증명 설정(aws configure)은 하지 않는다.
   */
  private async ops(input: string, conversation: string | null, started: number): Promise<TurnOutcome> {
    const costBefore = this.costUsd;
    const result = await this.member('operator', [conversationBlock(conversation), `<today>${this.deps.today()}</today>`, `<request>\n${input}\n</request>`], OPS_SCHEMA, {});
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    // 인프라가 바뀌었을 수 있어 앞의 같은 질문 답은 더 쓰지 않는다.
    this.answered.clear();
    const answer = OpsReportDto.read(result.output).toAnswer();
    return this.settle('운영', input, answer, answer, started, costBefore);
  }

  // ── 회사 부서(CompanyDesk가 맡는다) ───────────────────────

  /** 결과를 기억과 앞 대화에 남기고 답으로 돌려준다. label: 다음 대화의 말머리 */
  private async settle(label: string, input: string, answer: string, remembered: string, started: number, costBefore: number): Promise<TurnOutcome> {
    await this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: input, answer, citedFiles: [], basis: null }));
    this.turns.push({ input, result: `${label}: ${remembered.slice(0, KEPT_RESULT_CHARS)}` });
    return { kind: 'answer', answer, checked: [], costUsd: this.costUsd - costBefore, durationMs: this.deps.now() - started, basis: null };
  }

  /** 방금 한 질문을 그대로 다시 하면 앞 답(호출 없이). 코드를 바꾼 뒤이거나 오래됐으면 null. */
  private repeated(input: string): string | null {
    const hit = this.answered.get(sameQuestionKey(input));
    if (hit === undefined || this.deps.now() - hit.at > REPEAT_WINDOW_MS) return null;
    return `(방금 같은 질문에 한 답이에요. 새로 알아보려면 조금 다르게 물어봐 주세요.)\n\n${hit.answer}`;
  }

  /** 한도가 위험하면 호출이 많은 일을 미루고 안내한다. 미룬 요청은 대화에 남기고 "그래도 진행"으로 되살린다. */
  private hold(input: string, route: Route): TurnOutcome | null {
    const notice = this.desk.holdNotice();
    if (notice === null) return null;
    this.held = { input, route };
    this.turns.push({ input, result: '세션 한도가 빠듯해 미뤄 둠("그래도 진행"이라고 하면 함)' });
    return notice;
  }

  /** 미뤄 둔 요청을 한도 검사 없이 한다. */
  private rerun(held: HeldRequest, conversation: string | null, started: number): Promise<TurnOutcome> {
    return held.route.mode === 'launch' ? this.desk.launch(held.input, conversation, started) : this.desk.company(held.input, conversation, held.route, started);
  }

  // ── 문서 작업 ─────────────────────────────────────────────

  /**
   * 코드가 아닌 결과물(포트폴리오·보고서·정리 문서). 테스트로 확인할 것이 없어 TDD 대신 문서 팀원이 읽고 쓴다.
   * 크기로 돌려보내지 않는다. 문서 팀원은 .md만 쓸 수 있다.
   */
  private async task(input: string, conversation: string | null, also: readonly AlsoRepo[], started: number): Promise<TurnOutcome> {
    const current = this.deps.repoName ?? '이 저장소';
    const repos = [`- ${current} (지금 작업 폴더, 문서는 여기에)`, ...also.map((r) => `- ${r.name}: ${r.root}`)];
    const folderRoot = this.deps.folder?.root;
    const dirs = [...also.map((r) => r.root), ...(folderRoot !== undefined ? [folderRoot] : [])];

    let digests = '';
    if (also.length + 1 > GATHER_ABOVE) {
      const gathered = await this.gather(input, [{ name: current, root: this.deps.folder?.repos.find((r) => r.name === current)?.root ?? null }, ...also]);
      if ('blocked' in gathered) return { kind: 'blocked', ...gathered.blocked };
      digests = gathered.digests;
    }
    const result = await this.member(
      'writer',
      [
        conversationBlock(conversation),
        `<today>${this.deps.today()}</today>`,
        this.workspaceBlock(),
        `<repos>\n${repos.join('\n')}\n</repos>`,
        digests !== '' ? `<digests>\n${digests}\n</digests>` : '',
        `<request>\n${input}\n</request>`,
      ],
      WRITER_SCHEMA,
      { dirs, canWrite: (path) => /\.md$/i.test(path) },
    );
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    const report = WriterReportDto.read(result.output);
    const answer = report.toAnswer();
    await this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: input, answer, citedFiles: report.files, basis: null }));
    this.lastTitle = input.slice(0, 60);
    this.turns.push({ input, result: `문서: ${report.files.join(', ') || '없음'}` });
    return { kind: 'answer', answer, checked: [], costUsd: result.usage.costUsd, durationMs: this.deps.now() - started, basis: null };
  }

  /**
   * 저장소가 많은 문서 요청: 저장소마다 싼 모델이 자기 저장소만 읽고 요약을 낸다(동시에 몇 개씩).
   * 문서 팀원 한 명이 수십 개를 다 읽다 시간·턴이 모자라는 것을 피한다. 읽지 못한 저장소는 표시해서 넘긴다.
   */
  private async gather(
    input: string,
    repos: readonly { name: string; root: string | null }[],
  ): Promise<{ digests: string } | { blocked: NonNullable<MemberResult['blocked']> }> {
    const digests: string[] = new Array(repos.length).fill('');
    let blocked: MemberResult['blocked'] = undefined;
    let next = 0;
    let finished = 0;
    const worker = async () => {
      while (blocked === undefined) {
        const at = next;
        next += 1;
        const repo = repos[at];
        if (repo === undefined) return;
        const result = await this.member(
          'writer',
          [
            `<today>${this.deps.today()}</today>`,
            `<gather repo="${repo.name}"${repo.root !== null ? ` root="${repo.root}"` : ''}/>`,
            `<request>\n${input}\n</request>`,
          ],
          WRITER_SCHEMA,
          { dirs: repo.root !== null ? [repo.root] : [], canWrite: () => false, tier: 'haiku', quiet: true },
        );
        if (result.blocked) {
          blocked = result.blocked;
          return;
        }
        const report = WriterReportDto.read(result.output);
        digests[at] = `<repo name="${repo.name}">\n${result.output === null ? '(읽지 못했어요)' : report.summary}\n</repo>`;
        finished += 1;
        this.deps.progress.step(`저장소 읽는 중 ${finished}/${repos.length}`, 'writer');
      }
    };
    await Promise.all(Array.from({ length: Math.min(GATHER_PARALLEL, repos.length) }, worker));
    return blocked !== undefined ? { blocked } : { digests: digests.join('\n') };
  }

  /** 여러 저장소 작업 공간에서 rauha를 띄운 폴더와 저장소 목록. 저장소가 하나뿐이면 빈 글. */
  private workspaceBlock(): string {
    const folder = this.deps.folder;
    if (folder === undefined || folder.repos.length < 2) return '';
    return `<workspace root="${folder.root}">\n이 폴더 아래의 저장소 ${folder.repos.length}개: ${folder.repos.map((r) => r.name).join(', ')}\n</workspace>`;
  }

  // ── 질문 ──────────────────────────────────────────────────

  /** 답변 팀원 호출만. 답을 기억에 남기는 일은 이 답을 쓰기로 정한 뒤 answer()가 한다. */
  private async askAnswerer(
    input: string,
    past: Recall | null,
    known: Known | null,
    conversation: string | null,
    signal?: AbortSignal,
    others: readonly AlsoKnown[] = [],
  ): Promise<{ result: MemberResult; recalls: Recall[]; basis: string | null }> {
    // 지식을 읽는 사이 라우터가 작업이라고 판정해 이미 멈췄으면 시작하지 않는다("작업 중" 표시가 끌 곳 없이 남는다).
    if (signal?.aborted === true) return { result: STOPPED, recalls: [], basis: null };
    const recalls = past !== null ? [past] : await this.deps.memory.search(input, CANDIDATES);
    const block = recallBlock(recalls, MEMORY_CHARS);
    const result = await this.member(
      'answerer',
      [
        known?.block ?? '',
        ...others.map((o) => o.known?.block ?? `<repo name="${o.name}" root="${o.root}"/>`),
        this.workspaceBlock(),
        conversationBlock(conversation),
        `<today>${this.deps.today()}</today>`,
        `<now>${this.deps.nowText()}</now>`,
        block !== '' ? `<memory>\n기억된 지난 작업과 그때의 결정입니다.\n${block}\n</memory>` : '',
        `<question>\n${input}\n</question>`,
      ],
      ANSWER_SCHEMA,
      // 여러 저장소를 함께 묻는 질문에는 작업 공간 폴더도 열어 준다("상위 폴더를 스캔해줘").
      { signal, dirs: [...others.map((o) => o.root), ...(others.length > 0 && this.deps.folder !== undefined ? [this.deps.folder.root] : [])] },
    );
    const basis =
      others.length === 0
        ? (known?.basis ?? null)
        : [`${this.deps.repoName ?? '이 저장소'}: ${known?.basis ?? '기준 모름'}`, ...others.map((o) => `${o.name}: ${o.known?.basis ?? '기준 모름'}`)].join(', ');
    return { result, recalls, basis };
  }

  /** 저장소 지식. 없거나(git 아님) 읽다 실패하면 null — 그때는 지식 없이 답한다. */
  private async knowledgeOf(port: KnowledgePort | null | undefined = this.deps.knowledge): Promise<Known | null> {
    try {
      const known = (await port?.current()) ?? null;
      return known === null ? null : { block: known.block, basis: known.basis.label() };
    } catch {
      return null;
    }
  }

  private async answer(input: string, asked: Promise<{ result: MemberResult; recalls: Recall[]; basis: string | null }>, started: number): Promise<TurnOutcome> {
    const { result, recalls, basis } = await asked;
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    const dto = this.tryRead(() => AnswerDto.from(result.output));
    const claims = dto?.claims() ?? [];
    const files = new Map(await Promise.all(citedPaths(claims).map(async (path) => [path, await this.deps.workspace.readFile(path)] as const)));
    const checked = FactCheck.of(claims, {
      files,
      passedTests: [],
      fetched: new Map(result.fetched.map((p) => [normalizeUrl(p.url), p.body])),
      userStatements: [],
      records: recalls.flatMap((r) => r.neighbors.filter((n) => n.kind === 'decision' || n.kind === 'assumption').map((n) => n.text)),
    }).all();
    const answer = dto?.answer ?? '답을 만들지 못했어요. 질문을 조금 더 구체적으로 다시 해 주세요.';
    await this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: input, answer, citedFiles: citedPaths(claims), basis }));
    this.turns.push({ input, result: `답: ${answer.slice(0, KEPT_RESULT_CHARS)}` });
    return { kind: 'answer', answer, checked, costUsd: result.usage.costUsd, durationMs: this.deps.now() - started, basis };
  }

  // ── 내 변경 검토 (/review) ───────────────────────────────

  /** 사용자가 만든 변경을 리뷰어에게 보이고, 지적의 근거는 rauha가 확인한다. 파일은 고치지 않고 기억에도 남기지 않는다. */
  async review(target: string | null): Promise<TurnOutcome> {
    const started = this.deps.now();
    const changes = await this.deps.workspace.reviewChanges(target);
    const files = changes.map((c) => c.path);
    if (changes.length === 0) return { kind: 'review', target, files, checked: [], summary: '', durationMs: this.deps.now() - started };

    const present = changes.filter((c) => c.kind !== 'deleted').map((c) => c.path);
    const contents = await Promise.all(present.map(async (path) => ({ path, content: await this.deps.workspace.readFile(path) })));
    const result = await this.member(
      'reviewer',
      [
        `<today>${this.deps.today()}</today>`,
        `<review_request>\n${target === null ? '커밋하지 않은 변경' : `${target}와 갈라진 뒤의 변경`}을 검토해 달라는 사용자 요청입니다.\n</review_request>`,
        `<changed_files>\n${changes.map((c) => `${c.kind} ${c.path}`).join('\n')}\n</changed_files>`,
        FilesBlockDto.of(contents).toBlock(),
        '<task>사용자가 직접 만든 변경을 검토하세요. 업무 지시서는 없습니다. 파일은 고치지 않습니다.</task>',
      ],
      REVIEWER_REPORT_SCHEMA,
      {},
    );
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    const report = this.tryRead(() => ReviewReportDto.from(result.output));
    const claims = report?.claims() ?? [];
    const cited = new Map(await Promise.all(citedPaths(claims).map(async (path) => [path, await this.deps.workspace.readFile(path)] as const)));
    const checked = FactCheck.of(claims, {
      files: cited,
      passedTests: [],
      fetched: new Map(result.fetched.map((p) => [normalizeUrl(p.url), p.body])),
      userStatements: [],
      records: [],
    }).all();
    this.turns.push({ input: target === null ? '/review' : `/review ${target}`, result: `검토: 근거가 확인된 지적 ${checked.filter((c) => !c.isGuess).length}개` });
    return { kind: 'review', target, files, checked, summary: report?.summary ?? '리뷰 결과를 읽지 못했어요.', durationMs: this.deps.now() - started };
  }

  // ── 지난 작업 고르기 ─────────────────────────────────────

  /** 흐릿하게 가리킨 지난 작업을 기억에서 찾아 사용자에게 고르게 한다. 하나여도 묻는다. 화면이 없으면 새 작업. */
  private async pickPast(query: string, mode: Route['mode']): Promise<Recall | null> {
    if (!this.deps.user.interactive) return null;
    // 작업이면 질문·답을 걸러 낸 뒤에도 후보가 남도록 넉넉히 찾는다.
    const candidates = mode === 'work' || mode === 'feature' ? continuable(await this.deps.memory.search(query, CANDIDATES * 3), CANDIDATES) : await this.deps.memory.search(query, CANDIDATES);
    if (candidates.length === 0) return null;
    const picked = await this.deps.user.pickPast(candidates.map((c) => ({ id: c.work.id, title: c.work.text.split('\n')[0]!, at: c.work.at })));
    return candidates.find((c) => c.work.id === picked) ?? null;
  }

  // ── 도움 ──────────────────────────────────────────────────

  private conversation(): string | null {
    if (this.turns.length === 0) return null;
    const recent = this.turns.slice(-CONVERSATION_TURNS);
    return recent
      .map((t, i) => `- 사용자: ${t.input}\n  결과: ${i === recent.length - 1 ? t.result : t.result.slice(0, OLDER_RESULT_CHARS)}`)
      .join('\n');
  }

  private callFor(role: MemberRole, outputSchema: Record<string, unknown>, canWrite: (path: string) => boolean = () => false, tier?: ModelTier): PreparedCall {
    return { role, setting: tier === undefined ? this.deps.roles.get(role) : this.deps.roles.forAssignment(role, tier), outputSchema, canWrite };
  }

  private async member(role: MemberRole, parts: readonly string[], outputSchema: Record<string, unknown>, options: MemberOptions): Promise<MemberResult> {
    const call = this.callFor(role, outputSchema, options.canWrite, options.tier);
    const additionalDirectories = options.dirs ?? [];
    // 질문을 나누고 답하는 건 사용자에게 한 가지 일로 보이므로 누가 하는지 밝히지 않는다.
    if (options.quiet !== true) this.deps.progress.step('작업 중…', role);
    const result = await this.deps.team.run({
      ...call,
      userMessage: parts.filter((p) => p !== '').join('\n\n'),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
    });
    this.costUsd += result.usage.costUsd;
    this.calls[call.setting.tier] += 1;
    return result;
  }

  /** 읽을 수 없는 출력은 null(그때는 "읽지 못했어요"로 보인다) */
  private tryRead<T>(read: () => T): T | null {
    try {
      return read();
    } catch {
      return null;
    }
  }

  private at(): string {
    return new Date(this.deps.now()).toISOString();
  }
}
