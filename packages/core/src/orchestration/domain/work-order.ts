import { DomainError } from '../../shared/domain-error.js';
import type { Difficulty } from './difficulty.js';
import type { Assignment, ModelTier, TeamRole } from './team.js';
import type { TestRun } from './test-run.js';
import { WritePolicy } from './write-policy.js';

export type Stage = 'scenario' | 'design' | 'red' | 'green' | 'review' | 'docs' | 'done' | 'halted';

/**
 * 구현 승격 사다리.
 * junior(Haiku) 2회 실패 → senior(Sonnet) 1회 실패 → 디버깅 지원 후 재시도
 * → 또 실패 → 설계 자문(Opus) 후 재시도 → 또 실패 → 작업 중단, 나에게 보고
 */
export type ImplementerRung = 'junior' | 'senior' | 'senior-after-debug' | 'senior-after-advice';

export type SupportRequest = 'debugger' | 'advisor';

export type HaltReason = 'escalation-exhausted' | 'review-loop' | 'invalid-tests';

export type ReviewVerdict = 'pass' | 'changes';

export interface ScenarioSummary {
  readonly happyPaths: number;
  readonly errorPaths: number;
}

const JUNIOR_ATTEMPTS = 2;
const SCENARIO_REJECTIONS_BEFORE_SENIOR = 2;
const INVALID_REDS_BEFORE_SENIOR = 2;
/** 올바른 이유로 실패하는 테스트를 이만큼 못 쓰면 요청이 테스트로 풀 일이 아니거나 막힌 것이므로 멈춘다. */
const INVALID_REDS_BEFORE_HALT = 4;
const REVIEW_CHANGES_BEFORE_HALT = 2;
const HANDOFF_LINES = 5;

interface WorkOrderState {
  id: string;
  title: string;
  difficulty: Difficulty;
  sensitive: boolean;
  scope: readonly string[];
  stage: Stage;
  rung: ImplementerRung;
  failuresOnRung: number;
  pendingSupport: SupportRequest | null;
  scenarioRejections: number;
  invalidReds: number;
  reviewChanges: number;
  testsLocked: boolean;
  haltReason: HaltReason | null;
  failureNotes: string[];
}

/**
 * 업무 하나(애그리거트 루트). 파이프라인의 모든 전이 규칙이 이 엔티티의 메서드에 있다.
 * 팀장 모델은 이 엔티티가 허락한 다음 할 일(nextAssignment)만 배분한다.
 */
export class WorkOrder {
  private constructor(private readonly state: WorkOrderState) {}

  static open(props: {
    id: string;
    title: string;
    difficulty: Difficulty;
    sensitive: boolean;
    scope: readonly string[];
  }): WorkOrder {
    if (props.title.trim() === '') {
      throw new DomainError('EMPTY_TITLE', '업무 제목이 비어 있습니다.');
    }
    if (props.scope.length === 0) {
      throw new DomainError('EMPTY_SCOPE', '업무 범위(건드려도 되는 경로)를 하나 이상 지정해야 합니다.');
    }
    return new WorkOrder({
      id: props.id,
      title: props.title.trim(),
      difficulty: props.difficulty,
      sensitive: props.sensitive,
      scope: [...props.scope],
      stage: 'scenario',
      rung: props.difficulty.startsWithSenior() ? 'senior' : 'junior',
      failuresOnRung: 0,
      pendingSupport: null,
      scenarioRejections: 0,
      invalidReds: 0,
      reviewChanges: 0,
      testsLocked: false,
      haltReason: null,
      failureNotes: [],
    });
  }

  get id(): string {
    return this.state.id;
  }
  get title(): string {
    return this.state.title;
  }
  get difficulty(): Difficulty {
    return this.state.difficulty;
  }
  get stage(): Stage {
    return this.state.stage;
  }
  get rung(): ImplementerRung {
    return this.state.rung;
  }
  get pendingSupport(): SupportRequest | null {
    return this.state.pendingSupport;
  }
  get testsLocked(): boolean {
    return this.state.testsLocked;
  }
  get haltReason(): HaltReason | null {
    return this.state.haltReason;
  }

