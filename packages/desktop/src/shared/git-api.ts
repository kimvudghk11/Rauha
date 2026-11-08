import type { FileChangeView } from './git-changes.js';
import type { Hunk, PatchMode, Selection } from './git-diff.js';
import type { ConventionsView } from './git-conventions-view.js';
import type { BranchView, LogRow } from './git-lists.js';

/** git 탭이 main에 부를 수 있는 함수 이름. 이 목록에 없는 이름은 main이 받지 않는다. */
export const GIT_FUNCTIONS = [
  'overview', 'diff', 'stage', 'unstage', 'stageSelection', 'discard', 'commit',
  'branches', 'createBranch', 'switchBranch', 'merge', 'deleteBranch', 'fetch', 'pull', 'push',
  'conventions', 'undoCommit', 'log', 'commitDiff', 'mergeState', 'resolveSide', 'readConflict', 'writeConflict', 'markResolved', 'finishMerge', 'abortMerge', 'openPr',
] as const;
export type GitFn = (typeof GIT_FUNCTIONS)[number];

export interface Overview {
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly files: readonly FileChangeView[];
  /** 머지가 끝나지 않은 채 멈춰 있다(MERGE_HEAD가 있다) */
  readonly merging: boolean;
  readonly hasRemote: boolean;
  /** 마지막으로 원격을 확인(fetch·pull)한 시각(초 단위 UNIX 시각). 한 번도 안 했으면 null */
  readonly fetchedAt: number | null;
  /** 스테이지한 변경의 추가·삭제 줄 수 */
  readonly staged: { readonly added: number; readonly removed: number } | null;
}

export interface DiffView {
  readonly binary: boolean;
  readonly hunks: readonly Hunk[];
}

export interface FileDiffView extends DiffView {
  readonly path: string;
}

export interface Done {
  /** 사용자에게 그대로 보이는 한 줄 결과 */
  readonly message: string;
  /** 머지·pull이 충돌로 멈췄다 */
  readonly conflicts?: boolean;
  /** fetch·pull이 알려 주는 받은(받을 수 있는) 새 커밋 수 */
  readonly received?: number;
}

export interface ConfirmArg {
  /** 보호 브랜치 확인 창에서 사용자가 "그래도 진행"을 눌렀다 */
  readonly confirmed?: boolean;
}

/** 함수 이름 → [인자, 돌려주는 값] */
export interface GitCalls {
  overview: [void, Overview];
  diff: [{ path: string; side: 'staged' | 'unstaged' }, DiffView];
  stage: [{ paths: readonly string[] }, Done];
  unstage: [{ paths: readonly string[] }, Done];
  stageSelection: [{ path: string; selection: Selection; mode: PatchMode }, Done];
  discard: [{ paths: readonly string[] }, Done];
  commit: [{ subject: string; body: string }, Done];
  branches: [void, readonly BranchView[]];
  createBranch: [{ name: string; base?: string; checkout?: boolean }, Done];
  switchBranch: [{ name: string }, Done];
  merge: [{ name: string } & ConfirmArg, Done];
  deleteBranch: [{ name: string }, Done];
  fetch: [void, Done];
  pull: [{ mode: 'ff' | 'merge' }, Done];
  push: [ConfirmArg, Done];
  conventions: [void, ConventionsView];
  undoCommit: [void, Done];
  log: [{ ref?: string }, readonly LogRow[]];
  commitDiff: [{ hash: string }, readonly FileDiffView[]];
  mergeState: [void, { merging: boolean; conflicts: readonly string[] }];
  resolveSide: [{ path: string; side: 'ours' | 'theirs' }, Done];
  readConflict: [{ path: string }, { text: string }];
  writeConflict: [{ path: string; text: string }, Done];
  markResolved: [{ path: string }, Done];
  finishMerge: [void, Done];
  abortMerge: [void, Done];
  openPr: [{ base: string }, { url: string }];
}

export type GitArg<K extends GitFn> = GitCalls[K][0];
export type GitData<K extends GitFn> = GitCalls[K][1];

export type GitResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string; readonly code: GitErrorCode };
/** PROTECTED: 보호 브랜치라 확인이 필요하다. BLOCKED: 커밋 안 한 변경 등이 막았다. */
export type GitErrorCode = 'PROTECTED' | 'BLOCKED' | 'INVALID' | 'UNKNOWN_REPO' | 'FAILED';

export type GitApi = { readonly [K in GitFn]: (root: string, arg: GitArg<K>) => Promise<GitResult<GitData<K>>> };

/** 보호 브랜치로 push·머지할 때 main이 돌려주는 안내. 화면은 이 문구로 확인 창을 띄운다. */
export const protectedMessage = (branch: string): string => `${branch}는 보호 브랜치예요.`;
