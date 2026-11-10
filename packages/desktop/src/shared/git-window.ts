/** 큰 레포에서 목록·diff를 한꺼번에 그리지 않도록 나눠 그리는 크기와 계산. 화면 요소가 수만 개가 되면 탭 열기가 몇 초씩 걸린다. */
export const FILE_FIRST = 200;
export const FILE_MORE = 200;
/** diff는 줄 수 기준(머리줄 포함) */
export const DIFF_FIRST_LINES = 600;
export const DIFF_MORE_LINES = 1000;

/** 지금 limit까지 보이는 목록에서 "더 보기"를 누른 뒤의 limit. 전체를 넘지 않는다. */
export function nextLimit(limit: number, total: number, step: number): number {
  return Math.min(total, limit + step);
}

/** 더 보기 단추 글: 이번에 늘어날 개수와 남은 수 */
export function moreLabel(shown: number, total: number, step: number): string {
  const left = Math.max(0, total - shown);
  return `Show ${Math.min(step, left)} more (${left} left)`;
}
