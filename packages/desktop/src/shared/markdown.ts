/**
 * 작은 마크다운 해석기. 글을 HTML 문자열로 바꾸지 않고 구조(Block·Inline)로만 돌려준다.
 * 화면은 이 구조를 createElement/textContent로 그리므로 원문이 마크업으로 해석될 길이 없다.
 * - HTML 태그는 해석하지 않고 글자 그대로 둔다.
 * - 링크는 http·https만 링크로 만든다(safeHref). 그 밖의 주소는 글만 남긴다.
 * - 이미지 주소는 그대로 들고 있다. 어떤 파일을 읽어 줄지는 그리는 쪽(workImagePath + main)이 정한다.
 * - 깊이와 한 줄 길이에 상한을 둬서 이상한 글이 화면을 멈추지 못하게 한다.
 */

export type Align = 'left' | 'right' | 'center' | null;

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'strong'; readonly c: readonly Inline[] }
  | { readonly t: 'em'; readonly c: readonly Inline[] }
  | { readonly t: 'del'; readonly c: readonly Inline[] }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly Inline[] }
  | { readonly t: 'image'; readonly src: string; readonly alt: string }
  | { readonly t: 'br' };

export interface ListItem {
  readonly c: readonly Block[];
  /** 할 일 목록이면 체크 여부, 아니면 null */
  readonly checked: boolean | null;
}

export type Block =
  | { readonly t: 'h'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly c: readonly Inline[] }
  | { readonly t: 'p'; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly lang: string; readonly text: string }
  | { readonly t: 'hr' }
  | { readonly t: 'quote'; readonly c: readonly Block[] }
  | { readonly t: 'ul'; readonly items: readonly ListItem[] }
  | { readonly t: 'ol'; readonly start: number; readonly items: readonly ListItem[] }
  | { readonly t: 'table'; readonly head: readonly (readonly Inline[])[]; readonly align: readonly Align[]; readonly rows: readonly (readonly (readonly Inline[])[])[] };

const MAX_DEPTH = 12;
const MAX_INLINE_DEPTH = 8;
/** 이 길이를 넘는 한 문단은 서식 없이 글자로만 보인다 */
const MAX_INLINE_LENGTH = 20000;
/** 닫는 기호를 찾아볼 거리 */
const LOOKAHEAD = 2000;

/** http·https 주소만 돌려준다(주소로 정리한 모양). 그 밖(javascript·data·file·상대 경로 …)은 null. */
export function safeHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}

// ── 글 속(inline) ──

