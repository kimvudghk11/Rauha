import type { KnowledgePort } from '../../knowledge/application/ports.js';
import { DomainError } from '../../shared/domain-error.js';
import { citedPaths, FactCheck, normalizeUrl, ReviewFindings, type CheckedClaim } from '../domain/fact-check.js';
import { ROLE_INFO } from '../domain/member-role.js';
import type { ModelTier } from '../domain/team.js';
import { TestRun } from '../domain/test-run.js';
import { RunScope } from '../domain/run-scope.js';
import { Verification, type VerificationVerdict } from '../domain/verification.js';
import type { WorkOrder } from '../domain/work-order.js';
import { WorkspaceState } from '../domain/workspace-state.js';
import { WritePolicy } from '../domain/write-policy.js';
import { MemberReportDto, type ExplanationDto } from './dto/explanation.dto.js';
import { FilesBlockDto } from './dto/files-block.dto.js';
import { IntakeDto, type SettledAssumptionChoice } from './dto/intake.dto.js';
import { ReadingGuideDto, type FactsSummary, type RunStopReason, type SettledAssumption } from './dto/reading-guide.dto.js';

export type { FactsSummary };
import { ReviewReportDto } from './dto/review-report.dto.js';
import type { MemberRole, RoleSettingsDto } from './dto/role-settings.dto.js';
import { ToolKits } from '../domain/tool-kit.js';
import { IMPLEMENTER_REPORT_SCHEMA, INTAKE_SCHEMA, REVIEWER_REPORT_SCHEMA, TESTER_REPORT_SCHEMA } from './dto/schemas.js';
import type {
  AccountBlock,
  ChecksPort,
  MemberCall,
  MemberResult,
  ProgressPort,
  RunLogPort,
  TeamMemberPort,
  UserPort,
  WorkspacePort,
  WorkspaceSnapshot,
  FileChange,
  HeldLock,
  WorkLockPort,
} from './ports.js';

const INTAKE_ATTEMPTS = 2;
/** 상태 머신이 멈추게 되어 있지만, 무한 반복을 막는 마지막 안전장치. */
const MAX_STEPS = 12;
const toSettled = ({ question, chosen, confirmed }: SettledAssumptionChoice): SettledAssumption => ({ question, chosen, confirmed });

export interface RunOutcome {
  readonly guide: ReadingGuideDto;
  readonly status: 'complete' | 'stopped';
  readonly stopReason: RunStopReason | null;
  readonly title: string;
  readonly calls: number;
  readonly implementerAttempts: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly usage: Readonly<Record<ModelTier, { calls: number; tokens: number }>>;
  /** 구현 시니어가 한 번이라도 불렸는지 */
  readonly escalated: boolean;
  /** 마지막 구현 호출의 모델. 구현까지 못 갔으면 null */
  readonly finalTier: ModelTier | null;
  readonly facts: FactsSummary;
  /** 이번 요청 시작 스냅숏 대비 바뀐 파일 */
  readonly changedInRun: readonly FileChange[];
  /** 끝난 뒤 스냅숏(HEAD 대비 바뀐 파일 → 내용 값). 대화 세션이 다음 요청의 carried로 쓴다. */
  readonly snapshotAfter: ReadonlyMap<string, string>;
  /** 잠근 테스트 파일(기억에 남길 재료) */
  readonly lockedTests: readonly string[];
  readonly assumptions: readonly SettledAssumption[];
  readonly explanation: ExplanationDto | null;
  readonly logDir: string;
  /** 작업을 시작할 때 본 기준(`main (a1b2c3d)`). 저장소 지식이 없으면 null. */
  readonly basis: string | null;
}

/** 대화 세션이 접수 팀장에게 함께 넘기는 맥락 */
export interface RunContextBlocks {
  /** 이번 세션의 앞 대화 요약. /clear 뒤나 -p면 null */
  readonly conversation: string | null;
  /** 사용자가 "아까 그 기능"으로 고른 지난 작업의 기억 묶음. 없으면 null */
  readonly pastWork: string | null;
  /** 사용자가 승인한 설계에서 온 작업이면 그 설계 블록(`<design>`). 없으면 null이나 없음 */
  readonly design?: string | null;
}

