/** 전체 찾기의 "포함/제외" 칸. VS Code 처럼 쉼표로 나눈 글롭 목록이다. 정규식으로 바꾸지 않고 직접 맞춰 폭발하는 패턴이 없다. */
export type GlobResult = { readonly ok: true; readonly filter: GlobFilter } | { readonly ok: false; readonly reason: 'bad-glob' };

const MAX_PATTERNS = 20;
const MAX_PATTERN_LENGTH = 200;
const MAX_EXPANDED = 50;
const MAX_BRACE_DEPTH = 3;

/** 패턴 하나: 폴더 조각마다 나눈 것 */
interface Pattern {
  readonly segments: readonly string[];
}

export class GlobFilter {
  private constructor(
    private readonly patterns: readonly Pattern[],
    private readonly fold: boolean,
  ) {}

  static from(text: string, caseInsensitive: boolean): GlobResult {
    const parts = splitTop(text);
    if (parts === null) return { ok: false, reason: 'bad-glob' };
    const patterns: Pattern[] = [];
    for (const raw of parts) {
      const p = raw.trim();
      if (p === '') continue;
      if (p.length > MAX_PATTERN_LENGTH || patterns.length >= MAX_PATTERNS) return { ok: false, reason: 'bad-glob' };
      const expanded = expandBraces(p, 0);
      if (expanded === null) return { ok: false, reason: 'bad-glob' };
      for (const one of expanded) {
        const pat = toPattern(one, caseInsensitive);
        if (pat === null) return { ok: false, reason: 'bad-glob' };
        patterns.push(pat);
        if (patterns.length > MAX_EXPANDED) return { ok: false, reason: 'bad-glob' };
      }
    }
    return { ok: true, filter: new GlobFilter(patterns, caseInsensitive) };
  }

  get isEmpty(): boolean {
    return this.patterns.length === 0;
  }

  /** 경로(작업 폴더 기준, 슬래시) 자신이나 그 윗 폴더 하나가 패턴에 맞으면 true */
  matches(relPath: string): boolean {
    const path = (this.fold ? relPath.toLowerCase() : relPath).split('/').filter((s) => s !== '');
    if (path.length === 0) return false;
    for (const pat of this.patterns) {
      for (let k = 1; k <= path.length; k++) if (matchSegments(pat.segments, path, k)) return true;
    }
    return false;
  }
}

/** 중괄호 밖의 쉼표에서만 나눈다. 괄호가 안 맞으면 null */
function splitTop(text: string): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return null;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (depth !== 0) return null;
  out.push(cur);
  return out;
}

function expandBraces(p: string, depth: number): string[] | null {
  const open = p.indexOf('{');
  if (open === -1) return [p];
  if (depth >= MAX_BRACE_DEPTH) return null;
  let level = 0;
  let close = -1;
  for (let i = open; i < p.length; i++) {
    if (p[i] === '{') level++;
    else if (p[i] === '}' && --level === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) return null;
  const alts = splitTop(p.slice(open + 1, close));
  if (alts === null) return null;
  const out: string[] = [];
  for (const alt of alts) {
    const rest = expandBraces(p.slice(0, open) + alt + p.slice(close + 1), depth + 1);
    if (rest === null) return null;
    out.push(...rest);
    if (out.length > MAX_EXPANDED) return null;
  }
  return out;
}

function toPattern(one: string, fold: boolean): Pattern | null {
  let s = fold ? one.toLowerCase() : one;
  s = s.replace(/\\/g, '/');
  let anchored = false;
  if (s.startsWith('./')) {
    anchored = true;
    s = s.slice(2);
  }
  if (s.startsWith('/')) {
    anchored = true;
    s = s.replace(/^\/+/, '');
  }
  const segments = s.split('/').filter((x) => x !== '' && x !== '.');
  if (segments.length === 0 || segments.includes('..') || s.includes('\0')) return null;
  if (!anchored && segments.length === 1) segments.unshift('**');
  return { segments: collapseStars(segments) };
}

/** 이어진 ** 는 하나로 */
function collapseStars(segments: string[]): string[] {
  const out: string[] = [];
  for (const s of segments) if (!(s === '**' && out[out.length - 1] === '**')) out.push(s);
  return out;
}

/** 패턴 조각들이 경로 앞 k개 조각과 정확히 맞는지 */
function matchSegments(pat: readonly string[], path: readonly string[], k: number): boolean {
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = i * 1024 + j;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    let r: boolean;
    if (i === pat.length) r = j === k;
    else if (pat[i] === '**') r = go(i + 1, j) || (j < k && go(i, j + 1));
    else r = j < k && wild(pat[i] as string, path[j] as string) && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** * 와 ? 만 있는 이름 맞추기. 되돌아가는 자리를 하나만 기억해 글자 수 곱만큼만 든다. */
function wild(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}
