import { BlogNote, type BlogLength, type BlogTemplateId } from './blog-note.js';
import { BlogRedactor, type RedactChange, type RedactContext } from './blog-redact.js';
import type { RecordEntry } from './record-book.js';

export interface BlogPreviewState {
  readonly length: BlogLength;
  readonly titleIndex: number;
  /** 사용자가 되돌린 항목의 원래 값 */
  readonly keep: readonly string[];
  /** 사용자가 체크한 코드 조각만 */
  readonly snippets: readonly string[];
  /** 글 틀(없으면 트러블슈팅) */
  readonly template?: BlogTemplateId;
  /** 맨 앞에 제목·태그·날짜 front-matter를 넣는다(기본 꺼짐: 어디에나 붙여 넣기 좋은 순수 글) */
  readonly frontMatter?: boolean;
  /** front-matter 날짜(YYYY-MM-DD) */
  readonly date?: string;
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
  return { hasMaterial: note.hasMaterial(), title, titles, tags: note.tags(), markdown: note.hasMaterial() ? note.toMarkdown({ title, tags: note.tags(), ...(state.template === undefined ? {} : { template: state.template }), frontMatter: state.frontMatter === true, ...(state.date === undefined ? {} : { date: state.date }) }) : '', changes: red.changes(), droppedSnippets: note.droppedSnippets };
}
