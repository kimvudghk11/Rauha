import type { AnalysisPort } from '../../analysis/application/ports.js';
import { AnalysisReach } from '../../analysis/domain/analysis-reach.js';
import type { DesignPort } from '../../design/application/design.service.js';
import { DesignDocDto } from '../../design/application/dto/design.dto.js';
import type { KnowledgePort } from '../../knowledge/application/ports.js';
import type { MemoryPort } from '../../memory/application/memory.port.js';
import { continuable, recallBlock, WorkMemory, type MemoryEntry, type Recall } from '../../memory/domain/work-memory.js';
import { citedPaths, FactCheck, normalizeUrl, type CheckedClaim } from '../domain/fact-check.js';
import { LearningBook } from '../domain/learning-book.js';
import { RepoPaths } from '../domain/repo-paths.js';
import type { CompanyEntry } from '../domain/company-book.js';
import { answerDepthOf, sameQuestionKey, wantsToProceed } from '../domain/question-hint.js';
import type { ModelTier } from '../domain/team.js';
import { AnswerDto } from './dto/answer.dto.js';
import type { MemberRole, RoleSetting, RoleSettingsDto } from './dto/role-settings.dto.js';
import type { ChatSnapshot } from './dto/chat-snapshot.dto.js';
import { FilesBlockDto } from './dto/files-block.dto.js';
import { ReviewReportDto } from './dto/review-report.dto.js';
import { RouteDto, type Route } from './dto/route.dto.js';
import { ANSWER_SCHEMA, OPS_SCHEMA, PUBLISH_SCHEMA, REVIEWER_REPORT_SCHEMA, ROUTE_SCHEMA, WRITER_SCHEMA } from './dto/schemas.js';
import { WriterReportDto } from './dto/writer-report.dto.js';
import { OpsReportDto } from './dto/ops-report.dto.js';
import { PublishReportDto } from './dto/publish-report.dto.js';
import type { RunContextBlocks, RunOutcome } from './minimal-loop.service.js';
import type { SessionBudget } from '../domain/session-budget.js';
import { ToolKits } from '../domain/tool-kit.js';
import { CompanyDesk } from './company-desk.js';
import type { DeskHost, Known, MemberOptions } from './desk-host.js';
import { DesignDesk } from './design-desk.js';
import { DocumentDesk } from './document-desk.js';
import { ManyRepoDesk, type RepoRunner } from './many-repo-desk.js';
import { ToolTally, type ToolCount } from '../domain/tool-tally.js';
import type { CompanyBookPort, LearningPort, MemberResult, PreparedCall, ProgressPort, TeamMemberPort, UserPort, WorkspacePort } from './ports.js';
import { stoppedMember } from './member-stop-note.js';
import { PastReference } from '../domain/past-reference.js';
import { conversationBlock } from './prompt-blocks.js';
import type { DesignTaskResult, TurnOutcome } from './turn-outcome.js';

export type { RunContextBlocks };


/** 팀장에게 넘길 앞 대화 턴 수 */
const CONVERSATION_TURNS = 6;
/** 결과 글을 얼마나 남기고 넘기는지. 바로 앞 턴은 길게("두 번째 거 더 자세히"가 가리키는 곳이 거기다), 그 전은 짧게. */
const KEPT_RESULT_CHARS = 1200;

/** 답 결과에 얹을 "찾아본 것" 한 줄. 도구를 쓰지 않았으면 키 자체가 없다. */
function toolsPart(tools: readonly ToolCount[] | undefined): { toolsLine?: string } {
  const toolsLine = ToolTally.shownLine(tools);
  return toolsLine === undefined ? {} : { toolsLine };
}
const OLDER_RESULT_CHARS = 300;
/** 기억 묶음 글자 수 상한 */
const MEMORY_CHARS = 3000;
const CANDIDATES = 3;

export type { DesignTaskResult, TurnOutcome } from './turn-outcome.js';

