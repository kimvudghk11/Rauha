import { DIAGNOSTIC_DEBOUNCE_MS, diagnosticsWanted, ProblemBook } from '../shared/problems.js';
import { navFailText, type NavApi, type NavDiagnostic } from '../shared/ts-nav.js';

export interface DiagnosticsDeps {
  readonly api: NavApi;
  /** 편집기에 있는 글(저장 전 포함) */
  readonly textOf: (path: string) => string | null;
  /** 편집기 밑줄을 바꾼다 */
  readonly underline: (path: string, items: readonly NavDiagnostic[]) => void;
  /** 모음이 바뀌었다. failure 는 마지막 호출이 실패한 까닭(없으면 null) */
  readonly changed: (book: ProblemBook, failure: string | null) => void;
}

/**
 * 열어 둔 TS/JS 파일의 문법·타입 오류를 언어 도구에 물어 밑줄과 Problems 목록에 반영한다.
 * 열기·저장은 바로, 글을 고칠 때는 잠시 가만히 있으면 부른다. 같은 파일의 늦게 온 옛 답은 버린다.
 */
export function createDiagnostics(d: DiagnosticsDeps) {
  let book = ProblemBook.empty();
  let failure: string | null = null;
  const timers = new Map<string, number>();
  const seqs = new Map<string, number>();

  const publish = (): void => d.changed(book, failure);

  async function run(path: string): Promise<void> {
    const text = d.textOf(path);
    if (text === null) return;
    const seq = (seqs.get(path) ?? 0) + 1;
    seqs.set(path, seq);
    if (!diagnosticsWanted(path, text.length)) {
      if (book.itemsOf(path).length > 0) {
        book = book.without(path);
        d.underline(path, []);
        publish();
      }
      return;
    }
    const r = await d.api.diagnostics({ path, text, line: 1, column: 1 });
    if (seqs.get(path) !== seq || d.textOf(path) === null) return;
    if (!r.ok) {
      failure = r.reason === 'unsupported' ? null : navFailText(r.reason);
      publish();
      return;
    }
    failure = null;
    book = book.with(path, r.items);
    d.underline(path, r.items);
    publish();
  }

  return {
    /** 열기·저장 직후: 바로 */
    refresh(path: string): void {
      window.clearTimeout(timers.get(path));
      void run(path);
    },
    /** 글을 고쳤다: 잠시 뒤에 */
    schedule(path: string | null): void {
      if (path === null) return;
      window.clearTimeout(timers.get(path));
      timers.set(path, window.setTimeout(() => void run(path), DIAGNOSTIC_DEBOUNCE_MS));
    },
    /** 파일이 닫혔다 */
    forget(path: string): void {
      window.clearTimeout(timers.get(path));
      timers.delete(path);
      seqs.delete(path);
      if (book.itemsOf(path).length > 0) {
        book = book.without(path);
        publish();
      }
    },
    renamed(from: string, to: string): void {
      book = book.renamed(from, to);
      publish();
    },
    reset(): void {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      seqs.clear();
      book = ProblemBook.empty();
      failure = null;
      publish();
    },
  };
}
