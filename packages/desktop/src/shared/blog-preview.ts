import { BlogNote, type BlogLength } from './blog-note.js';
import { BlogRedactor, type RedactChange, type RedactContext } from './blog-redact.js';
import type { RecordEntry } from './record-book.js';

export interface BlogPreviewState {
  readonly length: BlogLength;
  readonly titleIndex: number;
  /** 사용자가 되돌린 항목의 원래 값 */
  readonly keep: readonly string[];
  /** 사용자가 체크한 코드 조각만 */
  readonly snippets: readonly string[];
}

export interface BlogPreview {
  readonly hasMaterial: boolean;
  readonly title: string;
  readonly titles: readonly string[];
  readonly tags: readonly string[];
  readonly markdown: string;
  readonly changes: readonly RedactChange[];
  readonly droppedSnippets: number;
}

/**
 * 고른 기록으로 정리 노트와 "바뀐 목록"을 만든다. 글에 들어가는 모든 문자열이 한 가림이를 거친다.
 * 기록에 적힌 레포 이름은 가릴 이름에 자동으로 더한다(작업 폴더에 없는 레포도 새지 않게).
 */
export function blogPreview(entries: readonly RecordEntry[], ctx: RedactContext, state: BlogPreviewState): BlogPreview {
  const repos = entries.map((e) => e.repo).filter((r): r is string => r !== null);
  const red = BlogRedactor.create({ ...ctx, repoNames: [...ctx.repoNames, ...repos] }, state.keep);
  const note = BlogNote.compose(entries, { length: state.length, snippets: state.snippets }, (s) => red.apply(s).text);
  const titles = note.titles();
  const title = titles[Math.min(Math.max(state.titleIndex, 0), Math.max(titles.length - 1, 0))] ?? '';
  return { hasMaterial: note.hasMaterial(), title, titles, tags: note.tags(), markdown: note.hasMaterial() ? note.toMarkdown({ title }) : '', changes: red.changes(), droppedSnippets: note.droppedSnippets };
}
