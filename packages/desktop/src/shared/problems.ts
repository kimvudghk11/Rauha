import { isTsLikePath, type NavDiagnostic } from './ts-nav.js';

/** 이보다 긴 글은 진단을 부르지 않는다(글자 수) */
export const MAX_DIAGNOSTIC_TEXT = 300_000;
/** 글을 고친 뒤 이만큼 가만히 있으면 진단을 다시 부른다(ms) */
export const DIAGNOSTIC_DEBOUNCE_MS = 1200;

export const diagnosticsWanted = (path: string, textLength: number): boolean => isTsLikePath(path) && textLength <= MAX_DIAGNOSTIC_TEXT;

export interface ProblemRow {
  readonly path: string;
  readonly item: NavDiagnostic;
}

/** 열어 둔 파일들의 문법·타입 오류 모음. 바꾸는 메서드는 새 모음을 돌려준다. */
export class ProblemBook {
  private constructor(private readonly byFile: ReadonlyMap<string, readonly NavDiagnostic[]>) {}

  static empty(): ProblemBook {
    return new ProblemBook(new Map());
  }

  /** 이 파일의 진단을 통째로 바꾼다. 비어 있으면 그 파일을 목록에서 뺀다. */
  with(path: string, items: readonly NavDiagnostic[]): ProblemBook {
    const next = new Map(this.byFile);
    if (items.length === 0) next.delete(path);
    else next.set(path, items);
    return new ProblemBook(next);
  }

  without(path: string): ProblemBook {
    return this.with(path, []);
  }

  /** 파일·폴더 이름이 바뀌었다: from 자신과 그 아래 경로를 to 로 옮긴다 */
  renamed(from: string, to: string): ProblemBook {
    const next = new Map<string, readonly NavDiagnostic[]>();
    for (const [p, items] of this.byFile) next.set(p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p, items);
    return new ProblemBook(next);
  }

  /** 폴더(또는 파일)가 지워졌다: 그 아래 진단을 뺀다 */
  removedUnder(path: string): ProblemBook {
    const next = new Map<string, readonly NavDiagnostic[]>();
    for (const [p, items] of this.byFile) if (p !== path && !p.startsWith(`${path}/`)) next.set(p, items);
    return new ProblemBook(next);
  }

  files(): string[] {
    return [...this.byFile.keys()].sort((a, b) => a.localeCompare(b));
  }

  itemsOf(path: string): readonly NavDiagnostic[] {
    return this.byFile.get(path) ?? [];
  }

  counts(): { readonly errors: number; readonly warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const items of this.byFile.values()) for (const i of items) if (i.severity === 'error') errors++;
    else warnings++;
    return { errors, warnings };
  }

  total(): number {
    const c = this.counts();
    return c.errors + c.warnings;
  }

  /** 파일 이름순, 파일 안에서는 줄 순서 */
  rows(): ProblemRow[] {
    return this.files().flatMap((path) => [...this.itemsOf(path)].sort((a, b) => a.line - b.line || a.column - b.column).map((item) => ({ path, item })));
  }
}

export function problemCountText(c: { readonly errors: number; readonly warnings: number }): string {
  if (c.errors === 0 && c.warnings === 0) return 'No problems';
  const parts: string[] = [];
  if (c.errors > 0) parts.push(`${c.errors} error${c.errors === 1 ? '' : 's'}`);
  if (c.warnings > 0) parts.push(`${c.warnings} warning${c.warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}
