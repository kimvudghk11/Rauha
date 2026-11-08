import type { SessionBudget } from '../../orchestration/domain/session-budget.js';
import type { ModelTier } from '../../orchestration/domain/team.js';
import { DomainError } from '../../shared/domain-error.js';
import type { AnalysisReach } from './analysis-reach.js';
import type { Blueprint } from './blueprint.js';
import type { DirectionAnswer, DirectionChoice, DirectionSet } from './direction.js';
import type { Investigation } from './investigation.js';

/** 분석이 다음에 할 일 */
export type NextStep = 'investigate' | 'compare' | 'choose' | 'blueprint' | 'approve' | 'implement' | 'done';

/**
 * 멈춘 이유. user: 사용자가 그만두었다 · timeout: 답을 오래 기다렸다 · blocked: 한도·로그인·중단으로 호출이 막혔다 ·
 * unreadable: 팀원의 보고를 읽지 못했다 · no-screen: 물어볼 화면이 없다 · budget: 한도가 빠듯하다 · revisions: 고치기를 여러 번 했다
 */
export type StopReason = 'user' | 'timeout' | 'blocked' | 'unreadable' | 'no-screen' | 'budget' | 'revisions';

export interface Stopped {
  readonly reason: StopReason;
  readonly detail: string | null;
}

/** 설계·계획을 사용자가 고치게 할 수 있는 횟수 */
const MAX_REVISIONS = 3;
/** 짚은 영역이 이 수 이상이면 큰 변경이다 */
const BIG_AREAS = 3;

const STOP_NOTES: Readonly<Record<StopReason, string>> = {
  user: '그만두기로 해서 여기서 멈췄어요.',
  timeout: '답을 오래 기다렸지만 오지 않아 여기서 멈췄어요. 추천대로 자동으로 진행하지는 않아요.',
  blocked: '팀원 호출이 막혀 여기서 멈췄어요.',
  unreadable: '팀원의 보고를 읽지 못해 여기서 멈췄어요.',
  'no-screen': '물어볼 화면이 없어서 방향 비교까지만 했어요. 사용자가 고르기 전에는 설계로 가지 않아요.',
  budget: '세션 한도가 빠듯해서 여기서 멈췄어요.',
  revisions: '고칠 점을 여러 번 반영했지만 아직 맞지 않아 여기서 멈췄어요.',
};

/**
 * 분석 한 번의 진행 상태(애그리거트 루트): 조사 → 방향 비교 → 사용자가 방향 고르기 → 설계·계획 → 승인 → 구현.
 * 단계 순서를 어기면 거절하고, 다음에 할 일을 `next()`가 알려 준다. 사용자가 고르기 전에는 설계로 가지 않는다.
 */
export class AnalysisRun {
  private reach: AnalysisReach;
  private _investigation: Investigation | null = null;
  private _directions: DirectionSet | null = null;
  private _choice: DirectionChoice | null = null;
  private _blueprint: Blueprint | null = null;
  private _revisionNote: string | null = null;
  private revisions = 0;
  private approved = false;
  private implemented = false;
  private _stopped: Stopped | null = null;

  private constructor(
    readonly id: string,
    readonly request: string,
    readonly date: string,
    reach: AnalysisReach,
  ) {
    this.reach = reach;
  }

  static start(p: { id: string; request: string; reach: AnalysisReach; date: string }): AnalysisRun {
    if (p.request.trim() === '') throw new DomainError('INVALID_INPUT', '분석할 요청이 비어 있습니다.');
    return new AnalysisRun(p.id, p.request.trim(), p.date, p.reach);
  }

  get reachValue(): AnalysisReach {
    return this.reach;
  }
  get investigation(): Investigation | null {
    return this._investigation;
  }
  get directions(): DirectionSet | null {
    return this._directions;
  }
  get choice(): DirectionChoice | null {
    return this._choice;
  }
  get blueprint(): Blueprint | null {
    return this._blueprint;
  }
  /** 설계·계획을 다시 쓸 때 반영할 사용자의 고칠 점 */
  get revisionNote(): string | null {
    return this._revisionNote;
  }
  get stopped(): Stopped | null {
    return this._stopped;
  }
  get wasImplemented(): boolean {
    return this.implemented;
  }

