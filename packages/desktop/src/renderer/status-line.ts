import type { BoardView } from '../shared/ipc.js';

/** 아래 상태 줄의 작업 수. 돈은 쓰지 않는다. */
export function statusText(board: BoardView): string {
  return `Running ${board.running} · Waiting ${board.waiting} · Queued ${board.queued}`;
}
