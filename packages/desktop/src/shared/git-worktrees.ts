/** `git worktree list --porcelain` 한 항목 */
export interface WorktreeRow {
  /** 폴더 경로 */
  readonly path: string;
  /** 체크아웃한 브랜치. 분리된 HEAD면 null */
  readonly branch: string | null;
  readonly head: string;
  /** 처음 만든 메인 작업 폴더 */
  readonly main: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

/** porcelain 출력(빈 줄로 항목이 나뉜다)을 읽는다. 첫 항목이 메인 작업 폴더다. */
export function parseWorktrees(text: string): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let path = '';
    let branch: string | null = null;
    let head = '';
    let locked = false;
    let prunable = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) path = line.slice(9);
      else if (line.startsWith('HEAD ')) head = line.slice(5, 12);
      else if (line.startsWith('branch ')) branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'locked' || line.startsWith('locked ')) locked = true;
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true;
    }
    if (path !== '') rows.push({ path, branch, head, main: rows.length === 0, locked, prunable });
  }
  return rows;
}

/** 화면용: 어떤 폴더인지 알아보기 쉬운 이름(경로 마지막 칸) */
export function worktreeName(path: string): string {
  const parts = path.split(String.fromCharCode(92)).join('/').replace(/[/]+$/, '').split('/');
  return parts[parts.length - 1] ?? path;
}

/** 화면에 보내는 작업 트리 한 줄(변경 수·마지막 커밋 포함) */
export interface WorktreeView extends WorktreeRow {
  readonly changed: number;
  readonly author: string;
  readonly at: number;
  readonly subject: string;
}

/** 연결된 worktree 폴더의 `.git` 파일("gitdir: 경로")이 가리키는 곳. 그런 모양이 아니면 null. */
export function gitdirOf(dotGitFile: string): string | null {
  const first = dotGitFile.split(/\r?\n/)[0] ?? '';
  const m = /^gitdir:[ \t]*(.+?)[ \t]*$/.exec(first);
  return m?.[1] ?? null;
}
