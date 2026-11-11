import type { Assignment, ModelTier, TeamRole } from './team.js';
import type { Stage, WorkOrder } from './work-order.js';

export type StopReason =
  | 'too-large'
  | 'needs-senior'
  | 'needs-support'
  | 'halted'
  | 'invalid-tests'
  | 'review-loop'
  | 'escalation-exhausted'
  | 'unsupported-stage';

export type ScopeDecision =
  | { readonly kind: 'continue'; readonly assignment: Assignment }
  | { readonly kind: 'complete' }
  | { readonly kind: 'stop'; readonly reason: StopReason };

const HALT_STOP: Readonly<Record<string, StopReason>> = { 'invalid-tests': 'invalid-tests', 'review-loop': 'review-loop', 'escalation-exhausted': 'escalation-exhausted' };

const RED_GREEN = new Map<Stage, TeamRole>([
  ['red', 'tester'],
  ['green', 'implementer'],
]);

/**
 * 이번 실행이 어디까지 다루는지. 1단계(최소 루프)는 Haiku 테스트 팀원과
 * Haiku 구현 주니어만 부르고, review 단계에 닿으면 완료로 본다.
 * 2단계(사다리)는 상태 머신이 sonnet으로 올린 팀원도 부르고, 디버깅·자문이 필요해지면 멈춘다.
 */
export class RunScope {
  private constructor(
    private readonly supported: ReadonlyMap<Stage, TeamRole>,
    private readonly tiers: ReadonlySet<ModelTier>,
    private readonly completeAt: Stage,
    /** 디버깅·설계 자문 팀이 아직 없어서, 지원 요청이 나오면 멈추지 않고 구현 시니어가 다시 시도한다 */
    private readonly selfSupport: boolean = false,
  ) {}

  static minimalLoop(): RunScope {
    return new RunScope(RED_GREEN, new Set(['haiku']), 'review');
  }

  static ladder(): RunScope {
    return new RunScope(RED_GREEN, new Set(['haiku', 'sonnet']), 'review');
  }

  /**
   * 사다리 + 리뷰어 재검증. 리뷰가 통과해 docs 단계에 닿으면 완료(문서 팀은 아직 없음).
   * 민감한 업무(인증·결제)의 리뷰어는 opus라 opus도 부른다(테스트·구현은 상태 머신이 opus를 배정하지 않는다).
   */
  static threePass(): RunScope {
    return new RunScope(new Map<Stage, TeamRole>([...RED_GREEN, ['review', 'reviewer']]), new Set(['haiku', 'sonnet', 'opus']), 'docs', true);
  }

  /** 지원 요청이 쌓였는데 지원 팀이 없는 범위인가. 그러면 서비스가 지원 없이 다시 시도하게 한다(order.resolveSupport). */
  retriesWithoutSupport(order: WorkOrder): boolean {
    return this.selfSupport && order.pendingSupport !== null;
  }

  decide(order: WorkOrder): ScopeDecision {
    if (order.stage === this.completeAt) return { kind: 'complete' };
    if (order.stage === 'halted') return { kind: 'stop', reason: HALT_STOP[order.haltReason ?? ''] ?? 'halted' };
    if (order.pendingSupport !== null) return { kind: 'stop', reason: 'needs-support' };

    const assignment = order.nextAssignment();
    const role = this.supported.get(order.stage);
    if (assignment === null || role === undefined || assignment.role !== role) {
      return { kind: 'stop', reason: 'unsupported-stage' };
    }
    if (!this.tiers.has(assignment.tier)) return { kind: 'stop', reason: 'needs-senior' };
    return { kind: 'continue', assignment };
  }
}