export interface ChatSessionDeps {
  /** 요청 하나를 돌릴 최소 루프. carried = 세션 중 rauha가 남긴 파일(그 위에서 이어 일함). */
  readonly newLoop: (carried: ReadonlyMap<string, string>) => { run(request: string, context: RunContextBlocks): Promise<RunOutcome> };
  readonly team: TeamMemberPort;
  /** snapshot이 있으면 분석 문서를 세션이 남긴 파일(carried)로 등록해, 승인한 계획의 구현이 새 파일 때문에 거절되지 않게 한다. */
  readonly workspace: Pick<WorkspacePort, 'readFile' | 'reviewChanges'> & Partial<Pick<WorkspacePort, 'snapshot'>>;
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
  /** 팀원이 일하는 작업 폴더. 문서 팀원이 절대 경로로 보고한 파일을 작업 폴더 기준으로 풀 때 쓴다(없으면 상대 경로로 보고한 것만 받는다). */
  readonly workRoot?: string | undefined;
  readonly folder?: { readonly root: string; readonly repos: readonly { readonly name: string; readonly root: string }[] } | undefined;
  /** 분석 흐름(조사 → 방향 비교 → 설계·계획 → 승인하면 구현). 없으면 디버깅·위험 점검은 지금처럼 팀원 한 번 호출이다. */
  readonly analyst?: AnalysisPort | undefined;
  /** 설계 대화. 없거나 사용자와 주고받을 화면이 없으면 기능 요청도 바로 작업으로 진행한다. */
  readonly designer?: DesignPort | undefined;
  /** 구독 한도를 얼마나 썼는지. 빠듯하면 부서장이 sonnet으로, 위험하면 큰 요청을 미룬다. 없으면 넉넉하다고 본다. */
  readonly budget?: () => SessionBudget;
  /** 회사 장부. 있으면 부서 팀원 입력에 이미 정한 것을 싣고, 부서 결과를 요약해 남긴다. */
  readonly company?: CompanyBookPort;
  /** 학습 노트. 있으면 작업이 끝날 때 쓰인 패턴과 이유를 모아 둔다(새 호출 없이). */
  readonly learning?: LearningPort;
}

/** 함께 묻는 다른 저장소가 이 수를 넘으면 그 저장소들의 지식은 미리 만들지 않는다(저장소마다 조사 팀원이 돌아 오래 걸린다). 답변 팀원이 직접 읽는다. */
const ALSO_KNOWLEDGE_MAX = 3;

/** 여러 저장소에 걸친 질문에서 함께 읽을 다른 저장소 */
export interface AlsoRepo {
  readonly name: string;
  readonly root: string;
  readonly knowledge: KnowledgePort | null;
  /** 그 저장소의 세션으로 작업 하나를 한다(여러 저장소를 함께 고칠 때). 없으면 그 저장소는 고칠 수 없다. */
  readonly work?: (request: string, block: string) => Promise<TurnOutcome>;
  /** 그 저장소의 파일 읽기(근거 확인용, 읽기 전용). 비밀 파일·그 저장소 밖은 null. 없으면 그 저장소를 근거로 든 인용은 확인하지 못한다. */
  readonly read?: (path: string) => Promise<string | null>;
}

/** 요청이 함께 가리킨 다른 저장소를 접수 팀장에게 알리는 블록. 읽기 전용 참고이고 고치는 곳은 이 저장소뿐이다. */
function referenceBlock(others: readonly AlsoKnown[]): string {
  const lines = others.map((o) => `- ${o.name} (${o.root})`);
  const knowledge = others.map((o) => o.known?.block ?? '').filter((b) => b !== '');
  return [
    '<other_repos>',
    '요청이 함께 가리킨 다른 저장소입니다. 읽기 전용 참고예요: 그 저장소 파일은 고치지 않고, 업무 범위와 수용 기준은 이 저장소 안에서만 정하세요. 사용자가 그쪽도 고치길 원하면 저장소마다 따로 요청해 달라고 알려 주세요.',
    ...lines,
    ...knowledge,
    '</other_repos>',
  ].join('\n');
}

/** 함께 읽을 저장소와 그 지식(없으면 null) */
interface AlsoKnown {
  readonly name: string;
  readonly root: string;
  readonly known: Known | null;
}