const NO_CONTEXT: RunContextBlocks = { conversation: null, pastWork: null };


/** 사용 한도·로그인 문제는 몇 번을 다시 불러도 같은 오류라서, 흐름을 끊고 바로 멈추는 데 쓴다. */
class AccountBlocked extends Error {
  constructor(readonly block: AccountBlock) {
    super(block.message);
  }
}

const BLOCK_STOP: Readonly<Record<AccountBlock['reason'], RunStopReason>> = { 'usage-limit': 'usage-limit', login: 'login-required', cancelled: 'cancelled' };
const BLOCK_STEP: Readonly<Record<AccountBlock['reason'], string>> = {
  'usage-limit': 'Claude 사용 한도에 걸렸습니다',
  login: 'Claude 로그인이 필요합니다',
  cancelled: '작업을 멈췄습니다',
};

/** 멈췄을 때 안내서에 쓸 만큼만 들고 있는 진행 상황 */
interface RunProgress {
  title: string;
  assumptions: readonly SettledAssumption[];
  /** 요청 시작 스냅숏. 바뀐 파일은 HEAD가 아니라 이것과 비교한다(세션에서 앞 요청이 남긴 변경을 빼려고). */
  readonly start: WorkspaceSnapshot;
  lockedTests: readonly string[];
}

/** 리뷰 단계를 오가며 쌓이는 기록. 판정은 FactCheck·ReviewFindings가 한다. */
class ReviewState {
  rounds = 0;
  missing = false;
  /** 다음 구현 메시지에 넣을 피드백(확인된 지적·정정) */
  feedback: string | null = null;
  readonly corrections: string[] = [];
  readonly confirmed: string[] = [];
  /** 마지막 잠긴 테스트 실행에서 통과한 테스트 */
  passed: readonly string[] = [];
  checked: readonly CheckedClaim[] = [];
  reviewerGuesses: readonly CheckedClaim[] = [];
  unconfirmed: readonly CheckedClaim[] = [];

  summary(): FactsSummary {
    return { checked: this.checked, reviewerGuesses: this.reviewerGuesses, unconfirmed: this.unconfirmed, reviewRounds: this.rounds, reviewMissing: this.missing };
  }
}

const ESCALATION_NOTE =
  '<escalation>\n앞의 구현 주니어(haiku)가 두 번 실패해서 승격된 시도입니다. <handoff>와 <last_failure>를 먼저 읽고, 앞 시도와 다른 접근을 하세요.\n</escalation>';

export interface MinimalLoopDeps {
  readonly team: TeamMemberPort;
  readonly workspace: WorkspacePort;
  readonly checks: ChecksPort;
  readonly log: RunLogPort;
  readonly progress: ProgressPort;
  readonly user: UserPort;
  readonly roles: RoleSettingsDto;
  readonly newId: () => string;
  readonly now: () => number;
  /** 팀원에게 알려 줄 오늘 날짜(YYYY-MM-DD). 웹 검색 결과를 판단할 기준이다. */
  readonly today: () => string;
  readonly badge: string;
  readonly requireClean: boolean;
  /** 대화 세션에서 앞 요청까지 rauha가 남긴 파일 → 내용 값. 그대로면 그 위에서 이어 일한다. */
  readonly carried?: ReadonlyMap<string, string>;
  /** 1차 구현 → 리뷰어 재검증·2차 구현 → 사실 점검. false(--quick)면 검증 통과로 완료. */
  readonly threePass: boolean;
  /** 같은 폴더의 다른 rauha와 작업이 겹치지 않게 하는 잠금. 없으면 잠그지 않는다. */
  readonly lock?: WorkLockPort;
  /** 저장소 지식. 있으면 접수 팀장이 파일 목록 대신 받고, 끝나면 바뀐 파일을 알린다. */
  readonly knowledge?: KnowledgePort;
}

const NO_LOCK: HeldLock = { release: async () => undefined };

