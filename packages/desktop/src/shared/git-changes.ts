/** 바뀐 파일 한 개(`git status --porcelain=v2 -z`의 한 항목). 화면으로 보낼 때는 FileChangeView로 바꾼다. */
export type ChangeKind = 'ordinary' | 'rename' | 'unmerged' | 'untracked';

const SECRET_NAME = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.key|credentials(\.json)?|\.npmrc|\.netrc)$/i;

export class FileChange {
  private constructor(
    readonly path: string,
    readonly oldPath: string | null,
    /** 스테이지 쪽 상태 글자(없으면 '.') */
    readonly index: string,
    /** 작업 폴더 쪽 상태 글자(없으면 '.') */
    readonly worktree: string,
    readonly kind: ChangeKind,
  ) {}

  static of(path: string, oldPath: string | null, index: string, worktree: string, kind: ChangeKind): FileChange {
    return new FileChange(path, oldPath, index, worktree, kind);
  }

  isUntracked(): boolean {
    return this.kind === 'untracked';
  }
  isConflict(): boolean {
    return this.kind === 'unmerged';
  }
  isStaged(): boolean {
    return !this.isConflict() && !this.isUntracked() && this.index !== '.';
  }
  hasUnstaged(): boolean {
    return this.isUntracked() || (!this.isConflict() && this.worktree !== '.');
  }
  /** 비밀 파일 같아 보이면 기본으로 스테이지 대상에서 뺀다 */
  looksSecret(): boolean {
    return SECRET_NAME.test(this.path);
  }
  /** 한 글자 표시: M 수정, A 추가, D 삭제, R 이름 바꿈, ? 추적 안 함, ! 충돌 */
  label(): string {
    if (this.isConflict()) return '!';
    if (this.isUntracked()) return '?';
    const c = this.index !== '.' ? this.index : this.worktree;
    return c === 'C' || c === 'T' ? 'M' : c;
  }
}

/** 파일 한 개를 화면으로 보내는 모양(클래스는 IPC를 건너지 못한다) */
export interface FileChangeView {
  readonly path: string;
  readonly oldPath: string | null;
  readonly label: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflict: boolean;
  readonly secret: boolean;
}

export class ChangeSet {
  private constructor(
    readonly branch: string | null,
    readonly upstream: string | null,
    readonly ahead: number | null,
    readonly behind: number | null,
    readonly files: readonly FileChange[],
  ) {}

  /** `git status --porcelain=v2 -z --branch` 출력을 읽는다. */
  static parse(text: string): ChangeSet {
    const rec = text.split('\0');
    let branch: string | null = null;
    let upstream: string | null = null;
    let ahead: number | null = null;
    let behind: number | null = null;
    const files: FileChange[] = [];
    for (let i = 0; i < rec.length; i++) {
      const r = rec[i]!;
      if (r === '') continue;
      if (r.startsWith('# branch.head ')) {
        const h = r.slice(14);
        branch = h === '(detached)' ? null : h;
      } else if (r.startsWith('# branch.upstream ')) upstream = r.slice(18);
      else if (r.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(r);
        if (m !== null) [ahead, behind] = [Number(m[1]), Number(m[2])];
      } else if (r.startsWith('1 ')) {
        const f = r.split(' ');
        files.push(FileChange.of(f.slice(8).join(' '), null, f[1]![0]!, f[1]![1]!, 'ordinary'));
      } else if (r.startsWith('2 ')) {
        const f = r.split(' ');
        files.push(FileChange.of(f.slice(9).join(' '), rec[++i] ?? null, f[1]![0]!, f[1]![1]!, 'rename'));
      } else if (r.startsWith('u ')) {
        const f = r.split(' ');
        files.push(FileChange.of(f.slice(10).join(' '), null, f[1]![0]!, f[1]![1]!, 'unmerged'));
      } else if (r.startsWith('? ')) files.push(FileChange.of(r.slice(2), null, '.', '?', 'untracked'));
    }
    return new ChangeSet(branch, upstream, upstream === null ? null : ahead, upstream === null ? null : behind, files);
  }

  conflicts(): readonly FileChange[] {
    return this.files.filter((f) => f.isConflict());
  }
  hasConflicts(): boolean {
    return this.conflicts().length > 0;
  }
  views(): FileChangeView[] {
    return this.files.map((f) => ({ path: f.path, oldPath: f.oldPath, label: f.label(), staged: f.isStaged(), unstaged: f.hasUnstaged(), untracked: f.isUntracked(), conflict: f.isConflict(), secret: f.looksSecret() }));
  }
}
