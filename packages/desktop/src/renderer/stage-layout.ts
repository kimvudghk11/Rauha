/**
 * 한 줄에 선 캐릭터들의 왼쪽 x(칸 단위)를 구한다. 칸 수가 모자라도 서로 겹치지 않도록 필요한 칸 수까지 늘려서 돌려준다.
 * widths는 캐릭터 그림의 너비들이다.
 */
export function layoutRow(cols: number, widths: readonly number[]): { readonly cols: number; readonly xs: readonly number[] } {
  const n = widths.length;
  // 중심 간격(total/(n+1))이 가장 넓은 그림보다 넓어야 이웃끼리 겹치지 않는다
  const need = (Math.max(0, ...widths) + 2) * (n + 1);
  const total = Math.max(Number.isFinite(cols) ? cols : 0, need);
  const gap = total / (n + 1);
  return { cols: total, xs: widths.map((w, i) => Math.round(gap * (i + 1) - w / 2)) };
}