/** 한 번 실행하는 동안의 기록. 판정에는 쓰지 않는다. */
class RunTally {
  /** 사용자 요청. 팀원마다 붙일 도구 묶음(ToolKits)을 이것으로 고른다. */
  constructor(readonly request: string = '') {}

  readonly usage: Record<ModelTier, { calls: number; tokens: number }> = {
    haiku: { calls: 0, tokens: 0 },
    sonnet: { calls: 0, tokens: 0 },
    opus: { calls: 0, tokens: 0 },
  };
  costUsd = 0;
  calls = 0;
  readonly attempts: Record<MemberRole, number> = { intake: 0, tester: 0, implementer: 0, reviewer: 0, router: 0, answerer: 0, surveyor: 0, writer: 0, designer: 0, operator: 0, debugger: 0, riskchecker: 0, planner: 0, chief: 0, bm: 0, marketer: 0, growth: 0, uxdesigner: 0, brand: 0, securitychecker: 0, releaser: 0, splitter: 0 };
  readonly implementerTiers: ModelTier[] = [];
  /** 승격된 업무에서 구현 팀원을 부른 적이 있는지(모델 고정 실험과 구분하려고 모델 이름이 아니라 업무 상태로 센다) */
  escalated = false;
  /** 이번 업무에서 팀원들이 실제로 연 주소(정규화) → 본문. web 근거 확인 재료. */
  readonly fetched = new Map<string, string | null>();

  add(call: MemberCall, result: MemberResult): number {
    if (call.role === 'implementer') this.implementerTiers.push(call.setting.tier);
    for (const page of result.fetched) this.fetched.set(normalizeUrl(page.url), page.body);
    const tier = this.usage[call.setting.tier];
    tier.calls += 1;
    tier.tokens += result.usage.inputTokens + result.usage.outputTokens + result.usage.cacheReadTokens;
    this.costUsd += result.usage.costUsd;
    this.calls += 1;
    this.attempts[call.role] += 1;
    return this.attempts[call.role];
  }
}

/**
 * 1단계 최소 루프: 접수 → Red(테스트 팀원) → Green(구현 주니어) → 검증 → 읽기 안내서.
 * 순서와 판정은 WorkOrder·RunScope·Verification이 정하고, 이 서비스는 팀원과 검사를
 * 불러서 결과를 엔티티 메서드에 넘기기만 한다.
 */
export class MinimalLoopService {
  /** 이번 실행이 본 기준. 루프는 요청 하나마다 새로 만들어지므로 여기 둔다. */
  private basis: string | null = null;

  constructor(private readonly deps: MinimalLoopDeps) {}

  async run(request: string, context: RunContextBlocks = NO_CONTEXT): Promise<RunOutcome> {
    const held = this.deps.lock === undefined ? NO_LOCK : await this.deps.lock.acquire();
    if (held === null) {
      throw new DomainError(
        'BUSY_WORKTREE',
        '다른 rauha가 이 폴더에서 작업 중이에요. 그 작업이 끝나고 커밋한 뒤 요청하거나, 동시에 하려면 git worktree로 다른 폴더를 만들어 거기서 rauha를 띄우세요.',
      );
    }
    try {
      return await this.runLocked(request, context);
    } finally {
      await held.release();
    }
  }

  private async runLocked(request: string, context: RunContextBlocks): Promise<RunOutcome> {
    const started = this.deps.now();
    const { workspace } = this.deps;
    const dirty = await workspace.dirtyFiles();
    const start = dirty === null ? { files: new Map<string, string>() } : await workspace.snapshot();
    WorkspaceState.of(dirty, this.deps.carried, start.files).assertReady(this.deps.requireClean);
    const tally = new RunTally(request);
    const current: RunProgress = { title: request.slice(0, 60), assumptions: [], start, lockedTests: [] };
    try {
      return await this.execute(request, tally, started, current, context);
    } catch (error) {
      if (!(error instanceof AccountBlocked)) throw error;
      return this.finish({ tally, started, start: current.start, lockedTests: current.lockedTests, title: current.title, status: 'stopped', stopReason: BLOCK_STOP[error.block.reason], assumptions: current.assumptions });
    }
  }

