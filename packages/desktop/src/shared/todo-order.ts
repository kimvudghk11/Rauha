/**
 * 끌어서 놓기의 순서 계산(순수 함수). 카드는 한 줄 배열에 칸 구분 없이 들어 있고, 한 칸 안의 순서는 그 배열에서의 상대 순서다.
 * "어느 카드 앞에 놓나(beforeId)"로 자리를 말하므로 검색·필터로 일부만 보이는 중에도 맞게 들어간다.
 */

export interface Slot {
  readonly id: string;
  readonly columnId: string;
}

/** id 카드를 columnId 칸의 beforeId 카드 앞(null이면 그 칸 맨 끝)에 놓은 새 배열. 없는 카드면 같은 배열을 돌려준다. */
export function place<T extends Slot>(items: readonly T[], id: string, columnId: string, beforeId: string | null, withColumn: (item: T) => T): readonly T[] {
  const found = items.find((i) => i.id === id);
  if (found === undefined) return items;
  const moved = withColumn(found);
  const rest = items.filter((i) => i.id !== id);
  const before = beforeId === null || beforeId === id ? -1 : rest.findIndex((i) => i.id === beforeId && i.columnId === columnId);
  if (beforeId === id) {
    // 자기 앞에 놓는 것은 제자리
    const at = items.indexOf(found);
    return items.map((i, k) => (k === at ? moved : i));
  }
  if (before >= 0) return [...rest.slice(0, before), moved, ...rest.slice(before)];
  let last = -1;
  rest.forEach((i, k) => {
    if (i.columnId === columnId) last = k;
  });
  const at = last === -1 ? rest.length : last + 1;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** id 항목을 beforeId 항목 앞(null이면 맨 끝)으로 옮긴 새 배열(칸 순서용). 없는 id면 같은 배열 */
export function reorder<T extends { readonly id: string }>(items: readonly T[], id: string, beforeId: string | null): readonly T[] {
  const found = items.find((i) => i.id === id);
  if (found === undefined) return items;
  const rest = items.filter((i) => i.id !== id);
  const before = beforeId === null ? -1 : rest.findIndex((i) => i.id === beforeId);
  const at = before === -1 ? rest.length : before;
  return [...rest.slice(0, at), found, ...rest.slice(at)];
}

export interface Rect {
  readonly id: string;
  /** 세로 목록이면 top, 가로 목록이면 left */
  readonly start: number;
  /** 세로 목록이면 height, 가로 목록이면 width */
  readonly size: number;
}

/** 포인터 위치(pos)가 어느 항목 가운데보다 앞이면 그 항목 id, 모두 뒤면 null. 끌고 있는 항목(skipId)은 건너뛴다. */
export function beforeIdAt(rects: readonly Rect[], pos: number, skipId?: string): string | null {
  for (const r of rects) {
    if (r.id === skipId) continue;
    if (pos < r.start + r.size / 2) return r.id;
  }
  return null;
}
