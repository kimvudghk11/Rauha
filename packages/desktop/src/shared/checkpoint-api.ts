import type { CheckpointPlace, FileChange, RevertAction, Totals } from './checkpoint.js';
import type { HunkState } from './checkpoint-hunk.js';
import type { DiffView } from './git-api.js';

/** 끝난 작업의 변경 보기(화면용) */
export interface ChangesView {
  readonly jobId: string;
  readonly files: readonly FileChange[];
  readonly totals: Totals;
  readonly place: CheckpointPlace;
  readonly workBranch: string | null;
  /** 파일 되돌리기를 할 수 없는 이유(할 수 있으면 null) */
  readonly revertBlock: string | null;
  /** 브랜치 버리기를 할 수 없는 이유(할 수 있으면 null) */
  readonly discardBlock: string | null;
  /** 커밋 안 한 비밀 파일 수(내용은 보이지도 건드리지도 않는다) */
  readonly hiddenCount: number;
  /** 작업 시작 때 이미 커밋 안 한 변경이 있던 파일 수 */
  readonly startDirty: number;
  /** 가장 최근 되돌리기 백업(Undo the undo 용) */
  readonly backup: { readonly id: string; readonly files: number; readonly createdAt: string } | null;
  /** 파일별 지금 상태(pending: 작업이 바꾼 그대로, already: 이미 되돌려짐, conflict: 작업 뒤에 바뀜). 계산하지 않았으면 빈 객체 */
  readonly states: Readonly<Record<string, RevertAction>>;
}

/** 파일 하나의 diff + hunk 별 내용 해시와 되돌리기 상태 */
export interface CheckpointDiff extends DiffView {
  readonly path: string;
  /** hunks 와 같은 순서의 내용 해시(번호가 아니라 이것으로 hunk 를 가리킨다) */
  readonly hunkIds: readonly string[];
  /** hunks 와 같은 순서. 이 파일을 hunk 단위로 되돌릴 수 없으면 빈 배열(새 파일·지운 파일·바이너리·너무 많은 hunk·UTF-8 아님) */
  readonly hunkStates: readonly HunkState[];
}

export interface RevertPreview {
  readonly title: string;
  readonly body: string;
  readonly okLabel: string;
  /** 실제로 바뀔 파일 수(0 이면 확인 창 없이 알리기만 한다) */
  readonly files: number;
  readonly conflicts: readonly string[];
}

export interface CheckpointDone {
  readonly message: string;
  readonly reverted: number;
  readonly conflicts: readonly string[];
  /** 되돌리기 전에 만든 백업이 있으면 그 id */
  readonly backupId: string | null;
}

export interface CheckpointCalls {
  changes: [{ jobId: string }, ChangesView | null];
  diff: [{ jobId: string; path: string }, CheckpointDiff];
  /** hunk 는 번호가 아니라 diff 에서 받은 내용 해시(hunkIds)로 가리킨다 */
  previewHunk: [{ jobId: string; path: string; hunk: string }, RevertPreview];
  revertHunk: [{ jobId: string; path: string; hunk: string }, CheckpointDone];
  /** paths 가 없으면 전체 */
  preview: [{ jobId: string; paths?: readonly string[] }, RevertPreview];
  revert: [{ jobId: string; paths?: readonly string[] }, CheckpointDone];
  undoRevert: [{ jobId: string }, { readonly message: string }];
  discardBranch: [{ jobId: string }, { readonly message: string }];
}

export type CheckpointFn = keyof CheckpointCalls;
export const CHECKPOINT_FUNCTIONS = ['changes', 'diff', 'previewHunk', 'revertHunk', 'preview', 'revert', 'undoRevert', 'discardBranch'] as const satisfies readonly CheckpointFn[];

export type CheckpointApi = { readonly [K in CheckpointFn]: (arg: CheckpointCalls[K][0]) => Promise<CheckpointCalls[K][1]> };

export type CheckpointReply = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly error: string };

export const CHECKPOINT_IPC = { call: 'checkpoint:call' } as const;
