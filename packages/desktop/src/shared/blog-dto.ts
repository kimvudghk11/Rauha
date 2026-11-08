import { BlogRedactor, type RedactContext } from './blog-redact.js';

/** 블로그 글 기능이 화면과 main 사이에서 쓰는 채널과 요청 모양 */
export const BLOG_IPC = {
  context: 'blog:context',
  draft: 'blog:draft',
  save: 'blog:save',
} as const;

export type BlogToneId = 'plain' | 'friendly';

export const NOTE_MAX = 12_000;
export const MARKDOWN_MAX = 200_000;
const KEEP_MAX = 200;
const NAME_MAX = 60;

export type BlogDraftResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };
export type BlogSaveResult = { readonly ok: true; readonly saved: boolean; readonly name: string | null } | { readonly ok: false; readonly error: string };

/** 블로그 탭 API(window.rauha.blog) */
export interface BlogApi {
  /** 가림에 쓸 이름들(작업 폴더의 레포·폴더, 설정의 회사 이름, 사용자 이름, 홈 경로) */
  context(): Promise<RedactContext>;
  /** 정리 노트로 초안을 쓴다(모델 한 번) */
  draft(request: unknown): Promise<BlogDraftResult>;
  /** 글을 .md 파일로 저장한다. 폴더는 저장 대화상자에서 사용자가 고른다. */
  save(request: unknown): Promise<BlogSaveResult>;
}

export class BlogRequestError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function keepOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, KEEP_MAX) : [];
}

function textOf(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.trim() === '') throw new BlogRequestError(`${field}이(가) 비어 있어요.`);
  if (v.length > max) throw new BlogRequestError(`${field}이(가) 너무 길어요.`);
  return v;
}

/** 파일 이름으로 못 쓰는 글자를 없애고 .md로 끝내는 이름 */
export function markdownFileName(title: string): string {
  const base = title
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, NAME_MAX)
    .trim();
  return `${base === '' ? 'blog-draft' : base}.md`;
}

/** 초안 쓰기 요청. 받은 정리 노트는 main이 한 번 더 가려서 모델에 보낸다. */
export class BlogDraftRequestDto {
  private constructor(
    readonly note: string,
    readonly tone: BlogToneId,
    readonly keep: readonly string[],
  ) {}

  static from(input: unknown): BlogDraftRequestDto {
    if (!isObject(input)) throw new BlogRequestError('요청 모양이 올바르지 않아요.');
    const tone = input['tone'];
    if (tone !== 'plain' && tone !== 'friendly') throw new BlogRequestError('어투를 골라 주세요.');
    return new BlogDraftRequestDto(textOf(input['note'], '정리 노트', NOTE_MAX * 4), tone, keepOf(input['keep']));
  }

  /** 모델에 보낼 글: 가림을 한 번 더 거치고 길이를 자른다 */
  redactedNote(ctx: RedactContext): string {
    return BlogRedactor.create(ctx, this.keep).apply(this.note).text.slice(0, NOTE_MAX);
  }

  redact(text: string, ctx: RedactContext): string {
    return BlogRedactor.create(ctx, this.keep).apply(text).text;
  }
}

/** 저장 요청: 글과 제안 이름만 받는다. 경로는 받지 않는다(사용자가 대화상자에서 고른다). */
export class BlogSaveRequestDto {
  private constructor(
    readonly markdown: string,
    readonly fileName: string,
    readonly keep: readonly string[],
  ) {}

  static from(input: unknown): BlogSaveRequestDto {
    if (!isObject(input)) throw new BlogRequestError('요청 모양이 올바르지 않아요.');
    const markdown = textOf(input['markdown'], '글', MARKDOWN_MAX);
    const title = typeof input['title'] === 'string' ? input['title'] : (markdown.split('\n').find((l) => l.trim() !== '') ?? '');
    return new BlogSaveRequestDto(markdown, markdownFileName(title), keepOf(input['keep']));
  }

  redactedMarkdown(ctx: RedactContext): string {
    return BlogRedactor.create(ctx, this.keep).apply(this.markdown).text;
  }
}