  next(): NextStep {
    if (this._stopped !== null) return 'done';
    if (this._investigation === null) return 'investigate';
    if (!this.reach.includes('compare')) return 'done';
    if (this._directions === null) return 'compare';
    if (this._choice === null) return 'choose';
    if (!this.reach.includes('plan')) return 'done';
    if (this._blueprint === null) return 'blueprint';
    if (!this.approved) return 'approve';
    return this.implemented ? 'done' : 'implement';
  }

  recordInvestigation(investigation: Investigation): void {
    this.assertNext('investigate');
    this._investigation = investigation;
  }

  offerDirections(directions: DirectionSet): void {
    this.assertNext('compare');
    this._directions = directions;
  }

  /** 사용자가 고른 방향을 남긴다. 이어 가자고 했으면 범위를 설계·계획까지 늘린다. */
  choose(answer: DirectionAnswer): DirectionChoice {
    this.assertNext('choose');
    const choice = this._directions!.choose(answer);
    this._choice = choice;
    if (choice.goOn) this.reach = this.reach.extendedTo('plan');
    return choice;
  }

  recordBlueprint(blueprint: Blueprint): void {
    this.assertNext('blueprint');
    this._blueprint = blueprint;
    this._revisionNote = null;
  }

  /** 설계·계획을 보고 고칠 점을 말했다: 다시 쓰게 한다. 세 번을 넘으면 멈춘다. */
  reviseBlueprint(note: string): void {
    this.assertNext('approve');
    this.revisions += 1;
    if (this.revisions > MAX_REVISIONS) {
      this.stop('revisions');
      return;
    }
    this._blueprint = null;
    this._revisionNote = note.trim() === '' ? '사용자가 고쳐 달라고 했습니다.' : note.trim();
  }

  approve(): void {
    this.assertNext('approve');
    this.approved = true;
  }

  markImplemented(): void {
    this.assertNext('implement');
    this.implemented = true;
  }

  /** 멈춘다. 이미 멈췄으면 처음 이유를 그대로 둔다. */
  stop(reason: StopReason, detail: string | null = null): void {
    if (this._stopped === null) this._stopped = { reason, detail };
  }

  stopNote(): string | null {
    return this._stopped === null ? null : this._stopped.detail ?? STOP_NOTES[this._stopped.reason];
  }

  /** 사용자를 기다리던 사이 한도가 위험해졌으면 다음 단계(호출이 많이 드는 곳)로 가지 않고 멈춘다. 멈췄으면 true. */
  pauseIfTight(budget: SessionBudget): boolean {
    const next = this.next();
    if (!budget.holdsHeavyWork || next === 'investigate' || next === 'done' || next === 'implement') return false;
    this.stop('budget', budget.resetsAt === null ? null : `${STOP_NOTES.budget} 한도는 ${budget.resetsAt}쯤 풀려요.`);
    return true;
  }

  /** 설계·계획을 쓸 모델. 큰 변경(영역 셋 이상, 여러 저장소, 기능 요청)만 opus. 한도가 빠듯하면 올리지 않는다. */
  designTier(p: { routedFeature: boolean; repos: number; budget: SessionBudget }): ModelTier {
    const big = (this._investigation?.areas().length ?? 0) >= BIG_AREAS || p.repos > 1 || p.routedFeature;
    return big && !p.budget.saving ? 'opus' : 'sonnet';
  }

  private assertNext(step: NextStep): void {
    if (this.next() !== step) throw new DomainError('OUT_OF_ORDER', `분석 순서가 맞지 않습니다: 지금은 ${this.next()} 차례입니다(${step} 아님).`);
  }
}
