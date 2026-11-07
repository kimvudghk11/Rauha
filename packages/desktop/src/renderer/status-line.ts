import type { BoardView } from '../shared/ipc.js';

/** 아래 상태 줄의 작업 수. 돈은 쓰지 않는다. */
export function statusText(board: BoardView): string {
  return `진행 ${board.running} · 기다림 ${board.waiting} · 대기 ${board.queued}`;
}