/** 레포 하나만 열린 세션의 팀원 안내. 옆 레포를 "없다"고 단정하지 않고 상위 폴더를 열도록 돕게 한다. */
const SINGLE_REPO_NOTE =
  "This session can read only this one repository's folder. If the user names another repository or folder that is not inside it, do not say it does not exist or that you cannot find it: it is outside the folder this session can read. Say so, and tell the user to open the parent folder as the working folder so both repositories can be read. Answer in the user's language (Korean for a Korean user).";

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
  /** 답한 뒤 배경 조사를 이미 시작했는지 */
  private surveyed = false;
  private held: HeldRequest | null = null;
  /** 방금 한 질문과 그 답. 코드를 바꾸는 일이 있거나 /clear 하면 비운다. */
  private answered = new Map<string, { answer: string; at: number }>();

  /** 회사 부서가 하는 일(기획·디버깅·위험 점검·부서장 배분·런칭). 호출과 비용 합산은 세션이 빌려준다. */
  private readonly desk: CompanyDesk;
  /** 코드가 아닌 결과물(문서)을 쓰는 일 */
  private readonly documents: DocumentDesk;
  /** 기능 요청의 설계 대화와 승인된 설계의 작업 돌리기. 설계 팀원이 없으면 없다. */
  private readonly designs: DesignDesk | null;
  /** 여러 저장소를 함께 고치는 요청 */
  private readonly repos: ManyRepoDesk;

  private constructor(private readonly deps: ChatSessionDeps) {
    const host: DeskHost = {
      member: (role, parts, schema, options) => this.member(role, parts, schema, options),
      settle: (label, input, answer, remembered, started, costBefore, cited, tools) => this.settle(label, input, answer, remembered, started, costBefore, cited, tools),
      spent: () => this.costUsd,
      workspaceBlock: () => this.workspaceBlock(),
    };
    this.repos = new ManyRepoDesk(host, { progress: deps.progress, now: deps.now, ...(deps.budget !== undefined ? { budget: deps.budget } : {}) });
    this.desk = new CompanyDesk(host, { today: deps.today, now: deps.now, progress: deps.progress, budget: deps.budget, company: deps.company });
    this.designs =
      deps.designer === undefined
        ? null
        : new DesignDesk(
            {
              knowledge: () => this.knowledgeOf(),
              memoryBlock: async (input) => {
                const block = recallBlock(await this.deps.memory.search(input, CANDIDATES), MEMORY_CHARS);
                return block !== '' ? `<memory>\n기억된 지난 작업과 그때의 결정입니다.\n${block}\n</memory>` : null;
              },
              work: async (request, block) => (await this.work(request, null, null, block)),
              charge: (cost) => {
                this.costUsd += cost.costUsd;
                this.calls[cost.tier] += cost.calls;
              },
              remember: (question, answer, basis) => this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question, answer, citedFiles: [], basis })),
              noteTurn: (input, result) => void this.turns.push({ input, result }),
            },
            { designer: deps.designer, repoName: deps.repoName, progress: deps.progress, now: deps.now },
          );
    this.documents = new DocumentDesk({ ...host, titled: (title) => (this.lastTitle = title), wrote: (files) => this.carryWritten(files) }, { today: deps.today, progress: deps.progress, repoName: deps.repoName, folder: () => this.deps.folder });
  }

  /** 팀원을 미리 띄우지 않는다: 쓰이지 않을 호출이 한도를 쓰지 않게, 라우터 판정이 끝난 뒤에만 부른다. */
  static start(deps: ChatSessionDeps): ChatSession {
    return new ChatSession(deps);
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
   * 라우터가 입력 종류와 질문 깊이를 판정한 뒤에만 팀원을 부른다(버려지는 호출 없음).
   * force 'deep': 라우터 없이 같은 질문을 deep으로 다시 답한다("더 깊게 알아볼까요?").
   */
  async handle(input: string, also: readonly AlsoRepo[] = [], force?: 'design' | 'deep'): Promise<TurnOutcome> {
    const started = this.deps.now();
    const conversation = this.conversation();
    const heldRequest = this.held;
    this.held = null;
    if (heldRequest !== null && wantsToProceed(input)) return this.rerun(heldRequest, conversation, started);
    const again = force === 'deep' ? null : this.repeated(input);
    if (again !== null) return { kind: 'answer', answer: again, checked: [], costUsd: 0, durationMs: 0, basis: null };
    // /design: 라우터를 거치지 않고 바로 설계부터 한다.
    if (force === 'design') {
      if (also.length > 0) return { kind: 'notice', message: MANY_REPO_WORK };
      return this.canDesign() ? this.designs!.run(input, conversation, started) : { kind: 'notice', message: '설계 대화는 터미널 대화 모드에서만 할 수 있어요.' };
    }
    let route: Route;
    if (force === 'deep') {
      route = RouteDto.deepQuestion();
    } else {
      const routed = await this.member('router', [conversationBlock(conversation), `<message>\n${input}\n</message>`], ROUTE_SCHEMA, {});
      if (routed.blocked) return { kind: 'blocked', ...routed.blocked };
      route = RouteDto.read(routed.output, input);
    }
    if (route.mode === 'task') return this.documents.write(input, conversation, also, started);
    if (route.mode === 'ops') return this.ops(input, conversation, started);
    if (route.mode === 'publish') return this.publish(input, conversation, started);
    if (route.mode === 'debug') return this.analysis('debugger', '디버깅', route, input, conversation, also, started);
    if (route.mode === 'company') return (route.member === null ? this.hold(input, route) : null) ?? this.desk.company(input, conversation, route, started);
    if (route.mode === 'launch') return this.hold(input, route) ?? this.desk.launch(input, conversation, started);
    if (route.mode === 'ideate') return this.desk.analyze('planner', '기획', input, conversation, started, 'planning');
    if (route.mode === 'risk') return this.analysis('riskchecker', '위험 점검', route, input, conversation, also, started);
    const changesCode = route.mode === 'work' || route.mode === 'feature';
    // 이어 할 대상이 없는 지시어 요청은 팀을 돌리지 않고 바로 되묻는다(호출 0, 기록 없음).
    if ((changesCode || route.mode === 'question') && (await this.lacksPastTarget(input, route, conversation))) return { kind: 'notice', message: PastReference.notice() };
    // 고칠 수 있는 저장소가 함께 넘어오면 저장소별로 나눠 맡고, 읽기 전용 참고뿐이면 이 저장소만 고치며 참고로 넘긴다.
    if (changesCode && also.length > 0 && also.some((a) => a.work !== undefined)) return this.manyRepos(input, conversation, also, await this.knowledgeOf(), await this.othersKnown(also, 'deep'), started);
    const references = changesCode && also.length > 0 ? referenceBlock(await this.othersKnown(also, 'deep')) : null;
    const past = route.refersToPast ? await this.pickPast(route.pastQuery ?? input, route.mode) : null;
    // 기능 요청은 설계 대화부터. 사용자와 주고받을 화면이 없으면(-p) 작업으로 바로 진행한다.
    if (route.mode === 'feature' && past === null && this.canDesign()) return this.designs!.run(input, conversation, started);
    if (changesCode) return this.work(input, conversation, past, null, references);
    const depth = answerDepthOf(route.depth, input);
    const known = await this.knowledgeFor(depth);
    const asked = this.askAnswerer(input, past, known, conversation, depth, await this.othersKnown(also, depth));
    const answered = await this.answer(input, asked, started, depth, also);
    if (answered.kind === 'answer' && !route.refersToPast) this.answered.set(sameQuestionKey(input), { answer: answered.answer, at: this.deps.now() });
    if (answered.kind === 'answer' && depth === 'deep') this.surveyInBackground();
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

  private async work(input: string, conversation: string | null, past: Recall | null, design: string | null = null, references: string | null = null): Promise<TurnOutcome> {
    const outcome = await this.deps.newLoop(new Map(this.carried)).run(input, { conversation, pastWork: past === null ? null : recallBlock([past], MEMORY_CHARS), design, references });
    this.costUsd += outcome.costUsd;
    for (const tier of Object.keys(this.calls) as ModelTier[]) this.calls[tier] += outcome.usage[tier].calls;

    // 세션 중 바뀐 파일만 이어 일할 대상으로 남긴다(사용자가 원래 바꿔 둔 파일은 넣지 않는다).
    const touched = new Set([...this.carried.keys(), ...outcome.changedInRun.map((c) => c.path)]);
    this.carried = new Map([...touched].filter((p) => outcome.snapshotAfter.has(p)).map((p) => [p, outcome.snapshotAfter.get(p)!]));

    await this.deps.memory.save(workMemoryFrom(outcome, { id: this.deps.newId(), at: this.at(), request: input, extendsWork: past?.work.id ?? null }));
    await this.learn(outcome);
    this.answered.clear();
    this.lastTitle = outcome.title;
    this.turns.push({ input, result: `작업 "${outcome.title}" ${outcome.status === 'complete' ? '완료' : `멈춤(${outcome.stopReason}${outcome.guide.stopMessage() === null ? '' : `: ${outcome.guide.stopMessage()}`})`}, 바뀐 파일 ${outcome.changedInRun.map((c) => c.path).join(', ') || '없음'}` });
    return { kind: 'work', outcome };
  }

  /** 이 저장소의 파일 읽기(다른 저장소 세션이 근거 확인에 빌려 쓴다). 비밀 파일·저장소 밖·없는 파일은 null. */
  readFile(path: string): Promise<string | null> {
    return this.deps.workspace.readFile(path);
  }

  /** 여러 저장소를 함께 고칠 때 다른 저장소의 세션이 이 저장소 몫의 작업을 맡긴다. block: 저장소 사이 약속 */
  workIn(request: string, block: string): Promise<TurnOutcome> {
    return this.work(request, null, null, block);
  }

  /** 여러 저장소 작업: 이 세션과 함께 고를 저장소들의 세션을 모아 나누기 → 순서대로 작업 → 약속 검사. */
  private async manyRepos(input: string, conversation: string | null, also: readonly AlsoRepo[], known: Known | null, others: readonly AlsoKnown[], started: number): Promise<TurnOutcome> {
    const self = this.deps.folder?.repos.find((r) => r.name === this.deps.repoName);
    if (self === undefined || also.some((a) => a.work === undefined)) return { kind: 'notice', message: MANY_REPO_WORK };
    const runners: RepoRunner[] = [
      { name: self.name, root: self.root, work: (request, block) => this.workIn(request, block) },
      ...also.map((a) => ({ name: a.name, root: a.root, work: a.work! })),
    ];
    const blocks = [known?.block ?? '', ...others.map((o) => o.known?.block ?? '')].filter((b) => b !== '');
    const outcome = await this.repos.run(input, conversation, runners, blocks, started);
    this.turns.push({ input, result: outcome.kind === 'repos' ? `여러 저장소 작업: ${outcome.repos.map((r) => `${r.repo} ${r.status}`).join(', ')}` : outcome.kind });
    return outcome;
  }

  // ── 분석 흐름 ─────────────────────────────────────────────

  /**
   * 원인·위험 분석. 분석 흐름이 켜져 있고 요청이 분석·조사·비교를 청한 말이면 단계별 흐름(조사 → 방향 비교 → 설계·계획)을 탄다.
   * 아니면 지금처럼 팀원 한 번 호출이다. 사용자가 계획을 승인하면 그 계획이 그대로 작업 루프의 설계 블록이 된다.
   */
  private async analysis(role: 'debugger' | 'riskchecker', label: string, route: Route, input: string, conversation: string | null, also: readonly AlsoRepo[], started: number): Promise<TurnOutcome> {
    const analyst = this.deps.analyst;
    if (analyst === undefined || !AnalysisReach.requested(input)) return this.desk.analyze(role, label, input, conversation, started);
    const known = await this.knowledgeFor('light');
    const recalls = await this.deps.memory.search(input, CANDIDATES);
    const memory = recallBlock(recalls, MEMORY_CHARS);
    const result = await analyst.run({
      request: input,
      role,
      reach: route.reach,
      routedFeature: false,
      repos: 1 + also.length,
      repo: this.deps.repoName ?? '이 저장소',
      knowledge: null,
      memory: memory !== '' ? `<memory>\n기억된 지난 작업과 그때의 결정입니다.\n${memory}\n</memory>` : null,
      conversation,
      workspace: this.workspaceBlock(),
      basis: known?.basis ?? null,
      readDirs: also.map((a) => a.root),
    });
    for (const c of result.cost) {
      this.costUsd += c.costUsd;
      this.calls[c.tier] += c.calls;
    }
    await this.carryDocument(result.path);
    await this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: input, answer: result.summary, citedFiles: result.run.investigation?.evidencePaths() ?? [], basis: known?.basis ?? null }));
    // 요약이 길어 잘려도 쓴 문서 경로는 남긴다("아까 그 분석 문서").
    const kept = result.summary.slice(0, KEPT_RESULT_CHARS);
    this.turns.push({ input, result: `분석: ${kept}${result.path === null || kept.includes(result.path) ? '' : `\n문서: ${result.path}`}` });
    const worked = result.brief === null ? null : await this.work(result.brief.request, null, null, result.brief.block);
    const choice = result.run.choice;
    return {
      kind: 'analysis',
      title: input.slice(0, 60),
      path: result.path,
      summary: result.summary,
      stopped: result.run.stopped !== null,
      choice: choice === null ? null : { recommended: choice.recommended, chosen: choice.chosen, reason: choice.reason, diverged: choice.divergedFromAi() },
      implemented: worked?.kind === 'work' ? worked.outcome : null,
      durationMs: this.deps.now() - started,
    };
  }

  /** 방금 쓴 분석 문서를 세션이 남긴 파일로 등록한다(작업 루프가 "커밋 안 한 모르는 파일"이라며 거절하지 않게). */
  private async carryDocument(path: string | null): Promise<void> {
    const snapshot = this.deps.workspace.snapshot;
    if (path === null || snapshot === undefined) return;
    try {
      const value = (await snapshot.call(this.deps.workspace)).files.get(path);
      if (value !== undefined) this.carried.set(path, value);
    } catch {
      // 못 읽으면 등록하지 않는다. 구현은 "커밋 안 한 변경이 있다"는 안내로 멈출 수 있다.
    }
  }

  /** 문서 팀원이 보고한 파일 중 작업 폴더에 실제로 있는 것을 세션이 남긴 파일로 등록한다. 작업 폴더 밖(다른 레포)에 쓴 파일은 등록하지 않는다. */
  private async carryWritten(files: readonly string[]): Promise<void> {
    const snapshot = this.deps.workspace.snapshot;
    if (snapshot === undefined || files.length === 0) return;
    const root = this.deps.workRoot ?? null;
    const inside = files.flatMap((f) => {
      const rel = RepoPaths.relativeIn(root, f);
      return rel === null ? [] : [rel];
    });
    if (inside.length === 0) return;
    try {
      const present = (await snapshot.call(this.deps.workspace)).files;
      for (const path of inside) {
        const value = present.get(path);
        if (value !== undefined) this.carried.set(path, value);
      }
    } catch {
      // 못 읽으면 등록하지 않는다. 다음 코드 작업은 "커밋 안 한 변경이 있다"는 안내로 멈출 수 있다.
    }
  }

  // ── 설계 대화 ─────────────────────────────────────────────

  private canDesign(): boolean {
    return this.designs !== null && this.deps.user.interactive && typeof this.deps.user.discuss === 'function';
  }

  // ── 운영 요청 ─────────────────────────────────────────────

  /**
   * aws·terraform·kubectl 같은 명령으로 클라우드·인프라를 조회하거나 바꾸는 요청. 코드 작업이 아니라 TDD 루프를 돌리지 않는다.
   * 운영 팀원이 명령을 직접 실행하고, 위험한 명령은 도구 검사가 사용자에게 묻는다. 자격 증명 설정(aws configure)은 하지 않는다.
   */
  private async ops(input: string, conversation: string | null, started: number): Promise<TurnOutcome> {
    const costBefore = this.costUsd;
    const result = await this.member('operator', [conversationBlock(conversation), `<today>${this.deps.today()}</today>`, `<request>\n${input}\n</request>`], OPS_SCHEMA, { request: input });
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    // 인프라가 바뀌었을 수 있어 앞의 같은 질문 답은 더 쓰지 않는다.
    this.answered.clear();
    const answer = stoppedMember(result)?.report(result.partial ?? null) ?? OpsReportDto.read(result.output).toAnswer();
    return this.settle('운영', input, answer, answer, started, costBefore, [], result.usage.tools);
  }

  // ── git 일(커밋·push·PR) ────────────────────────────────

  /**
   * 코드는 바꾸지 않고 커밋·push·PR만 하라는 요청. 테스트·구현 팀원 없이 git 팀원 한 명이 한다.
   * 원문 요청을 함께 넘겨 도구 검사가 시킨 git 일은 묻지 않게 한다(시키지 않은 것과 강제 push는 묻는다).
   */
  private async publish(input: string, conversation: string | null, started: number): Promise<TurnOutcome> {
    const costBefore = this.costUsd;
    const result = await this.member('publisher', [conversationBlock(conversation), `<today>${this.deps.today()}</today>`, `<request>\n${input}\n</request>`], PUBLISH_SCHEMA, { request: input });
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    const answer = stoppedMember(result)?.report(result.partial ?? null) ?? PublishReportDto.read(result.output).toAnswer();
    return this.settle('커밋·PR', input, answer, answer, started, costBefore, [], result.usage.tools);
  }

  // ── 회사 부서(CompanyDesk)·문서(DocumentDesk)가 쓰는 것 ───────────────────────

  /** 결과를 기억과 앞 대화에 남기고 답으로 돌려준다. label: 다음 대화의 말머리 */
  private async settle(label: string, input: string, answer: string, remembered: string, started: number, costBefore: number, cited: readonly string[] = [], tools?: readonly ToolCount[]): Promise<TurnOutcome> {
    await this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: input, answer, citedFiles: [...cited], basis: null }));
    this.turns.push({ input, result: `${label}: ${remembered.slice(0, KEPT_RESULT_CHARS)}` });
    return { kind: 'answer', answer, checked: [], costUsd: this.costUsd - costBefore, durationMs: this.deps.now() - started, basis: null, ...toolsPart(tools) };
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

  /**
   * 여러 저장소 작업 공간에서 rauha를 띄운 폴더와 저장소 목록.
   * 저장소가 하나뿐이면 이 세션이 그 하나만 읽을 수 있다는 안내(옆 레포 이름을 들으면 "없다"고 잘못 답하지 않게).
   */
  private workspaceBlock(): string {
    const folder = this.deps.folder;
    if (folder === undefined || folder.repos.length < 2) return `<single_repo name="${this.deps.repoName ?? 'this repository'}">
${SINGLE_REPO_NOTE}
</single_repo>`;
    return `<workspace root="${folder.root}">\n이 폴더 아래의 저장소 ${folder.repos.length}개: ${folder.repos.map((r) => r.name).join(', ')}\n</workspace>`;
  }

  // ── 질문 ──────────────────────────────────────────────────

  /** 답변 팀원 호출만. 답을 기억에 남기는 일은 이 답을 쓰기로 정한 뒤 answer()가 한다. */
  private async askAnswerer(
    input: string,
    past: Recall | null,
    known: Known | null,
    conversation: string | null,
    depth: 'light' | 'deep',
    others: readonly AlsoKnown[] = [],
  ): Promise<{ result: MemberResult; recalls: Recall[]; basis: string | null }> {
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
      // light는 도구 묶음(브라우저·AWS 설명이 수천 자)을 붙이지 않는다.
      { ...(depth === 'light' ? { setting: this.deps.roles.lightAnswerer() } : {}), kits: depth === 'light' ? [] : ToolKits.for('answerer', input), dirs: [...others.map((o) => o.root), ...(this.deps.folder !== undefined && this.deps.folder.repos.length > 1 ? [this.deps.folder.root] : [])] },
    );
    const basis =
      others.length === 0
        ? (known?.basis ?? null)
        : [`${this.deps.repoName ?? '이 저장소'}: ${known?.basis ?? '기준 모름'}`, ...others.map((o) => `${o.name}: ${o.known?.basis ?? '기준 모름'}`)].join(', ');
    return { result, recalls, basis };
  }

  /**
   * 질문 깊이에 맞게 읽는 저장소 지식. light는 저장된 것만(없으면 읽지 않고 지식 없이 답한다).
   * deep은 저장된 것이 있으면 그것을(낡은 영역 조사는 답한 뒤 배경에서), `stored`가 없는 옛 구현이면 `current`로 읽는다.
   */
  private async knowledgeFor(depth: 'light' | 'deep', port: KnowledgePort | null | undefined = this.deps.knowledge): Promise<Known | null> {
    if (port?.stored === undefined) return depth === 'light' ? null : this.knowledgeOf(port);
    try {
      const known = await port.stored();
      return known === null ? null : { block: known.block, basis: known.basis.label() };
    } catch {
      return null;
    }
  }

  private async othersKnown(also: readonly AlsoRepo[], depth: 'light' | 'deep'): Promise<AlsoKnown[]> {
    return Promise.all(also.map(async (r): Promise<AlsoKnown> => ({ name: r.name, root: r.root, known: depth === 'light' || also.length > ALSO_KNOWLEDGE_MAX ? null : await this.knowledgeFor('deep', r.knowledge) })));
  }

  /** 답을 돌려준 뒤 저장소 조사를 배경에서 한다. 세션에서 한 번만, 저장된 지식을 쓰는 구현에서만(한도를 아끼려고 light 답 뒤에는 부르지 않는다). */
  private surveyInBackground(): void {
    if (this.surveyed || this.deps.knowledge?.stored === undefined) return;
    this.surveyed = true;
    void this.knowledgeOf();
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

  private async answer(input: string, asked: Promise<{ result: MemberResult; recalls: Recall[]; basis: string | null }>, started: number, depth: 'light' | 'deep', also: readonly AlsoRepo[] = []): Promise<TurnOutcome> {
    const { result, recalls, basis } = await asked;
    if (result.blocked) return { kind: 'blocked', ...result.blocked };
    const dto = this.tryRead(() => AnswerDto.from(result.output));
    const claims = dto?.claims() ?? [];
    const files = new Map(await Promise.all(citedPaths(claims).map(async (path) => [path, await this.readCited(path, also)] as const)));
    const checked = FactCheck.of(claims, {
      files,
      passedTests: [],
      fetched: new Map(result.fetched.map((p) => [normalizeUrl(p.url), p.body])),
      userStatements: [],
      records: recalls.flatMap((r) => r.neighbors.filter((n) => n.kind === 'decision' || n.kind === 'assumption').map((n) => n.text)),
    }).all();
    const stop = dto === null ? stoppedMember(result) : null;
    const answer = dto?.answer ?? stop?.report(result.partial ?? null) ?? '답을 만들지 못했어요. 질문을 조금 더 구체적으로 다시 해 주세요.';
    await this.deps.memory.save(WorkMemory.fromAnswer({ id: this.deps.newId(), at: this.at(), question: input, answer, citedFiles: citedPaths(claims), basis }));
    this.turns.push({ input, result: stop === null ? `답: ${answer.slice(0, KEPT_RESULT_CHARS)}` : `답을 끝내지 못함: ${stop.turnNote(result.partial ?? null)}` });
    return { kind: 'answer', answer, checked, costUsd: result.usage.costUsd, durationMs: this.deps.now() - started, basis, canGoDeeper: depth === 'light', ...toolsPart(result.usage.tools) };
  }

  /** 인용한 파일 읽기. 현재 레포에 없으면 경로가 가리키는 함께 읽는 레포에서 읽는다(읽기 전용, 비밀·루트 밖은 그 레포의 읽기가 막는다). */
  private async readCited(path: string, also: readonly AlsoRepo[]): Promise<string | null> {
    const own = await this.deps.workspace.readFile(path);
    if (own !== null) return own;
    for (const hit of RepoPaths.ownersOf(path, also)) {
      const content = (await also.find((r) => r.name === hit.name)?.read?.(hit.path)) ?? null;
      if (content !== null) return content;
    }
    return null;
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
  private async pastCandidates(query: string, mode: Route['mode']): Promise<readonly Recall[]> {
    // 작업이면 질문·답을 걸러 낸 뒤에도 후보가 남도록 넉넉히 찾는다.
    return mode === 'work' || mode === 'feature' ? continuable(await this.deps.memory.search(query, CANDIDATES * 3), CANDIDATES) : this.deps.memory.search(query, CANDIDATES);
  }

  /** 앞 대화가 없을 때만 기억을 뒤진다(검색 호출은 팀원 호출이 아니다). */
  private async lacksPastTarget(input: string, route: Route, conversation: string | null): Promise<boolean> {
    const asks = { text: input, refersToPast: route.refersToPast, hasConversation: conversation !== null, hasPastWork: false };
    if (!PastReference.lacksTarget(asks)) return false;
    const found = await this.pastCandidates(route.pastQuery ?? input, route.mode);
    return PastReference.lacksTarget({ ...asks, hasPastWork: found.length > 0 });
  }

  private async pickPast(query: string, mode: Route['mode']): Promise<Recall | null> {
    if (!this.deps.user.interactive) return null;
    const candidates = await this.pastCandidates(query, mode);
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

  private callFor(role: MemberRole, outputSchema: Record<string, unknown>, canWrite: (path: string) => boolean = () => false, tier?: ModelTier, setting?: RoleSetting): PreparedCall {
    return { role, setting: setting ?? (tier === undefined ? this.deps.roles.get(role) : this.deps.roles.forAssignment(role, tier)), outputSchema, canWrite };
  }

  private async member(role: MemberRole, parts: readonly string[], outputSchema: Record<string, unknown>, options: MemberOptions): Promise<MemberResult> {
    const call = this.callFor(role, outputSchema, options.canWrite, options.tier, options.setting);
    const additionalDirectories = options.dirs ?? [];
    // 질문을 나누고 답하는 건 사용자에게 한 가지 일로 보이므로 누가 하는지 밝히지 않는다.
    if (options.quiet !== true) this.deps.progress.step('작업 중…', role);
    const result = await this.deps.team.run({
      ...call,
      userMessage: parts.filter((p) => p !== '').join('\n\n'),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
      ...((options.kits?.length ?? 0) > 0 ? { kits: options.kits } : {}),
      ...(options.request !== undefined ? { request: options.request } : {}),
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