  /** 구현이 주니어에서 시니어 이상으로 올라간 업무인지. 승격된 시도에는 다른 접근을 요구한다. */
  isEscalated(): boolean {
    return this.state.rung !== 'junior';
  }

  isFinished(): boolean {
    return this.state.stage === 'done' || this.state.stage === 'halted';
  }

  // ── 기획 (BDD) ────────────────────────────────────────────

  approveScenario(summary: ScenarioSummary): void {
    this.assertStage('scenario');
    if (summary.happyPaths < 1 || summary.errorPaths < 1) {
      throw new DomainError(
        'INCOMPLETE_SCENARIO',
        '시나리오에는 정상 경로와 예외 경로가 각각 1개 이상 있어야 합니다.',
      );
    }
    this.state.stage = this.state.difficulty.requiresDesign() ? 'design' : 'red';
  }

  rejectScenario(): void {
    this.assertStage('scenario');
    this.state.scenarioRejections += 1;
  }

  // ── 설계 ──────────────────────────────────────────────────

  completeDesign(): void {
    this.assertStage('design');
    this.state.stage = 'red';
  }

  // ── 테스트 (Red) ──────────────────────────────────────────

  /** 올바른 이유로 실패하면 테스트를 잠그고 구현 단계로 넘어간다. */
  recordRed(run: TestRun): void {
    this.assertStage('red');
    if (!run.isValidRed()) {
      this.state.invalidReds += 1;
      if (this.state.invalidReds >= INVALID_REDS_BEFORE_HALT) this.halt('invalid-tests');
      return;
    }
    this.state.testsLocked = true;
    this.state.stage = 'green';
  }

  /**
   * 이 프로젝트에서 테스트를 실행할 방법이 없으면 Red를 건너뛰고 구현으로 간다(테스트가 없다고 코드 수정을 못 해 주면 안 되므로).
   * 테스트는 잠기지 않는다. 검증은 타입·린트 검사와 리뷰가 맡는다.
   */
  proceedWithoutTests(): void {
    this.assertStage('red');
    this.state.stage = 'green';
  }

  // ── 구현 (Green) ──────────────────────────────────────────

  recordGreen(run: TestRun, failureNote?: string): void {
    this.assertStage('green');
    if (this.state.pendingSupport !== null) {
      throw new DomainError(
        'SUPPORT_PENDING',
        `${this.state.pendingSupport} 지원 결과를 먼저 반영해야 합니다.`,
      );
    }
    if (run.isGreen()) {
      this.state.stage = 'review';
      this.state.failureNotes = [];
      return;
    }
    if (failureNote) this.state.failureNotes.push(failureNote.trim());
    this.state.failuresOnRung += 1;
    this.climbAfterFailure();
  }

  /** 디버깅 팀 또는 설계 자문의 보고를 받은 뒤 시니어가 다시 시도한다. */
  resolveSupport(): void {
    this.assertStage('green');
    const pending = this.state.pendingSupport;
    if (pending === null) {
      throw new DomainError('NO_SUPPORT_PENDING', '기다리는 지원 요청이 없습니다.');
    }
    this.state.pendingSupport = null;
    this.state.rung = pending === 'debugger' ? 'senior-after-debug' : 'senior-after-advice';
    this.state.failuresOnRung = 0;
  }

  /** 승격할 때 다음 팀원에게 넘길 실패 요약. 전체 대화 대신 최근 몇 줄만 넘긴다. */
  handoffNote(): string {
    return this.state.failureNotes.slice(-HANDOFF_LINES).join('\n');
  }

  // ── 리뷰·리팩터 ───────────────────────────────────────────

