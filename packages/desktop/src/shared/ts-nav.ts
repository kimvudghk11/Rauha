import type { SearchOptions } from './text-search.js';

/** 정의/참조 한 곳. 줄·칸은 1부터, preview 는 그 줄(앞뒤 공백 정리)이고 start·end 는 preview 안에서 이름이 있는 곳이다. */
export interface NavLocation {
  /** 작업 폴더 기준 상대 경로(슬래시) */
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
  readonly start: number;
  readonly end: number;
}

export interface NavFileHits {
  readonly path: string;
  readonly hits: readonly NavLocation[];
}

/** 언어 도구가 대상으로 삼는 파일인지 */
const TS_LIKE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
export const isTsLikePath = (path: string): boolean => TS_LIKE.test(path);

const IDENT_CHAR = /[\p{L}\p{N}_$]/u;
const IDENT_START = /[\p{L}_$]/u;

/** 커서(글자 위치) 아래의 식별자. 식별자가 아니거나 숫자만이면 null. 커서가 낱말 바로 뒤에 붙어 있어도 그 낱말로 본다. */
export function wordAt(text: string, offset: number): string | null {
  if (offset < 0 || offset > text.length) return null;
  let from = offset;
  let to = offset;
  while (from > 0 && IDENT_CHAR.test(text[from - 1] as string)) from--;
  while (to < text.length && IDENT_CHAR.test(text[to] as string)) to++;
  if (from === to) return null;
  const word = text.slice(from, to);
  return IDENT_START.test(word[0] as string) ? word : null;
}

export function offsetToLineCol(text: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, column: end - last };
}

/** 줄·칸(1부터) → 글자 위치. 줄이 없으면 null, 칸이 줄보다 길면 줄 끝 */
export function lineColToOffset(text: string, line: number, column: number): number | null {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  let start = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  const nl = text.indexOf('\n', start);
  const end = nl === -1 ? text.length : nl;
  return Math.min(start + column - 1, end);
}

/** 언어 도구를 쓸 수 없을 때(다른 언어·도구 오류)의 대체: 그 이름을 낱말 단위·대소문자 구분으로 전체 찾기 */
export function fallbackSearchFor(word: string): SearchOptions {
  return { query: word, caseSensitive: true, regex: false, wholeWord: true };
}

/** 위치 목록을 같은 자리 중복을 빼고 파일별로 묶는다(파일 이름순, 줄순). 전체 상한을 넘으면 잘렸다고 알린다. */
export function groupLocations(locations: readonly NavLocation[], max: number): { readonly files: NavFileHits[]; readonly truncated: boolean } {
  const seen = new Set<string>();
  const byFile = new Map<string, NavLocation[]>();
  let count = 0;
  let truncated = false;
  for (const loc of locations) {
    const key = `${loc.path}:${loc.line}:${loc.column}`;
    if (seen.has(key)) continue;
    if (count >= max) {
      truncated = true;
      break;
    }
    seen.add(key);
    count++;
    const list = byFile.get(loc.path) ?? [];
    list.push(loc);
    byFile.set(loc.path, list);
  }
  const files = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, hits]) => ({ path, hits: hits.sort((a, b) => a.line - b.line || a.column - b.column) }));
  return { files, truncated };
}

// ── 화면 ↔ main 약속(코드 탭 IPC) ──

/** 정의/참조/진단 요청. line·column 은 1부터이고 편집기에 있는 글(저장 전 포함)을 함께 보낸다. */
export interface NavRequest {
  readonly path: string;
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** 못 한 까닭. 'unsupported' 는 이 파일 종류에는 언어 도구가 없다는 뜻이라 화면이 이름 검색으로 대신한다. */
export type NavFail = 'bad-path' | 'outside' | 'secret' | 'too-big' | 'missing' | 'no-folder' | 'error' | 'unsupported' | 'bad-position' | 'timeout' | 'unavailable';

export type DefinitionResult = { readonly ok: true; readonly locations: readonly NavLocation[] } | { readonly ok: false; readonly reason: NavFail };
export type ReferencesResult = { readonly ok: true; readonly files: readonly NavFileHits[]; readonly truncated: boolean } | { readonly ok: false; readonly reason: NavFail };

/** 파일 하나의 문법·타입 오류(줄·칸은 1부터) */
export interface NavDiagnostic {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: 'error' | 'warning';
  readonly code: number;
  readonly message: string;
}
export type DiagnosticsResult =
  | { readonly ok: true; readonly items: readonly NavDiagnostic[]; readonly truncated: boolean; /** 타입 검사까지 했는가(아니면 문법 오류만) */ readonly semantic: boolean }
  | { readonly ok: false; readonly reason: NavFail };

export const NAV_IPC = { definition: 'code:definition', references: 'code:references', diagnostics: 'code:diagnostics' } as const;

export interface NavApi {
  definition(req: NavRequest): Promise<DefinitionResult>;
  references(req: NavRequest): Promise<ReferencesResult>;
  diagnostics(req: NavRequest): Promise<DiagnosticsResult>;
}

const NAV_FAIL_TEXT: Readonly<Record<NavFail, string>> = {
  'bad-path': 'That path cannot be used.',
  outside: 'Outside the work folder.',
  secret: 'Secret file: not analyzed.',
  'too-big': 'The file is too large to analyze.',
  missing: 'The file does not exist.',
  'no-folder': 'Pick a work folder first (Settings).',
  error: 'The language tool failed.',
  unsupported: 'No language tool for this file type.',
  'bad-position': 'That position is not in the file.',
  timeout: 'The language tool took too long and was stopped.',
  unavailable: 'The language tool could not start.',
};
export const navFailText = (reason: NavFail): string => NAV_FAIL_TEXT[reason];
