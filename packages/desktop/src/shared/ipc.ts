import type { JobBoard, JobStatus } from '@rauha/core/jobs';

/** main ↔ 화면 IPC 채널. 화면은 이 채널로만 main과 이야기한다. */
export const IPC = {
  submit: 'job:submit',
  stop: 'job:stop',
  /** main → 화면: 작업판이 바뀔 때마다 보낸다 */
  board: 'job:board',
  /** 화면 → main: 지금 작업판을 한 번 달라(화면을 새로 열 때) */
  boardNow: 'job:board-now',
} as const;

export interface JobView {
  readonly id: string;
  readonly request: string;
  readonly status: JobStatus;
  readonly stopReason: string | null;
}

export interface BoardView {
  readonly jobs: readonly JobView[];
  readonly running: number;
  readonly waiting: number;
  readonly queued: number;
  readonly limit: number;
}

/** preload가 화면에 열어 주는 API(window.rauha) */
export interface RauhaApi {
  submit(text: string): Promise<JobView | null>;
  stop(id: string): void;
  onBoard(listener: (board: BoardView) => void): void;
  boardNow(): Promise<BoardView>;
}

export function boardView(board: JobBoard): BoardView {
  return {
    jobs: board.jobs.map((j) => ({ id: j.id, request: j.request, status: j.status, stopReason: j.stopReason })),
    ...board.counts(),
    limit: board.limit,
  };
}
