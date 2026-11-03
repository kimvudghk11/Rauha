/** 후보 목록에서 지금 보여 줄 칸. above·below: 창 밖에 남은 후보 수 */
export interface MenuWindow {
  readonly start: number;
  readonly end: number;
  readonly above: number;
  readonly below: number;
}

/**
 * 후보가 max개를 넘으면 고른 후보가 늘 보이도록 max개만 보여 준다(Kiro·Claude Code처럼).
 * 목록이 길면 입력창이 화면 위로 밀려 올라가 무엇을 치고 있는지 안 보이게 된다.
 */
export function menuWindow(count: number, selected: number, max: number): MenuWindow {
  if (count <= max) return { start: 0, end: count, above: 0, below: 0 };
  const start = Math.min(Math.max(0, selected - max + 1), count - max);
  return { start, end: start + max, above: start, below: count - start - max };
}
