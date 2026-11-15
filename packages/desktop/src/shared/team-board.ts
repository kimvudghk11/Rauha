/** 팀 목록이 보는 작업 한 줄(태스크 묶음 thread 가 있으면 이어서 물은 차례) */
export interface BoardTask {
  readonly id: string;
  readonly queuedAt: string;
  readonly thread: string | null;
  /** 아직 끝나지 않은 일(창을 다시 열어도 도는 일은 목록에 남는다) */
  readonly live?: boolean;
}

export type BoardSlot = { readonly kind: 'task'; readonly id: string; readonly n: number } | { readonly kind: 'idle'; readonly n: number };

/** 언제나 보이는 팀 수 */
export const TEAM_SLOTS = 5;

/**
 * 오른쪽 팀 목록: 이번에 앱을 켠 뒤(since) 맡긴 태스크를 맡긴 순서대로 위 칸부터,
 * 5칸보다 적으면 남은 칸은 기다리는 팀. 이어서 물은 차례는 그 태스크 팀에 묶여 새 칸을 만들지 않는다.
 */
export function teamBoard(tasks: readonly BoardTask[], since: string): readonly BoardSlot[] {
  const from = Date.parse(since);
  const mine = tasks
    .filter((t) => t.thread === null && (t.live === true || Date.parse(t.queuedAt) >= from))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .map((t, i): BoardSlot => ({ kind: 'task', id: t.id, n: i + 1 }));
  const idle = Array.from({ length: Math.max(0, TEAM_SLOTS - mine.length) }, (_, i): BoardSlot => ({ kind: 'idle', n: mine.length + i + 1 }));
  return [...mine, ...idle];
}
