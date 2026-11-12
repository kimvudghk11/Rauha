/**
 * SQL 편집기에서 "무엇을 돌릴지" 고르기(DataGrip·TablePlus 방식):
 * 고른 글이 있으면 그 글만, 없으면 커서가 있는 문장 하나(세미콜론으로 나눈 조각)만 돌린다.
 * 따옴표('…' "…" `…`), 주석(-- … /* … *\/), PostgreSQL 달러 따옴표($$…$$, $tag$…$tag$) 안의 세미콜론에서는 나누지 않는다.
 * 돌려줄 글이 실제로 안전한지는 SqlStatement.parse 가 다시 본다(여기는 고르기만).
 */

/** 문장이 끝나는 세미콜론 위치들(글자 인덱스) */
function semicolons(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end + 1;
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
    } else {
      if (ch === ';') out.push(i);
      i += 1;
    }
  }
  return out;
}

/**
 * 돌릴 글. selection 은 고른 범위(없으면 null), cursor 는 커서 위치(글자 인덱스).
 * 커서가 세미콜론 바로 뒤(같은 줄에 남은 글이 공백뿐)면 그 앞 문장으로 본다.
 */
export function statementAt(text: string, cursor: number, selection: { readonly from: number; readonly to: number } | null): string {
  if (selection !== null && selection.to > selection.from) {
    const picked = text.slice(selection.from, selection.to).trim();
    if (picked !== '') return picked;
  }
  const ends = semicolons(text);
  let start = 0;
  for (const end of ends) {
    // 커서가 이 문장 안이거나, 이 세미콜론 뒤 같은 줄에 공백만 있는 자리면 이 문장
    const rest = text.slice(end + 1, cursor);
    if (cursor <= end || (cursor > end && !rest.includes('\n') && rest.trim() === '')) {
      return text.slice(start, end + 1).trim();
    }
    start = end + 1;
  }
  const tail = text.slice(start).trim();
  if (tail !== '') return tail;
  // 마지막 세미콜론 뒤가 비었으면 마지막 문장
  const last = ends.length;
  if (last === 0) return '';
  const prevStart = last >= 2 ? ends[last - 2]! + 1 : 0;
  return text.slice(prevStart, ends[last - 1]! + 1).trim();
}
