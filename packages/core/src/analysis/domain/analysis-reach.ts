import type { SessionBudget } from '../../orchestration/domain/session-budget.js';

/** 분석을 어디까지 갈지: 조사만 · 방향 비교까지 · 설계와 단계별 계획까지 */
export type ReachValue = 'investigate' | 'compare' | 'plan';

const ORDER: readonly ReachValue[] = ['investigate', 'compare', 'plan'];

/** 분석·조사·비교를 청한 말. 고치라고만 한 말에는 이 낱말이 없다. */
const ANALYSIS_WORDS = /(분석|조사|원인|왜\s|왜\?|왜$|비교|방향|대안|어떻게\s*(고치|해결|풀|처리|하면|바꾸|접근)|어떤\s*방식|방법|검토|위험|영향|점검|찾아\s?봐|짚어)/;
const PLAN_WORDS = /(계획|설계|분석\s*(하고|한\s*뒤|후|해서).*(고쳐|수정|구현|해결)|바탕으로\s*(고쳐|수정|구현))/;
const COMPARE_WORDS = /(어떻게|방법|방향|비교|어떤\s*방식|해결책|대안|좋을까)/;

const reachOf = (value: unknown): ReachValue | null => ORDER.find((v) => v === value) ?? null;

/**
 * 분석 흐름을 어디까지 갈지. 값은 바뀌지 않고, 늘리거나 줄이는 메서드는 새 값을 돌려준다.
 */
export class AnalysisReach {
  private constructor(readonly value: ReachValue) {}

  /** 분석 흐름을 탈 요청인가. 분석·조사·비교 낱말이 있는 말만 탄다. 고치라고만 한 말은 지금 길(작업)로 간다. */
  static requested(input: string): boolean {
    return ANALYSIS_WORDS.test(input);
  }

  /** routed: 라우터가 낸 값(없거나 이상하면 요청 글에서 어림한다) */
  static of(routed: unknown, input: string): AnalysisReach {
    return new AnalysisReach(reachOf(routed) ?? AnalysisReach.guess(input));
  }

  private static guess(input: string): ReachValue {
    if (PLAN_WORDS.test(input)) return 'plan';
    return COMPARE_WORDS.test(input) ? 'compare' : 'investigate';
  }

  includes(stage: ReachValue): boolean {
    return ORDER.indexOf(stage) <= ORDER.indexOf(this.value);
  }

  /** 한도가 위험하면 조사까지만 */
  limitedBy(budget: SessionBudget): AnalysisReach {
    return budget.holdsHeavyWork ? new AnalysisReach('investigate') : this;
  }

  /** 사용자가 더 가 달라고 했을 때. 줄어들지는 않는다. */
  extendedTo(stage: ReachValue): AnalysisReach {
    return this.includes(stage) ? this : new AnalysisReach(stage);
  }

  equals(other: AnalysisReach): boolean {
    return this.value === other.value;
  }
}