  recordReview(verdict: ReviewVerdict): void {
    this.assertStage('review');
    if (verdict === 'pass') {
      this.state.stage = 'docs';
      return;
    }
    this.state.reviewChanges += 1;
    if (this.state.reviewChanges >= REVIEW_CHANGES_BEFORE_HALT) {
      this.halt('review-loop');
      return;
    }
    this.state.stage = 'green';
  }

  // ── 문서 ──────────────────────────────────────────────────

  completeDocs(): void {
    this.assertStage('docs');
    this.state.stage = 'done';
  }

  // ── 배분과 권한 ───────────────────────────────────────────

  /** 팀장이 다음에 부를 팀원과 모델. 끝난 업무면 null. */
  nextAssignment(): Assignment | null {
    const senior = this.state.difficulty.startsWithSenior();
    switch (this.state.stage) {
      case 'scenario':
        return {
          role: 'planner',
          tier: senior || this.state.scenarioRejections >= SCENARIO_REJECTIONS_BEFORE_SENIOR ? 'sonnet' : 'haiku',
        };
      case 'design':
        return { role: 'architect', tier: 'opus' };
      case 'red':
        return {
          role: 'tester',
          tier: senior || this.state.invalidReds >= INVALID_REDS_BEFORE_SENIOR ? 'sonnet' : 'haiku',
        };
      case 'green':
        if (this.state.pendingSupport === 'debugger') return { role: 'debugger', tier: 'sonnet' };
        if (this.state.pendingSupport === 'advisor') return { role: 'architect', tier: 'opus' };
        return { role: 'implementer', tier: this.implementerTier() };
      case 'review':
        return { role: 'reviewer', tier: this.state.sensitive ? 'opus' : 'sonnet' };
      case 'docs':
        return { role: 'writer', tier: 'haiku' };
      case 'done':
      case 'halted':
        return null;
    }
  }

  /** 팀원이 쓰기 전에(도구 호출 단계에서) 그 경로를 쓸 수 있는지. */
  allowsWrite(role: TeamRole, path: string): boolean {
    return WritePolicy.forScope(this.state.scope).allows(role, path, this.state.testsLocked);
  }

  /** 팀원이 낸 diff를 검사한다. 거부된 경로가 있으면 DomainError. */
  assertDiffAllowed(role: TeamRole, changedPaths: readonly string[]): void {
    WritePolicy.forScope(this.state.scope).assertDiff(role, changedPaths, this.state.testsLocked);
  }

  // ── 내부 규칙 ─────────────────────────────────────────────

  private implementerTier(): ModelTier {
    return this.state.rung === 'junior' ? 'haiku' : 'sonnet';
  }

  private climbAfterFailure(): void {
    switch (this.state.rung) {
      case 'junior':
        if (this.state.failuresOnRung >= JUNIOR_ATTEMPTS) {
          this.state.rung = 'senior';
          this.state.failuresOnRung = 0;
        }
        return;
      case 'senior':
        // 시니어로 시작한 업무(L급)는 주니어 두 번을 건너뛰었으니 시니어가 그만큼 한 번 더 한다.
        if (this.state.difficulty.startsWithSenior() && this.state.failuresOnRung < JUNIOR_ATTEMPTS) return;
        this.state.pendingSupport = 'debugger';
        return;
      case 'senior-after-debug':
        this.state.pendingSupport = 'advisor';
        return;
      case 'senior-after-advice':
        this.halt('escalation-exhausted');
        return;
    }
  }

  private halt(reason: HaltReason): void {
    this.state.stage = 'halted';
    this.state.haltReason = reason;
  }

  private assertStage(expected: Stage): void {
    if (this.state.stage !== expected) {
      throw new DomainError(
        'INVALID_STAGE',
        `지금 단계는 ${this.state.stage}입니다. ${expected} 단계에서만 할 수 있는 일입니다.`,
      );
    }
  }
}
