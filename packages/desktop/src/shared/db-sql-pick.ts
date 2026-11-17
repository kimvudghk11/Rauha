/**
 * SQL 편집기에서 "무엇을 돌릴지" 고르기(DataGrip·TablePlus·DBeaver 방식):
 * 고른 글이 있으면 그 글만, 없으면 커서가 있는 문장 하나만 돌린다. 문장은 세미콜론으로 나누고,
 * 세미콜론이 없어도 빈 줄 다음 문단이 SQL 낱말(SELECT·UPDATE …)로 시작하면 새 문장으로 본다(DBeaver 의 "빈 줄은 문장 구분").
 * 따옴표('…' "…" `…`), 주석(-- … /* … *\/), PostgreSQL 달러 따옴표($$…$$, $tag$…$tag$) 안의 세미콜론·빈 줄에서는 나누지 않는다.
 * 돌려줄 글이 실제로 안전한지는 SqlStatement.parse 가 다시 본다(여기는 고르기만).
 */

/** 새 문장을 여는 첫 낱말(빈 줄 뒤 문단이 이것으로 시작해야 나눈다. WHERE·ORDER 같은 절은 앞 문장에 붙는다) */
const STARTS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'PRAGMA', 'VALUES', 'TABLE', 'TRUNCATE', 'MERGE', 'CALL', 'REPLACE', 'GRANT', 'REVOKE', 'SET', 'USE', 'ANALYZE', 'COMMENT']);

/** 세미콜론 위치와, 따옴표·주석 밖에 있는 빈 줄(줄바꿈 두 번) 위치 */
function scan(text: string): { readonly semis: number[]; readonly blanks: number[] } {
  const semis: number[] = [];
  const blanks: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      // 줄 주석은 줄바꿈 앞에서 끝난다(그 줄바꿈이 빈 줄의 시작일 수 있다)
      i = end === -1 ? text.length : end;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch && text[j + 1] === ch) j += 2;
        else if (text[j] === '\\' && ch !== '"') j += 2;
        else if (text[j] === ch) break;
        else j += 1;
      }
      i = j + 1;
    } else if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))?.[0];
      if (tag === undefined) i += 1;
      else {
        const end = text.indexOf(tag, i + tag.length);
        i = end === -1 ? text.length : end + tag.length;
      }
    } else if (ch === '\n') {
      const gap = /^\n[ \t\r]*\n/.exec(text.slice(i));
      if (gap !== null) {
        blanks.push(i);
        i += gap[0].length - 1; // 마지막 줄바꿈은 다음 빈 줄의 시작일 수 있어 남긴다
      } else i += 1;
    } else {
      if (ch === ';') semis.push(i);
      i += 1;
    }
  }
  return { semis, blanks };
}

/** 문단의 첫 낱말(앞의 공백·주석은 건너뛴다). 없으면 '' */
function firstWord(text: string): string {
  const body = text.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, '');
  return /^[A-Za-z]+/.exec(body)?.[0]?.toUpperCase() ?? '';
}

/** 세미콜론으로 나눈 조각 [from, to) 안에서, 빈 줄로 나뉜 문장들의 경계 */
function paragraphs(text: string, from: number, to: number, blanks: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let start = from;
  for (const b of blanks) {
    if (b <= from || b >= to) continue;
    const rest = text.slice(b, to);
    if (rest.trim() === '' || !STARTS.has(firstWord(rest))) continue;
    if (text.slice(start, b).trim() === '') continue;
    out.push([start, b]);
    start = b;
  }
  out.push([start, to]);
  return out;
}

/**
 * 돌릴 글. selection 은 고른 범위(없으면 null), cursor 는 커서 위치(글자 인덱스).
 * 커서가 세미콜론 바로 뒤(같은 줄에 남은 글이 공백뿐)면 그 앞 문장으로 본다. 빈 줄 위면 바로 위 문장이다.
 */
export function statementAt(text: string, cursor: number, selection: { readonly from: number; readonly to: number } | null): string {
  if (selection !== null && selection.to > selection.from) {
    const picked = text.slice(selection.from, selection.to).trim();
    if (picked !== '') return picked;
  }
  const { semis, blanks } = scan(text);
  // 1) 세미콜론으로 나눈 조각 고르기
  let chunk: [number, number] | null = null;
  let start = 0;
  for (const end of semis) {
    const rest = text.slice(end + 1, cursor);
    if (cursor <= end || (cursor > end && !rest.includes('\n') && rest.trim() === '')) {
      chunk = [start, end + 1];
      break;
    }
    start = end + 1;
  }
  if (chunk === null) {
    if (text.slice(start).trim() !== '') chunk = [start, text.length];
    else if (semis.length > 0) chunk = [semis.length >= 2 ? semis[semis.length - 2]! + 1 : 0, semis[semis.length - 1]! + 1];
    else return '';
  }
  // 2) 그 조각 안에서 빈 줄로 나뉜 문장 중 커서가 있는 것(빈 줄 위면 바로 위 문장)
  const parts = paragraphs(text, chunk[0], chunk[1], blanks).filter(([a, b]) => text.slice(a, b).trim() !== '');
  if (parts.length === 0) return '';
  const at = Math.min(Math.max(cursor, chunk[0]), chunk[1]);
  let pick = parts[0]!;
  for (const p of parts) {
    const head = p[0] + (text.slice(p[0], p[1]).length - text.slice(p[0], p[1]).trimStart().length);
    if (head <= at) pick = p;
  }
  return text.slice(pick[0], pick[1]).trim();
}
