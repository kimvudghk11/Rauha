export interface SearchOptions {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly regex: boolean;
  /** 단어 단위로만 맞춘다 */
  readonly wholeWord?: boolean | undefined;
  /** 포함할 글롭(쉼표로 나눈 글). 비면 전부 */
  readonly include?: string | undefined;
  /** 뺄 글롭 */
  readonly exclude?: string | undefined;
  /** 멈추기용 이름(화면이 정한다) */
  readonly id?: string | undefined;
}

/** 줄 하나에서 맞은 곳 */
export interface LineHit {
  /** 1부터 */
  readonly line: number;
  /** 1부터(맞은 곳 시작 칸) */
  readonly column: number;
  /** 보여 줄 줄 내용(너무 길면 맞은 곳 주변만) */
  readonly preview: string;
  /** preview 안에서 맞은 곳 */
  readonly start: number;
  readonly end: number;
}

export type MatcherResult = { readonly ok: true; readonly matcher: SearchMatcher } | { readonly ok: false; readonly reason: 'empty' | 'bad-regex' };

/** 줄이 너무 길면(압축된 파일 등) 검사하지 않는다 */
const MAX_LINE = 2000;
const PREVIEW = 200;
const MAX_QUERY = 300;

/** 검색어 하나. 일반 글은 글자 그대로 찾고, 정규식 모드일 때만 정규식으로 읽는다. */
export class SearchMatcher {
  private constructor(private readonly re: RegExp) {}

  static from(options: SearchOptions): MatcherResult {
    if (options.query === '') return { ok: false, reason: 'empty' };
    if (options.query.length > MAX_QUERY) return { ok: false, reason: 'bad-regex' };
    const body = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = options.wholeWord === true ? wordBounded(body, options.regex, options.query) : body;
    try {
      return { ok: true, matcher: new SearchMatcher(new RegExp(source, options.caseSensitive ? 'g' : 'gi')) };
    } catch {
      return { ok: false, reason: 'bad-regex' };
    }
  }

  /** 글 전체에서 줄마다 처음 맞은 곳을 모은다(한 파일에서 maxHits개까지) */
  search(text: string, maxHits: number): LineHit[] {
    const hits: LineHit[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      const line = lines[i] ?? '';
      if (line.length > MAX_LINE) continue;
      this.re.lastIndex = 0;
      const m = this.re.exec(line);
      if (m === null || m[0] === '') continue;
      hits.push(preview(i + 1, line, m.index, m.index + m[0].length));
    }
    return hits;
  }
}

function preview(lineNo: number, line: string, start: number, end: number): LineHit {
  const lead = line.length - line.trimStart().length;
  let from = Math.min(lead, start);
  if (end - from > PREVIEW) from = Math.max(0, start - 40);
  const to = Math.min(line.length, Math.max(end, from + PREVIEW));
  const text = line.slice(from, to).replace(/\r$/, '');
  return { line: lineNo, column: start + 1, preview: text, start: start - from, end: Math.min(end - from, text.length) };
}

/** 단어를 이루는 글자: 영문·숫자·밑줄·라틴 확장·한글 */
const WORD = String.raw`[\w\u00C0-\u024F\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]`;
const WORD_RE = new RegExp(WORD);
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD_RE.test(ch);

/** 앞뒤가 단어 글자면 맞지 않게 한다. 일반 글 검색은 검색어 가장자리가 기호일 때 그쪽을 따지지 않는다(VS Code 와 같다). */
function wordBounded(body: string, regex: boolean, raw: string): string {
  const before = regex || isWordChar(raw[0]) ? `(?<!${WORD})` : '';
  const after = regex || isWordChar(raw[raw.length - 1]) ? `(?!${WORD})` : '';
  return `${before}(?:${body})${after}`;
}

/** 만들어 낸 파일(압축본·소스맵·잠금 파일)이라 전체 찾기에서 건너뛴다 */
const GENERATED = /(?:\.min\.(?:js|css|mjs)|\.map)$/i;
const LOCK_FILES: ReadonlySet<string> = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb', 'cargo.lock', 'poetry.lock']);
export function isGeneratedFile(relPath: string): boolean {
  const name = (relPath.split('/').pop() ?? relPath).toLowerCase();
  return GENERATED.test(name) || LOCK_FILES.has(name);
}
