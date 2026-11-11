import type { ModelNames } from './model-names.js';
import type { ModelTier } from './team.js';

/** 대체 시도는 최대 2번(같은 등급의 이전 버전, 한 단계 낮은 등급). 더 돌지 않는다. */
export const MAX_FALLBACKS = 2;

/** 알려진 모델 계보(최신 → 이전). 여기 없는 ID는 이전 버전을 모른다고 보고 지어내지 않는다. */
const LINEAGES: readonly (readonly string[])[] = [
  ['claude-fable-5-2', 'claude-fable-5-1', 'claude-fable-5'],
  ['claude-opus-5-5', 'claude-opus-5'],
  ['claude-sonnet-5-5', 'claude-sonnet-5'],
  ['claude-haiku-5-5'],
];

const LOWER: Readonly<Record<ModelTier, ModelTier | null>> = { opus: 'sonnet', sonnet: 'haiku', haiku: null };

/** 모델 자체가 없거나 이 계정이 못 쓴다는 뜻의 메시지 조각들 */
const MODEL_WORDS = /\bmodels?\b|model_/i;
const UNUSABLE = /not[ _]found|does(?: not|n't) exist|may not exist|no access|not have access|don't have access|do not have access|not available|unavailable|not supported|invalid model|unknown model|not allowed|permission/i;

export interface ModelStep {
  readonly tier: ModelTier;
  readonly model: string;
}

const short = (id: string): string => id.replace(/^claude-/, '');

/**
 * 모델 오류로 팀원 호출이 실패했을 때의 대체 순서를 쥔 값: 같은 등급의 이전 버전 → 한 단계 낮은 등급, 최대 2번.
 * 호출 한 번(한 팀원)마다 하나를 만든다.
 */
export class ModelFallback {
  private taken = 0;

  private constructor(
    private readonly from: string,
    private readonly steps: readonly ModelStep[],
  ) {}

  static start(names: ModelNames, tier: ModelTier): ModelFallback {
    const current = names.idOf(tier);
    const candidates: ModelStep[] = [];
    const lineage = LINEAGES.find((l) => l.includes(current));
    const previous = lineage?.[lineage.indexOf(current) + 1];
    if (previous !== undefined) candidates.push({ tier, model: previous });
    const lower = LOWER[tier];
    if (lower !== null) candidates.push({ tier: lower, model: names.idOf(lower) });
    const seen = new Set<string>([current]);
    const steps: ModelStep[] = [];
    for (const step of candidates) {
      if (seen.has(step.model)) continue;
      seen.add(step.model);
      steps.push(step);
    }
    return new ModelFallback(current, steps.slice(0, MAX_FALLBACKS));
  }

  /** 모델을 쓸 수 없다는 오류 메시지인지. 사용 한도·로그인·시간 초과 같은 다른 오류는 아니다. */
  static isModelError(message: string | null): boolean {
    if (message === null) return false;
    return /model_not_found/i.test(message) || (MODEL_WORDS.test(message) && UNUSABLE.test(message));
  }

  /** 모델 오류(계정 문제로 막힌 것이 아닌)면 다음 대체 모델. 더 시도할 것이 없으면 null. */
  next(error: string | null, accountBlocked: boolean): ModelStep | null {
    if (accountBlocked || !ModelFallback.isModelError(error)) return null;
    const step = this.steps[this.taken] ?? null;
    if (step !== null) this.taken += 1;
    return step;
  }

  /** 대체해서 실행했고 마지막 호출이 모델 오류로 끝나지 않았다면 사용자에게 보일 한 줄. 아니면 null. */
  notice(finalError: string | null = null): string | null {
    if (this.taken === 0 || ModelFallback.isModelError(finalError)) return null;
    return `${short(this.from)} 모델을 쓸 수 없어서 대신 ${short(this.steps[this.taken - 1]!.model)} 모델로 실행했어요.`;
  }
}
