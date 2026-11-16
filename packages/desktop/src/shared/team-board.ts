/** 팀 목록이 보는 태스크 한 줄(태스크 묶음 thread 가 있으면 이어서 물은 차례라 칸을 따로 갖지 않는다) */
export interface BoardTask {
  readonly id: string;
  readonly queuedAt: string;
  readonly thread: string | null;
  /** 아직 끝나지 않은 일(창을 다시 열어도 도는 일은 목록에 남는다) */
  readonly live?: boolean;
  /** 마지막 차례가 끝난 때(도는 중이면 null). 이때부터 그 팀은 쉰다 */
  readonly endedAt?: string | null;
  /** 이어 말한 마지막 차례를 맡긴 때(없으면 queuedAt). 이때 쉬는 팀 칸을 맡는다 */
  readonly activeAt?: string;
}

export type BoardSlot = { readonly kind: 'task'; readonly id: string; readonly n: number } | { readonly kind: 'idle'; readonly n: number };

/** 언제나 보이는 팀 수 */
export const TEAM_SLOTS = 5;

/**
 * 오른쪽 팀 목록: 팀 1~5 가 일꾼이다. 일을 맡기면 그때 쉬는 팀 중 맨 위 팀이 맡는다(1팀이 쉬면 1팀).
 * 끝난 팀은 다음 일이 올 때까지 마지막 일을 보이며 자리를 지키고, 다른 팀이 끝나도 도는 일의 자리는 옮기지 않는다.
 * 5팀이 모두 바쁘면 아래에 이어 붙는다. 이어서 물은 차례는 그 태스크 팀에 묶인다.
 */
export function teamBoard(tasks: readonly BoardTask[], since: string): readonly BoardSlot[] {
  const from = Date.parse(since);
  const startOf = (t: BoardTask): number => Date.parse(t.activeAt ?? t.queuedAt);
  const mine = tasks.filter((t) => t.thread === null && (t.live === true || Date.parse(t.queuedAt) >= from)).sort((a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id));
  // 칸마다 지금 맡은 태스크(맡긴 때 순서로 돌려 본다)
  const slots: BoardTask[] = [];
  const freeAt = (t: BoardTask, when: number): boolean => t.live !== true && t.endedAt != null && Date.parse(t.endedAt) <= when;
  for (const task of mine) {
    const when = startOf(task);
    const free = slots.findIndex((s) => freeAt(s, when));
    if (free >= 0) slots[free] = task;
    else slots.push(task);
  }
  const taken = slots.map((t, i): BoardSlot => ({ kind: 'task', id: t.id, n: i + 1 }));
  const idle = Array.from({ length: Math.max(0, TEAM_SLOTS - taken.length) }, (_, i): BoardSlot => ({ kind: 'idle', n: taken.length + i + 1 }));
  return [...taken, ...idle];
}