const PUNCT = /[!-/:-@[-`{-~]/;
const isAlnum = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

/** s[open]의 `[`와 짝인 `]`의 위치(없으면 -1). 이스케이프와 코드 조각은 건너뛴다. */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  const end = Math.min(s.length, open + LOOKAHEAD);
  for (let i = open; i < end; i++) {
    const ch = s[i];
    if (ch === '\\') i++;
    else if (ch === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const close = s.indexOf('`'.repeat(n), i + n);
      if (close > 0 && close < end) i = close + n - 1;
      else i += n - 1;
    } else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** s[open]의 `(`와 짝인 `)`의 위치(없으면 -1) */
function matchParen(s: string, open: number): number {
  let depth = 0;
  const end = Math.min(s.length, open + LOOKAHEAD);
  for (let i = open; i < end; i++) {
    const ch = s[i];
    if (ch === '\\') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/** `(주소 "제목")` 안쪽 글에서 주소만 뽑는다 */
function destinationOf(inner: string): string {
  let text = inner.trim();
  const titled = /^(.*?)\s+(?:"[^"]*"|'[^']*')$/s.exec(text);
  if (titled !== null) text = (titled[1] ?? '').trim();
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1);
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

function findClose(s: string, from: number, marker: string, wordy: boolean): number {
  const end = Math.min(s.length, from + LOOKAHEAD);
  for (let j = from; j < end; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '`') {
      // 코드 조각 안의 기호는 닫는 기호가 아니다
      let n = 1;
      while (s[j + n] === '`') n++;
      const close = s.indexOf('`'.repeat(n), j + n);
      if (close > 0 && close < end) j = close + n - 1;
      else j += n - 1;
      continue;
    }
    if (!s.startsWith(marker, j) || isSpace(s[j - 1]) || j === from) continue;
    if (marker.length === 1 && (s[j + 1] === marker || s[j - 1] === marker)) continue;
    if (wordy && isAlnum(s[j + marker.length])) continue;
    return j;
  }
  return -1;
}

function pushText(out: Inline[], v: string): void {
  if (v === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.t === 'text') out[out.length - 1] = { t: 'text', v: last.v + v };
  else out.push({ t: 'text', v });
}

function parseInline(s: string, depth = 0): Inline[] {
  if (s.length > MAX_INLINE_LENGTH || depth > MAX_INLINE_DEPTH) return [{ t: 'text', v: s }];
  const out: Inline[] = [];
  let buf = '';
  const flush = (): void => {
    pushText(out, buf);
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === '\n') {
        flush();
        out.push({ t: 'br' });
        i += 2;
        continue;
      }
      if (next !== undefined && PUNCT.test(next)) {
        buf += next;
        i += 2;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === '\n') {
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, '');
        flush();
        out.push({ t: 'br' });
      } else buf = `${buf.replace(/ +$/, '')} `;
      i++;
      while (s[i] === ' ') i++;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const close = s.indexOf('`'.repeat(n), i + n);
      if (close > 0) {
        let v = s.slice(i + n, close).replace(/\n/g, ' ');
        if (v.length > 1 && v.startsWith(' ') && v.endsWith(' ') && v.trim() !== '') v = v.slice(1, -1);
        flush();
        out.push({ t: 'code', v });
        i = close + n;
        continue;
      }
      buf += '`'.repeat(n);
      i += n;
      continue;
    }
    if ((ch === '!' && s[i + 1] === '[') || ch === '[') {
      const image = ch === '!';
      const open = image ? i + 1 : i;
      const close = matchBracket(s, open);
      if (close > 0 && s[close + 1] === '(') {
        const end = matchParen(s, close + 1);
        if (end > 0) {
          const label = s.slice(open + 1, close);
          const dest = destinationOf(s.slice(close + 2, end));
          flush();
          if (image) {
            out.push({ t: 'image', src: dest, alt: plainOf(parseInline(label, depth + 1)) });
          } else {
            const children = parseInline(label, depth + 1);
            const href = safeHref(dest);
            if (href === null) for (const c of children) out.push(c);
            else out.push({ t: 'link', href, c: children });
          }
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '<') {
      const auto = /^<(https?:\/\/[^\s<>]+)>/.exec(s.slice(i, i + 2100));
      if (auto !== null) {
        const href = safeHref(auto[1]!);
        if (href !== null) {
          flush();
          out.push({ t: 'link', href, c: [{ t: 'text', v: auto[1]! }] });
          i += auto[0].length;
          continue;
        }
      }
    }
    if (ch === 'h' && !isAlnum(s[i - 1]) && (s.startsWith('http://', i) || s.startsWith('https://', i))) {
      const bare = /^https?:\/\/[^\s<>]+/.exec(s.slice(i, i + 2100));
      if (bare !== null) {
        const raw = bare[0].replace(/[.,;:!?)\]'"]+$/, '');
        const href = safeHref(raw);
        if (href !== null) {
          flush();
          out.push({ t: 'link', href, c: [{ t: 'text', v: raw }] });
          i += raw.length;
          continue;
        }
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const run = s[i + 1] === ch ? ch + ch : ch;
      const wordy = ch === '_';
      const ok = run !== '~' && !(wordy && isAlnum(s[i - 1])) && !isSpace(s[i + run.length]);
      if (ok) {
        const close = findClose(s, i + run.length, run, wordy);
        if (close > 0) {
          const inner = parseInline(s.slice(i + run.length, close), depth + 1);
          flush();
          out.push(run === '~~' ? { t: 'del', c: inner } : run.length === 2 ? { t: 'strong', c: inner } : { t: 'em', c: inner });
          i = close + run.length;
          continue;
        }
      }
      buf += run;
      i += run.length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** 글 속 구조에서 글자만 뽑는다(이미지 대체 글 등) */
export function plainOf(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : n.t === 'image' ? n.alt : plainOf(n.c))).join('');
}

// ── 블록 ──

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

const indentOf = (line: string): number => /^ */.exec(line)![0].length;

const splitCells = (line: string): string[] => {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (text[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += text[i];
  }
  cells.push(cur.trim());
  return cells;
};

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
};

const isSeparatorRow = (line: string | undefined, columns: number): boolean => {
  if (line === undefined || !line.includes('-')) return false;
  const cells = splitCells(line);
  return cells.length === columns && cells.every((c) => /^:?-+:?$/.test(c));
};

/** 문단을 끊는 줄인가(새 블록이 시작되는 줄) */
function startsBlock(line: string): boolean {
  if (FENCE.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  if (HEADING.test(line) && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) return true;
  const list = LIST.exec(line);
  return list !== null && (/^[-*+]$/.test(list[2]!) || /^1[.)]$/.test(list[2]!));
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  if (depth > MAX_DEPTH) {
    const text = lines.join('\n').trim();
    return text === '' ? [] : [{ t: 'p', c: [{ t: 'text', v: text }] }];
  }
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const mark = fence[1]!;
      const body: string[] = [];
      const lead = indentOf(line);
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
        if (close !== null && close[1]![0] === mark[0] && close[1]!.length >= mark.length) {
          i++;
          break;
        }
        body.push(l.replace(new RegExp(`^ {0,${Math.min(lead, 3)}}`), ''));
        i++;
      }
      out.push({ t: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) {
      out.push({ t: 'h', level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline((heading[2] ?? '').trim()) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(lines[i]!.replace(/^ {0,3}> ?/, ''));
        i++;
      }
      out.push({ t: 'quote', c: parseBlocks(inner, depth + 1) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length) {
      const head = splitCells(line);
      if (head.length >= 1 && isSeparatorRow(lines[i + 1], head.length)) {
        const align = splitCells(lines[i + 1]!).map(alignOf);
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
          const cells = splitCells(lines[i]!);
          rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
          i++;
        }
        out.push({ t: 'table', head: head.map((c) => parseInline(c)), align, rows });
        continue;
      }
    }
    const list = LIST.exec(line);
    if (list !== null) {
      const ordered = /\d/.test(list[2]![0]!);
      const marker = ordered ? list[2]!.slice(-1) : list[2]!;
      const base = list[1]!.length;
      const start = ordered ? Number.parseInt(list[2]!, 10) : 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (m === null || m[1]!.length > base + 1) break;
        const sameKind = ordered ? /\d/.test(m[2]![0]!) && m[2]!.slice(-1) === marker : m[2] === marker;
        if (!sameKind) break;
        const width = m[1]!.length + m[2]!.length + 1;
        let first = m[3]!;
        let checked: boolean | null = null;
        const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(first);
        if (task !== null) {
          checked = task[1] !== ' ';
          first = first.slice(task[0].length);
        }
        const body: string[] = [first];
        i++;
        while (i < lines.length) {
          const l = lines[i]!;
          if (l.trim() === '') {
            let k = i + 1;
            while (k < lines.length && lines[k]!.trim() === '') k++;
            if (k < lines.length && indentOf(lines[k]!) >= m[1]!.length + 2) {
              for (; i < k; i++) body.push('');
              continue;
            }
            break;
          }
          const ind = indentOf(l);
          if (ind >= m[1]!.length + 2) {
            body.push(l.slice(Math.min(ind, width)));
            i++;
            continue;
          }
          const prev = body[body.length - 1] ?? '';
          if (LIST.test(l) || startsBlock(l) || prev.trim() === '') break;
          body.push(l.trim());
          i++;
        }
        items.push({ c: parseBlocks(body, depth + 1), checked });
        // 항목 사이의 빈 줄은 건너뛴다(다음 줄이 같은 목록 항목일 때만 이어 간다)
        let k = i;
        while (k < lines.length && lines[k]!.trim() === '') k++;
        const nextItem = k < lines.length ? LIST.exec(lines[k]!) : null;
        if (nextItem !== null && nextItem[1]!.length <= base + 1) i = k;
        else break;
      }
      out.push(ordered ? { t: 'ol', start, items } : { t: 'ul', items });
      continue;
    }
    // 문단(맨 아래 줄이 === 나 --- 이면 제목)
    const body: string[] = [line.trimStart()];
    i++;
    let setext: 1 | 2 | null = null;
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === '') break;
      const se = SETEXT.exec(l);
      if (se !== null) {
        setext = se[1]![0] === '=' ? 1 : 2;
        i++;
        break;
      }
      if (startsBlock(l)) break;
      if (l.includes('|') && isSeparatorRow(lines[i + 1], splitCells(l).length)) break;
      body.push(l.trimStart());
      i++;
    }
    const inline = parseInline(body.join('\n'));
    out.push(setext === null ? { t: 'p', c: inline } : { t: 'h', level: setext, c: inline });
  }
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/^﻿/, '')
    .split('\n')
    .map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)));
  return parseBlocks(lines, 0);
}
