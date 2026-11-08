/** 탐색기에 붙이는 한 글자 상태: M 수정, A 추가, D 삭제, R 이름 바뀜, U 추적 안 함(새 파일), ! 충돌 */
export type ChangeCode = 'M' | 'A' | 'D' | 'R' | 'U' | '!';

export interface ChangedFile {
  /** 레포 루트 기준 경로. 추적 안 하는 폴더는 끝에 / 가 붙는다. */
  readonly path: string;
  readonly code: ChangeCode;
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** 스테이지 쪽이 있으면 그 글자, 없으면 작업 폴더 쪽 글자를 한 글자 상태로 바꾼다 */
function codeOf(x: string, y: string): ChangeCode | null {
  if (CONFLICT.has(`${x}${y}`)) return '!';
  if (x === '?' && y === '?') return 'U';
  const c = x !== ' ' ? x : y;
  switch (c) {
    case 'M':
    case 'T':
      return 'M';
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
    case 'C':
      return 'R';
    default:
      return null;
  }
}

/** `git status --porcelain=v1 -z` 출력을 읽는다. 이름이 바뀐 항목은 뒤따르는 옛 이름 칸을 건너뛴다. */
export function parseStatusZ(output: string): ChangedFile[] {
  const parts = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    if (entry.length < 4 || entry.charAt(2) !== ' ') continue;
    const x = entry.charAt(0);
    const y = entry.charAt(1);
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
    const code = codeOf(x, y);
    if (code !== null) files.push({ path: entry.slice(3), code });
  }
  return files;
}

/** 작업 폴더 기준 경로 → 변경 상태. 폴더에 변경이 들어 있는지도 답한다. */
export class ChangeMap {
  private constructor(
    private readonly files: ReadonlyMap<string, ChangeCode>,
    private readonly untrackedDirs: ReadonlySet<string>,
    private readonly dirs: ReadonlySet<string>,
  ) {}

  static of(changed: readonly ChangedFile[]): ChangeMap {
    const files = new Map<string, ChangeCode>();
    const untracked = new Set<string>();
    const dirs = new Set<string>();
    for (const c of changed) {
      const isDir = c.path.endsWith('/');
      const path = isDir ? c.path.slice(0, -1) : c.path;
      if (isDir) untracked.add(path);
      else files.set(path, c.code);
      const parts = path.split('/');
      for (let i = 1; i < parts.length + (isDir ? 1 : 0); i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return new ChangeMap(files, untracked, dirs);
  }

  static empty(): ChangeMap {
    return new ChangeMap(new Map(), new Set(), new Set());
  }

  /** 이 파일의 상태. 추적 안 하는 폴더 안 파일은 U. 변경이 없으면 null. */
  statusOf(path: string): ChangeCode | null {
    const own = this.files.get(path);
    if (own !== undefined) return own;
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) if (this.untrackedDirs.has(parts.slice(0, i).join('/'))) return 'U';
    return null;
  }

  /** 이 폴더 안에 바뀐 파일이 있는가 */
  dirHasChange(path: string): boolean {
    return this.dirs.has(path) || this.untrackedDirs.has(path) || this.statusOf(path) === 'U';
  }
}

/** 편집기 왼쪽 줄 표시. from~to는 1부터 세는 줄 번호(닫힌 구간). */
export interface LineMark {
  readonly from: number;
  readonly to: number;
  readonly kind: 'added' | 'modified' | 'deleted';
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * `git diff -U0` 출력에서 바뀐 줄을 뽑는다. 새로 생긴 줄은 added, 고친 줄은 modified,
 * 지워진 자리는 그 다음 줄 위에 deleted 한 줄로 표시한다.
 */
export function parseHunks(diff: string): LineMark[] {
  const marks: LineMark[] = [];
  for (const line of diff.split('\n')) {
    const m = HUNK.exec(line);
    if (m === null) continue;
    const removed = m[2] === undefined ? 1 : Number(m[2]);
    const start = Number(m[3]);
    const added = m[4] === undefined ? 1 : Number(m[4]);
    if (added === 0) {
      marks.push({ from: start + 1, to: start + 1, kind: 'deleted' });
      continue;
    }
    const modified = Math.min(removed, added);
    if (modified > 0) marks.push({ from: start, to: start + modified - 1, kind: 'modified' });
    if (added > removed) marks.push({ from: start + modified, to: start + added - 1, kind: 'added' });
    if (removed > added) marks.push({ from: start + added, to: start + added, kind: 'deleted' });
  }
  return marks;
}

/** 새 파일(추적 안 함)은 전체가 added다. 빈 파일은 표시할 줄이 없다. */
export function allAdded(lineCount: number): LineMark[] {
  return lineCount > 0 ? [{ from: 1, to: lineCount, kind: 'added' }] : [];
}
