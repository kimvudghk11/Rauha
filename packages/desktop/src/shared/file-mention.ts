import { SKIPPED_FOLDERS } from './folder-kind.js';
import { fuzzyScore } from './quick-open.js';

/** 한 번에 가리킬 수 있는 파일 수 */
export const MAX_FILE_MENTIONS = 5;
/** 이 크기 이하인 파일만 앞부분을 요청에 붙인다 */
export const INLINE_MAX_BYTES = 16 * 1024;
const HEAD_LINES = 40;
const HEAD_CHARS = 2000;
const RECENT_MAX = 20;
const TRAILING_PUNCT = /[.,!?;:)\]}"'、。]+$/;
const LINE_RANGE = /:(\d+(?:-\d+)?)$/;
/** 제어 문자(C0·DEL·C1)와 보이지 않는/방향을 바꾸는 글자: 프롬프트에 찍히는 경로를 속일 수 있다 */
const ODD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
const SHORT_GIT = /^git~\d+$/i;
const MENTION = /(?:^|\s)@([^\s@]+)/g;

/**
 * `@경로/파일.ts` 로 가리킨 파일 하나. 작업 폴더 기준 상대 경로만 받는다.
 * 문자열 검사만 한다. 실제로 있는지·비밀 파일인지·링크로 새는지는 main이 읽을 때 다시 본다.
 */
export class FileMention {
  private constructor(
    readonly path: string,
    /** `:10-20` 처럼 적은 줄 범위(없으면 null) */
    readonly lines: string | null,
  ) {}

  static fromToken(raw: string): FileMention | null {
    if (ODD_CHARS.test(raw)) return null;
    let token = raw.replace(TRAILING_PUNCT, '');
    const range = LINE_RANGE.exec(token);
    const lines = range === null ? null : range[1]!;
    if (range !== null) token = token.slice(0, range.index);
    const slashed = token.replace(/\\/g, '/');
    if (slashed === '' || slashed.endsWith('/') || slashed.startsWith('/') || slashed.startsWith('~') || /^[a-zA-Z]:/.test(slashed)) return null;
    const parts = slashed.split('/');
    for (const part of parts) {
      if (part === '' || part === '.' || part === '..') return null;
      if (part.replace(/[. ]+$/, '').toLowerCase() === '.git' || SHORT_GIT.test(part.replace(/[. ]+$/, ''))) return null;
      if (part.includes(':')) return null;
    }
    if (!slashed.includes('/') && !slashed.includes('.')) return null;
    return new FileMention(slashed, lines);
  }
}

/** 요청 글에서 `@파일` 언급을 나온 순서대로(같은 파일은 한 번, 최대 5개) 모은다. */
export function mentionedPaths(text: string): FileMention[] {
  const found: FileMention[] = [];
  for (const m of text.matchAll(MENTION)) {
    const mention = FileMention.fromToken(m[1]!);
    if (mention === null || found.some((f) => f.path === mention.path)) continue;
    found.push(mention);
    if (found.length >= MAX_FILE_MENTIONS) break;
  }
  return found;
}

export interface MentionDraft {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

/** 커서가 `@글자` 끝(또는 안)에 있으면 그 글자. 앞이 공백·줄 처음이 아닌 @(이메일)는 아니다. */
export function activeMention(text: string, caret: number): MentionDraft | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const typed = upto.slice(at + 1);
  if (/\s/.test(typed)) return null;
  const tail = /^[^\s@]*/.exec(text.slice(caret))![0];
  return { start: at, end: caret + tail.length, query: typed + tail };
}

export function completeMention(text: string, draft: MentionDraft, path: string): { text: string; caret: number } {
  const before = text.slice(0, draft.start);
  const after = text.slice(draft.end);
  const insert = `@${path}${after.startsWith(' ') ? '' : ' '}`;
  const caret = before.length + insert.length + (after.startsWith(' ') ? 1 : 0);
  return { text: `${before}${insert}${after}`, caret };
}