  private async execute(request: string, tally: RunTally, started: number, current: RunProgress, context: RunContextBlocks): Promise<RunOutcome> {
    const { workspace, checks, log, progress } = this.deps;
    progress.step('기준선 검사와 팀장 접수를 함께 시작합니다');
    const [baselineResults, intake] = await Promise.all([checks.runSuite(), this.knowledgeBlock().then((known) => this.intake(request, tally, context, known))]);
    const baseline = Verification.of(baselineResults);
    await log.recordChecks('baseline', baselineResults);

    if (intake === null) {
      return this.finish({ tally, started, start: current.start, lockedTests: current.lockedTests, title: request.slice(0, 60), status: 'stopped', stopReason: 'intake-failed', assumptions: [] });
    }
    const { dto, order, assumptions } = intake;
    current.title = order.title;
    current.assumptions = assumptions;
    const commands = baseline.commandsNote();
    const brief = [
      `<today>${this.deps.today()}</today>`,
      dto.toBrief(order.difficulty.grade),
      commands !== '' ? `<checks>\nrauha가 이 프로젝트에서 쓰는 검사 명령입니다.\n${commands}\n</checks>` : '',
    ]
      .filter((s) => s !== '')
      .join('\n\n');
    progress.step(`업무: [${order.difficulty.grade}] ${order.title}`);

    const scope = this.deps.threePass ? RunScope.threePass() : RunScope.ladder();
    const review = new ReviewState();
    let redFeedback: string | null = null;
    let lastFailure: string | null = null;
    let lockedTests: string[] = [];
    let verdict: VerificationVerdict | null = null;
    let explanation: ExplanationDto | null = null;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const decision = scope.decide(order);
      if (decision.kind === 'complete') {
        return this.finish({ tally, started, start: current.start, lockedTests: current.lockedTests, title: order.title, status: 'complete', stopReason: null, verdict, explanation, assumptions, facts: review.summary() });
      }
      if (decision.kind === 'stop') {
        return this.finish({ tally, started, start: current.start, lockedTests: current.lockedTests, title: order.title, status: 'stopped', stopReason: decision.reason, verdict, explanation, assumptions, facts: review.summary() });
      }

      if (decision.assignment.role === 'reviewer') {
        const reviewed = await this.review({ brief, order, lockedTests, explanation, tally, assumptions, state: review, tier: decision.assignment.tier, start: current.start });
        order.recordReview(reviewed);
        continue;
      }

      if (decision.assignment.role === 'tester') {
        const attempt = tally.attempts.tester + 1;
        const message = [
          brief,
          await this.filesBlock(dto.readFirst),
          '<task>위 수용 기준을 검사하는, 지금은 실패하는 테스트를 작성하세요.</task>',
          redFeedback ? `<previous_attempt>\n${redFeedback}\n</previous_attempt>` : '',
        ]
          .filter((s) => s !== '')
          .join('\n\n');
        await this.call('tester', message, TESTER_REPORT_SCHEMA, order, tally, decision.assignment.tier);
        const result = await this.judgeRed(order, current.start);
        await log.recordChecks(`red-${attempt}`, result.checks);
        lockedTests = result.testFiles;
        current.lockedTests = lockedTests;
        redFeedback = result.feedback;
        continue;
      }

      // implementer
      const attempt = tally.attempts.implementer + 1;
      const handoff = order.handoffNote();
      const message = [
        brief,
        `<locked_tests>\n${lockedTests.join('\n')}\n</locked_tests>`,
        await this.filesBlock([...lockedTests, ...dto.readFirst]),
        '<task>잠긴 테스트를 통과시키는 최소 구현을 하세요. 테스트 파일은 고칠 수 없습니다.</task>',
        handoff !== '' ? `<handoff>\n이전 시도의 실패 요약입니다.\n${handoff}\n</handoff>` : '',
        lastFailure !== null ? `<last_failure>\n지난 시도에서 rauha가 직접 본 실패 메시지입니다.\n${lastFailure}\n</last_failure>` : '',
        order.isEscalated() ? ESCALATION_NOTE : '',
        review.feedback !== null
          ? `<review>\n리뷰에서 근거가 확인된 지적과 사용자 정정입니다. 이것만 고치고, 다른 곳은 건드리지 마세요.\n${review.feedback}\n</review>`
          : '',
      ]
        .filter((s) => s !== '')
        .join('\n\n');
      review.feedback = null;
      const before = await workspace.snapshot();
      tally.escalated ||= order.isEscalated();
      const output = await this.call('implementer', message, IMPLEMENTER_REPORT_SCHEMA, order, tally, decision.assignment.tier);
      const changed = workspace.changesBetween(before, await workspace.snapshot()).map((c) => c.path);
      explanation = this.readExplanation(output) ?? explanation;

      try {
        order.assertDiffAllowed('implementer', changed);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        order.recordGreen(TestRun.of({ passed: 0, failed: 1, failedNames: ['쓰기 거부'] }), `쓰기 거부: ${error.message}`);
        lastFailure = error.message;
        continue;
      }

      progress.step('검증 묶음을 실행합니다');
      const locked = await checks.runTests(lockedTests);
      review.passed = locked.passed;
      const results = [Verification.lockedTests(locked.run, locked.command, locked.digest), ...(await checks.runSuite())];
      await log.recordChecks(`green-${attempt}`, results);
      verdict = Verification.of(results).judge(baseline);
      order.recordGreen(verdict.toTestRun(locked.run), verdict.toFailureNote());
      lastFailure = verdict.failureDetail();
    }
    return this.finish({ tally, started, start: current.start, lockedTests: current.lockedTests, title: order.title, status: 'stopped', stopReason: 'halted', verdict, explanation, assumptions, facts: review.summary() });
  }

  // ── 재검증과 사실 점검 ────────────────────────────────────

  /**
   * 리뷰 한 번: 리뷰어 호출 → 근거 재료 모으기 → 구현·리뷰 주장 확인 → 코드에 들어간 추측은 사용자 확인
   * → 확인된 지적·정정이 있으면 changes. 판정 규칙은 FactCheck·ReviewFindings에 있다.
   */
  private async review(p: {
    brief: string;
    order: WorkOrder;
    lockedTests: readonly string[];
    explanation: ExplanationDto | null;
    tally: RunTally;
    assumptions: readonly SettledAssumption[];
    state: ReviewState;
    start: WorkspaceSnapshot;
    tier: ModelTier;
  }): Promise<'pass' | 'changes'> {
    const { workspace, user } = this.deps;
    const state = p.state;
    state.rounds += 1;
    const changes = workspace.changesBetween(p.start, await workspace.snapshot());
    const report = { decisions: p.explanation?.decisions ?? [], facts: p.explanation?.facts ?? [] };
    const message = [
      p.brief,
      `<locked_tests>\n${p.lockedTests.join('\n')}\n</locked_tests>`,
      `<changed_files>\n${changes.map((c) => `${c.kind} ${c.path}`).join('\n')}\n</changed_files>`,
      await this.filesBlock([...changes.filter((c) => c.kind !== 'deleted').map((c) => c.path), ...p.lockedTests]),
      `<implementer_report>\n${JSON.stringify(report, null, 2)}\n</implementer_report>`,
      '<task>위 변경을 처음 보는 눈으로 검토하세요. 근거가 확인되는 문제만 수정 요청이 됩니다.</task>',
    ].join('\n\n');
    const reviewReport = this.readReview(await this.call('reviewer', message, REVIEWER_REPORT_SCHEMA, p.order, p.tally, p.tier));
    state.missing ||= reviewReport === null;

    const implementerClaims = p.explanation?.claims() ?? [];
    const reviewClaims = reviewReport?.claims() ?? [];
    const paths = citedPaths([...implementerClaims, ...reviewClaims]);
    const files = new Map(await Promise.all(paths.map(async (path) => [path, await workspace.readFile(path)] as const)));
    const sources = {
      files,
      passedTests: state.passed,
      fetched: p.tally.fetched,
      // 업무 지시서에는 "질문 → 해석"으로 적혀 있어서 팀원은 그 형태로 인용한다.
      userStatements: [...p.assumptions.map((a) => `${a.question} → ${a.chosen}`), ...state.corrections],
      records: [],
    };
    let implementerCheck = FactCheck.of(implementerClaims, sources).withConfirmed(state.confirmed);
    const reviewCheck = FactCheck.of(reviewClaims, sources);

    const corrections: string[] = [];
    if (user.interactive) {
      for (const guess of implementerCheck.guesses('fact')) {
        const answer = await user.confirmFact(guess);
        if (answer.kind === 'correct') state.confirmed.push(guess.text);
        if (answer.kind === 'wrong') corrections.push(answer.correction);
      }
      implementerCheck = implementerCheck.withConfirmed(state.confirmed);
    }
    state.corrections.push(...corrections);

    const findings = ReviewFindings.of(reviewCheck, corrections);
    state.feedback = findings.verdict() === 'changes' ? findings.feedback() : null;
    state.checked = implementerCheck.all();
    state.reviewerGuesses = reviewCheck.guesses('review');
    state.unconfirmed = user.interactive ? [] : implementerCheck.guesses('fact');
    return findings.verdict();
  }

  private readReview(output: unknown): ReviewReportDto | null {
    try {
      return ReviewReportDto.from(output);
    } catch (error) {
      if (error instanceof DomainError) return null;
      throw error;
    }
  }

  // ── 접수 ──────────────────────────────────────────────────

  /**
   * 접수 → 해석이 갈리는 지점 중 사용자가 꼭 정해야 하는 것만 확인 → 다른 해석을 고르면 확정해서 한 번 더 접수.
   * 나머지와 물어볼 화면이 없을 때는 추천 해석으로 진행하고, 알아서 정한 해석으로 안내서에 남긴다.
   */
  /** 저장소 지식 묶음. 없거나(지식 없음, git 아님) 읽다 실패하면 null — 그때는 지금처럼 파일 목록을 쓴다. */
  private async knowledgeBlock(): Promise<string | null> {
    try {
      const known = (await this.deps.knowledge?.current()) ?? null;
      this.basis = known?.basis.label() ?? null;
      return known?.block ?? null;
    } catch {
      return null;
    }
  }

  private async intake(request: string, tally: RunTally, context: RunContextBlocks, known: string | null): Promise<{ dto: IntakeDto; order: WorkOrder; assumptions: SettledAssumption[] } | null> {
    const first = await this.intakeOnce(request, [], tally, context, known);
    if (first === null || first.dto.assumptions.length === 0) return first === null ? null : { ...first, assumptions: [] };

    const { user, progress } = this.deps;
    if (!user.interactive) return { ...first, assumptions: first.dto.settleAssumptions(null).map(toSettled) };

    // 사용자가 꼭 정해야 하는 해석만 묻는다. 나머지는 추천대로 진행하고 안내서에 '알아서 정한 해석'으로 남긴다.
    const picks: (number | null)[] = [];
    if (first.dto.assumptions.some((a) => a.needsUser)) progress.step('꼭 정해 주셔야 하는 곳이 있어 확인합니다');
    for (const assumption of first.dto.assumptions) picks.push(assumption.needsUser ? await user.choose(assumption) : null);
    const settled = first.dto.settleAssumptions(picks);
    if (!settled.some((s) => s.changed)) return { ...first, assumptions: settled.map(toSettled) };

    const second = await this.intakeOnce(request, settled, tally, context, known);
    if (second === null) return null;
    return { ...second, assumptions: [...settled.map(toSettled), ...second.dto.settleAssumptions(null).map(toSettled)] };
  }

  private async intakeOnce(
    request: string,
    clarifications: readonly SettledAssumptionChoice[],
    tally: RunTally,
    context: RunContextBlocks,
    known: string | null,
  ): Promise<{ dto: IntakeDto; order: WorkOrder } | null> {
    // 저장소 지식이 있으면 전체 파일 목록 대신 그것을 맨 앞에 둔다(같은 저장소면 앞부분이 같아 캐시가 맞는다).
    const files = known === null ? await this.deps.workspace.listFiles() : [];
    let feedback: string | null = null;
    for (let attempt = 1; attempt <= INTAKE_ATTEMPTS; attempt += 1) {
      const message = [
        `<today>${this.deps.today()}</today>`,
        known ?? '',
        context.conversation !== null
          ? `<conversation>\n이번 세션의 앞 대화입니다. 요청이 이걸 가리키면 이어서 해석하세요.\n${context.conversation}\n</conversation>`
          : '',
        context.pastWork !== null
          ? `<past_work>\n사용자가 이어서 고치려고 고른 지난 작업입니다. 바꾼 파일·결정·정한 해석을 존중하세요.\n${context.pastWork}\n</past_work>`
          : '',
        context.design ?? '',
        `<request>\n${request}\n</request>`,
        known === null ? `<project_files>\n${files.join('\n')}\n</project_files>` : '',
        clarifications.length > 0
          ? `<clarifications>\n사용자가 직접 정한 해석입니다. 이대로 수용 기준을 쓰고, 이 지점은 assumptions에 다시 넣지 마세요.\n${clarifications.map((c) => `- ${c.question} → ${c.chosen}`).join('\n')}\n</clarifications>`
          : '',
        feedback ? `<previous_attempt>\n${feedback}\n</previous_attempt>` : '',
      ]
        .filter((s) => s !== '')
        .join('\n\n');
      const output = await this.call('intake', message, INTAKE_SCHEMA, null, tally);
      try {
        const dto = IntakeDto.from(output);
        const order = dto.toOpenWorkOrder().toEntity(this.deps.newId());
        order.approveScenario(dto.toScenarioSummary());
        return { dto, order };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        feedback = `지난 업무 지시서가 거부됐습니다: ${error.message}`;
      }
    }
    return null;
  }

  // ── Red 판정 ──────────────────────────────────────────────

  private async judgeRed(order: WorkOrder, start: WorkspaceSnapshot): Promise<{ testFiles: string[]; feedback: string | null; checks: ReturnType<typeof Verification.lockedTests>[] }> {
    const { workspace } = this.deps;
    const changes = workspace.changesBetween(start, await workspace.snapshot());
    const paths = changes.map((c) => c.path);
    const testFiles = changes.filter((c) => c.kind !== 'deleted' && WritePolicy.isTestFile(c.path)).map((c) => c.path);
    const invalid = TestRun.of({ passed: 0, failed: 0 });
    try {
      order.assertDiffAllowed('tester', paths);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      order.recordRed(invalid);
      return { testFiles, feedback: error.message, checks: [] };
    }
    if (testFiles.length === 0) {
      order.recordRed(invalid);
      return { testFiles, feedback: '테스트 파일을 만들거나 고치지 않았습니다.', checks: [] };
    }
    const result = await this.deps.checks.runTests(testFiles);
    order.recordRed(result.run);
    const problem = result.run.redProblem();
    return {
      testFiles,
      feedback: problem === null ? null : [problem, result.digest].filter((s) => s !== '').join('\n'),
      checks: [Verification.lockedTests(result.run, result.command)],
    };
  }

  // ── 팀원 호출 ─────────────────────────────────────────────

  /** 팀원이 먼저 볼 파일을 부르기 직전 내용으로 붙인다(팀원이 도구로 여는 턴을 줄인다). */
  private async filesBlock(paths: readonly string[]): Promise<string> {
    const files = await Promise.all(paths.map(async (path) => ({ path, content: await this.deps.workspace.readFile(path) })));
    return FilesBlockDto.of(files).toBlock();
  }

  /** tier: 상태 머신이 배정한 모델. 접수(팀장)는 배정이 없으므로 역할 기본값을 쓴다. */
  private async call(
    role: MemberRole,
    userMessage: string,
    outputSchema: Record<string, unknown>,
    order: WorkOrder | null,
    tally: RunTally,
    tier?: ModelTier,
  ): Promise<unknown> {
    const setting = tier === undefined ? this.deps.roles.get(role) : this.deps.roles.forAssignment(role, tier);
    const writeRole = ROLE_INFO[role].writeRole;
    const call: MemberCall = {
      role,
      setting,
      userMessage,
      outputSchema,
      canWrite: (path) => order !== null && order.allowsWrite(writeRole, path),
      kits: ToolKits.for(role, tally.request),
    };
    this.deps.progress.step(`${ROLE_INFO[role].stepName} 작업 중…`, role);
    const result = await this.deps.team.run(call);
    const attempt = tally.add(call, result);
    await this.deps.log.recordCall(role, attempt, call, result);
    if (result.blocked) {
      this.deps.progress.step(`${BLOCK_STEP[result.blocked.reason]}: ${result.blocked.message}`);
      throw new AccountBlocked(result.blocked);
    }
    if (result.error !== null) this.deps.progress.step(`${ROLE_INFO[role].stepName} 오류: ${result.error}`);
    return result.output;
  }

  private readExplanation(output: unknown): ExplanationDto | null {
    try {
      return MemberReportDto.from(output, true).explanation;
    } catch (error) {
      if (error instanceof DomainError) return null;
      throw error;
    }
  }

  // ── 마무리 ────────────────────────────────────────────────

  private async finish(props: {
    tally: RunTally;
    started: number;
    start: WorkspaceSnapshot;
    lockedTests: readonly string[];
    title: string;
    status: 'complete' | 'stopped';
    stopReason: RunStopReason | null;
    verdict?: VerificationVerdict | null;
    explanation?: ExplanationDto | null;
    assumptions: readonly SettledAssumption[];
    facts?: FactsSummary;
  }): Promise<RunOutcome> {
    const facts = props.facts ?? new ReviewState().summary();
    const after = await this.deps.workspace.snapshot();
    const changedInRun = this.deps.workspace.changesBetween(props.start, after);
    // 방금 rauha가 바꾼 파일을 지식에 바로 알린다(모델 없이 심볼·기준만). 실패해도 결과는 그대로.
    if (changedInRun.length > 0) await this.deps.knowledge?.noteChanged(changedInRun.map((c) => c.path)).catch(() => undefined);
    const { tally } = props;
    const durationMs = this.deps.now() - props.started;
    const guideProps = {
      badge: this.deps.badge,
      title: props.title,
      status: props.status,
      stopReason: props.stopReason,
      durationMs,
      costUsd: tally.costUsd,
      tierCalls: { haiku: tally.usage.haiku.calls, sonnet: tally.usage.sonnet.calls, opus: tally.usage.opus.calls },
      explanation: props.explanation ?? null,
      verdict: props.verdict ?? null,
      changes: changedInRun,
      assumptions: props.assumptions,
      facts,
      basis: this.basis,
    };
    const summary = {
      title: props.title,
      status: props.status,
      stopReason: props.stopReason,
      durationMs,
      costUsd: tally.costUsd,
      usage: tally.usage,
      attempts: tally.attempts,
      implementerTiers: tally.implementerTiers,
    };
    const escalated = tally.escalated;
    const finalTier = tally.implementerTiers.at(-1) ?? null;
    const logDir = await this.deps.log.finish(summary, ReadingGuideDto.create({ ...guideProps, logDir: null }).toMarkdown());
    return {
      guide: ReadingGuideDto.create({ ...guideProps, logDir }),
      status: props.status,
      stopReason: props.stopReason,
      title: props.title,
      calls: tally.calls,
      implementerAttempts: tally.attempts.implementer,
      costUsd: tally.costUsd,
      durationMs,
      usage: tally.usage,
      escalated,
      finalTier,
      facts,
      changedInRun,
      snapshotAfter: after.files,
      lockedTests: props.lockedTests,
      assumptions: props.assumptions,
      explanation: props.explanation ?? null,
      logDir,
      basis: this.basis,
    };
  }
}
