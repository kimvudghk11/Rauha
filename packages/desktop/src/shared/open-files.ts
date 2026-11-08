import type { Eol } from './code-text.js';
import { isSameOrUnder, movedPath } from './code-ops.js';

/** 열어 둔 파일 하나. 편집 중인 글은 편집기가 갖고, 여기엔 디스크에 있다고 아는 상태만 둔다. */
export class OpenFile {
  private constructor(
    readonly path: string,
    /** 마지막으로 읽거나 저장한 글 */
    readonly savedText: string,
    readonly version: string,
    readonly eol: Eol,
    readonly bom: boolean,
    /** 디스크에서 이 파일이 바뀌었거나 지워졌다고 알게 됐다 */
    readonly stale: boolean,
  ) {}

  static opened(path: string, text: string, version: string, eol: Eol, bom: boolean): OpenFile {
    return new OpenFile(path, text, version, eol, bom, false);
  }

  /** 지금 편집기 글이 저장된 글과 다르면 수정된 것이다(●) */
  isDirty(currentText: string): boolean {
    return currentText !== this.savedText;
  }

  /** 저장했다: 지금 글이 디스크 글이 된다 */
  saved(text: string, version: string): OpenFile {
    return new OpenFile(this.path, text, version, this.eol, this.bom, false);
  }

  /** 디스크 내용을 다시 읽어 왔다(되돌리기·다시 불러오기) */
  reloaded(text: string, version: string, eol: Eol, bom: boolean): OpenFile {
    return new OpenFile(this.path, text, version, eol, bom, false);
  }

  /** 이름이 바뀌거나 옮겨져 경로가 달라졌다(내용·수정 상태는 그대로) */
  movedTo(path: string): OpenFile {
    return new OpenFile(path, this.savedText, this.version, this.eol, this.bom, this.stale);
  }

  /** 디스크에서 바뀐 것을 알았다 */
  markedStale(): OpenFile {
    return this.stale ? this : new OpenFile(this.path, this.savedText, this.version, this.eol, this.bom, true);
  }
}

/** 열어 둔 파일 탭들과 지금 보는 탭. 바꾸면 새 값을 돌려준다. */
export class OpenFiles {
  private constructor(
    readonly files: readonly OpenFile[],
    readonly active: string | null,
  ) {}

  static empty(): OpenFiles {
    return new OpenFiles([], null);
  }

  get(path: string): OpenFile | undefined {
    return this.files.find((f) => f.path === path);
  }

  has(path: string): boolean {
    return this.get(path) !== undefined;
  }

  /** 열고 그 탭으로 간다. 이미 열려 있으면 그 탭으로만 간다(기존 상태는 지키므로 편집 중인 글이 사라지지 않는다). */
  opened(file: OpenFile): OpenFiles {
    return this.has(file.path) ? this.activated(file.path) : new OpenFiles([...this.files, file], file.path);
  }

  activated(path: string): OpenFiles {
    return this.has(path) ? new OpenFiles(this.files, path) : this;
  }

  /** 닫는다. 보던 탭이면 오른쪽 이웃, 없으면 왼쪽 이웃으로 간다. */
  closed(path: string): OpenFiles {
    const i = this.files.findIndex((f) => f.path === path);
    if (i < 0) return this;
    const rest = this.files.filter((f) => f.path !== path);
    if (this.active !== path) return new OpenFiles(rest, this.active);
    return new OpenFiles(rest, (rest[i] ?? rest[i - 1])?.path ?? null);
  }

  /** 파일이나 폴더의 이름이 바뀌거나 옮겨졌다: 그 안에 열린 탭들이 새 경로로 이어진다(순서·보던 탭은 그대로) */
  moved(from: string, to: string): OpenFiles {
    if (!this.files.some((f) => movedPath(f.path, from, to) !== null)) return this;
    const next = (path: string): string => movedPath(path, from, to) ?? path;
    return new OpenFiles(
      this.files.map((f) => (movedPath(f.path, from, to) === null ? f : f.movedTo(next(f.path)))),
      this.active === null ? null : next(this.active),
    );
  }

  /** 지워진 파일이나 폴더 안의 탭을 모두 닫는다. 보던 탭이 닫히면 남은 탭 중 가까운 쪽으로 간다. */
  closedUnder(path: string): OpenFiles {
    let tabs: OpenFiles = this;
    for (const f of this.files) if (isSameOrUnder(f.path, path)) tabs = tabs.closed(f.path);
    return tabs;
  }

  /** 한 파일의 상태를 바꾼다 */
  updated(path: string, change: (file: OpenFile) => OpenFile): OpenFiles {
    return new OpenFiles(
      this.files.map((f) => (f.path === path ? change(f) : f)),
      this.active,
    );
  }

  /** 지금 보는 탭 기준 한 칸 옆(Ctrl+Tab 같은 이동). delta는 +1 또는 -1. */
  neighbor(delta: 1 | -1): string | null {
    if (this.files.length === 0 || this.active === null) return null;
    const i = this.files.findIndex((f) => f.path === this.active);
    return this.files[(i + delta + this.files.length) % this.files.length]?.path ?? null;
  }
}

export const baseName = (path: string): string => path.split('/').pop() ?? path;

/** 탭에 쓸 이름. 같은 이름이 둘 이상이면 바로 위 폴더를 붙여 구분한다("a.ts — src"). */
export function tabLabels(paths: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(baseName(p), (counts.get(baseName(p)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of paths) {
    const name = baseName(p);
    const parts = p.split('/');
    out.set(p, (counts.get(name) ?? 0) > 1 && parts.length > 1 ? `${name} — ${parts[parts.length - 2]}` : name);
  }
  return out;
}