const SECRET_NAME = /^(\.env(\..+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials\.json|.+\.(pem|key|p12|pfx|keystore))$/i;
const EXAMPLE_NAME = /\.(example|sample|template|dist)$/i;

/** 이름만 보고 비밀 파일처럼 보이는가(.env·키 파일 …). 예시 파일(.env.example)은 아니다. */
export function looksSecretName(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return SECRET_NAME.test(name) && !EXAMPLE_NAME.test(name);
}

/** 목록에 보이지 않을 파일: 비밀처럼 보이는 이름, 생성물 폴더 안(node_modules·dist·.git …). 진짜 비밀 판정은 main의 규칙이 따로 한다. */
function hidden(path: string): boolean {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((p) => SKIPPED_FOLDERS.has(p))) return true;
  return looksSecretName(path);
}

/** 자동완성 후보. 검색어가 맞는 순서, 같은 정도면 최근 연 파일이 먼저. 검색어가 없으면 최근 연 파일, 그다음 가나다순. */
export function rankMentionFiles(query: string, paths: readonly string[], recent: readonly string[], limit: number): string[] {
  const visible = paths.filter((p) => !hidden(p));
  const known = new Set(visible);
  const recents = recent.filter((p) => known.has(p));
  if (query.trim() === '') {
    const first = new Set(recents);
    return [...recents, ...visible.filter((p) => !first.has(p))].slice(0, limit);
  }
  const scored: { path: string; score: number }[] = [];
  for (const path of visible) {
    const base = fuzzyScore(query, path);
    if (base === null) continue;
    const at = recents.indexOf(path);
    scored.push({ path, score: base + (at < 0 ? 0 : Math.max(0.5, 3 - at * 0.2)) });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}

/** 최근 연 파일(최근 것이 앞). 값 객체라 바꾸면 새 값이 나온다. */
export class RecentFiles {
  private constructor(private readonly paths: readonly string[]) {}
  static empty(): RecentFiles {
    return new RecentFiles([]);
  }
  opened(path: string): RecentFiles {
    return new RecentFiles([path, ...this.paths.filter((p) => p !== path)].slice(0, RECENT_MAX));
  }
  forgot(path: string): RecentFiles {
    return new RecentFiles(this.paths.filter((p) => p !== path));
  }
  list(): readonly string[] {
    return this.paths;
  }
}

/** 팀에 넘길 참고 파일 하나: 경로·크기, 작으면 앞부분 */
export class MentionedFile {
  private constructor(
    readonly path: string,
    readonly size: number | null,
    readonly head: string | null,
    readonly truncated: boolean,
    readonly lines: string | null,
  ) {}

  /** size/text 가 null 이면 못 읽은 것(너무 큼): 경로만 담는다. */
  static of(path: string, size: number | null, text: string | null, lines: string | null): MentionedFile {
    if (size === null || text === null || size > INLINE_MAX_BYTES) return new MentionedFile(path, size, null, false, lines);
    const all = text.split('\n');
    const byLines = all.slice(0, HEAD_LINES).join('\n');
    const head = byLines.slice(0, HEAD_CHARS);
    return new MentionedFile(path, size, head, head.length < text.length, lines);
  }

  private describe(): string {
    const size = this.size === null ? '크기 큼' : this.size < 1024 ? `${this.size}B` : `${(this.size / 1024).toFixed(1)}KB`;
    return `- ${this.path} (${size}${this.lines === null ? '' : `, 줄 ${this.lines}`})`;
  }

  toMarkdown(): string {
    if (this.head === null) return this.describe();
    const longest = Math.max(2, ...[...this.head.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${this.describe()}${this.truncated ? ' 앞부분' : ''}\n${fence}\n${this.head}\n${fence}`;
  }
}

/** 요청 앞에 참고 파일·이미지 안내를 붙인다. 붙일 것이 없으면 요청 그대로. */
export function withAttachments(files: readonly MentionedFile[], imagePaths: readonly string[], request: string): string {
  if (files.length === 0 && imagePaths.length === 0) return request;
  const blocks: string[] = [];
  if (files.length > 0) blocks.push(`[참고 파일] 사용자가 @로 가리킨 파일입니다. 필요하면 Read 도구로 전체를 읽으세요.\n${files.map((f) => f.toMarkdown()).join('\n')}`);
  if (imagePaths.length > 0) blocks.push(`[첨부 이미지] 사용자가 붙인 이미지입니다. Read 도구로 아래 경로를 열면 이미지를 볼 수 있습니다.\n${imagePaths.map((p) => `- ${p}`).join('\n')}`);
  return `${blocks.join('\n\n')}\n\n[요청]\n${request}`;
}
