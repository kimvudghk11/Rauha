/** 팀원 역할. 팀장(lead)은 파일을 쓰지 않고 배분만 한다. */
export type TeamRole =
  | 'lead'
  | 'planner'
  | 'architect'
  | 'tester'
  | 'implementer'
  | 'reviewer'
  | 'debugger'
  | 'infra'
  | 'writer';

/**
 * 모델 등급(낮음 → 높음). haiku 는 쓰지 않는다(2026-11-17: 추측·덜 확인한 답이 많아 품질이 낮았다).
 * sonnet = 기본 일, opus = 승격·판단, fable = 가장 어려운 일(설계 자문·민감 리뷰·마지막 시도).
 */
export type ModelTier = 'sonnet' | 'opus' | 'fable';

export const MODEL_ID: Readonly<Record<ModelTier, string>> = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-2',
};

/** 예전 설정 파일에 남은 등급 이름을 지금 등급으로. haiku 는 가장 낮은 등급(sonnet)이 된다. 모르는 값은 null. */
export function tierFromSaved(value: unknown): ModelTier | null {
  if (value === 'haiku') return 'sonnet';
  return value === 'sonnet' || value === 'opus' || value === 'fable' ? value : null;
}

/** 팀장이 다음에 누구를 어떤 모델로 부를지. */
export interface Assignment {
  readonly role: TeamRole;
  readonly tier: ModelTier;
}
