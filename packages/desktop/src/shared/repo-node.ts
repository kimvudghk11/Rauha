import type { FolderKind } from './folder-kind.js';
import type { RepoStatus } from './git-status.js';

/** 앞섬·뒤처짐을 "↑2 ↓1"로. 원격이 없으면 "원격 없음". */
export function syncText(ahead: number | null, behind: number | null): string {
  if (ahead === null || behind === null) return '원격 없음';
  if (ahead === 0 && behind === 0) return '원격과 같음';
  return [ahead > 0 ? `↑${ahead}` : '', behind > 0 ? `↓${behind}` : ''].filter((x) => x !== '').join(' ');
}

const KIND_LABEL: Readonly<Record<FolderKind, string>> = { repo: '레포', docs: '문서 폴더', other: '폴더' };

export interface RepoNodeInput {
  readonly kind: FolderKind;
  readonly status: RepoStatus | null;
  readonly working: number;
  readonly worktrees: number;
}

export interface RepoNodeText {
  readonly kind: string;
  readonly branch: string;
  readonly sync: string;
  readonly changed: string;
  /** 지금 팀이 일하는 중이면 그 글(없으면 null) */
  readonly working: string | null;
}

/** 탐색기의 레포 노드 줄에 보일 글. git 상태를 못 읽었으면 "모름"이라고 쓴다. */
export function repoNodeText(row: RepoNodeInput): RepoNodeText {
  const working = row.worktrees > 0 ? `worktree 작업 중 ${row.worktrees}` : row.working > 0 ? `작업 중 ${row.working}` : null;
  if (row.kind !== 'repo') return { kind: KIND_LABEL[row.kind], branch: '', sync: '', changed: '', working };
  const s = row.status;
  if (s === null) return { kind: KIND_LABEL.repo, branch: '모름', sync: '모름', changed: '모름', working };
  return { kind: KIND_LABEL.repo, branch: s.branch ?? '(분리된 HEAD)', sync: syncText(s.ahead, s.behind), changed: s.changed > 0 ? `변경 ${s.changed}` : '깨끗함', working };
}
