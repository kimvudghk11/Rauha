import { BlogDraftRequestDto, BlogRequestError, BlogSaveRequestDto, type BlogDraftResult, type BlogSaveResult, type BlogToneId } from '../../shared/blog-dto.js';
import type { RedactContext } from '../../shared/blog-redact.js';

export interface BlogServiceDeps {
  readonly context: () => RedactContext;
  /** 모델을 한 번 불러 초안을 받는다 */
  readonly draft: (note: string, tone: BlogToneId) => Promise<string>;
  /** 저장 대화상자를 열어 사용자가 고른 경로를 받는다. 취소하면 null */
  readonly pickPath: (fileName: string) => Promise<string | null>;
  readonly write: (path: string, text: string) => Promise<void>;
}

const DRAFT_FAILED = '초안을 쓰지 못했어요. 로그인이나 한도를 확인하고 다시 해 주세요.';
const SAVE_FAILED = '파일을 저장하지 못했어요.';

/** 블로그 글 서비스: 요청 검사 → 가림 → (모델 한 번 | 저장 대화상자). 도메인 판단은 DTO와 가림 함수에 있다. */
export class BlogService {
  constructor(private readonly deps: BlogServiceDeps) {}

  context(): RedactContext {
    return this.deps.context();
  }

  async draft(raw: unknown): Promise<BlogDraftResult> {
    let request: BlogDraftRequestDto;
    try {
      request = BlogDraftRequestDto.from(raw);
    } catch (error) {
      return { ok: false, error: error instanceof BlogRequestError ? error.message : DRAFT_FAILED };
    }
    const ctx = this.deps.context();
    try {
      const text = await this.deps.draft(request.redactedNote(ctx), request.tone);
      // 모델이 돌려준 글도 한 번 더 가린다
      return { ok: true, text: request.redact(text, ctx) };
    } catch (error) {
      return { ok: false, error: error instanceof Error && error.name === 'DomainError' ? error.message : DRAFT_FAILED };
    }
  }

  async save(raw: unknown): Promise<BlogSaveResult> {
    let request: BlogSaveRequestDto;
    try {
      request = BlogSaveRequestDto.from(raw);
    } catch (error) {
      return { ok: false, error: error instanceof BlogRequestError ? error.message : SAVE_FAILED };
    }
    try {
      const path = await this.deps.pickPath(request.fileName);
      if (path === null) return { ok: true, saved: false, name: null };
      const target = /\.md$/i.test(path) ? path : `${path}.md`;
      await this.deps.write(target, request.redactedMarkdown(this.deps.context()));
      return { ok: true, saved: true, name: target.split(/[\/]/).pop() ?? target };
    } catch {
      return { ok: false, error: SAVE_FAILED };
    }
  }
}
