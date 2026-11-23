/** 창 너비 4단계(시안 responsive.html): 아주 넓음 · 보통 · 좁음 · 아주 좁음. 경계는 창을 끌어 보며 맞춘다. */
export type Tier = 'xl' | 'm' | 's' | 'xs';
/** 사용자가 고른 채팅 배치: A 나란히, B 위아래, C 에이전트 창(왼쪽 목록 + 가운데 고른 것) */
export type Layout = 'A' | 'B' | 'C';
/** 실제로 그리는 배치. xl 2열 방, side 나란히, rows 위아래(방은 가로로 넘김), xs 메인만 + 맨 위 띠, agents 왼쪽 에이전트 목록 + 가운데 */
export type Mode = 'xl' | 'side' | 'rows' | 'xs' | 'agents';

export const TIER_MIN = { xl: 1700, m: 1100, s: 720 } as const;

export function tierOf(width: number): Tier {
  if (width >= TIER_MIN.xl) return 'xl';
  if (width >= TIER_MIN.m) return 'm';
  if (width >= TIER_MIN.s) return 's';
  return 'xs';
}

/** 좁음은 A를 골라도 B로 바뀌고, 아주 좁음은 메인만, 아주 넓음은 A면 방을 2열로 깐다. */
export function modeOf(tier: Tier, layout: Layout): Mode {
  if (tier === 'xs') return 'xs';
  // 에이전트 창은 좁음(720px~)에서도 목록을 좁혀 그대로 둔다
  if (layout === 'C') return 'agents';
  if (tier === 's') return 'rows';
  if (layout === 'B') return 'rows';
  return tier === 'xl' ? 'xl' : 'side';
}
