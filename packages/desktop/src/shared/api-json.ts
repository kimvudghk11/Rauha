/** JSON 글을 구문 색을 칠할 조각으로 나눈다(들여쓰기는 ResponseSummary.prettyBody가 한다). 접기 대신 간단한 색만 쓴다. */
export type JsonTokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'text';

export interface JsonToken {
  readonly kind: JsonTokenKind;
  readonly text: string;
}

/** 이보다 길면 색을 칠하지 않고 한 덩어리로 둔다(화면이 느려지지 않게) */
export const HIGHLIGHT_LIMIT = 200_000;

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

export function tokenizeJson(text: string): JsonToken[] {
  if (text.length > HIGHLIGHT_LIMIT) return [{ kind: 'text', text }];
  const out: JsonToken[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    const whole = m[0];
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push({ kind: 'key', text: m[1] });
        out.push({ kind: 'punct', text: m[2] });
      } else out.push({ kind: 'string', text: m[1] });
    } else if (m[3] !== undefined) out.push({ kind: 'bool', text: whole });
    else if (whole === 'null') out.push({ kind: 'null', text: whole });
    else if (/^[{}[\],:]$/.test(whole)) out.push({ kind: 'punct', text: whole });
    else out.push({ kind: 'number', text: whole });
    last = at + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
