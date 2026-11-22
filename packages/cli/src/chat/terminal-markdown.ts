import { displayWidth } from '../text-width.js';

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(?:#{1,6}|■)\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** **굵게**·`코드` 표시 문자를 지운다. 터미널에서는 글자 그대로가 더 읽기 쉽다. */
function inline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1');
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()));
}

/** 마크다운 표 → 한글 폭(두 칸)에 맞춘 칸 맞춤 줄. 머리줄 아래에 ─ 줄을 둔다. */
function table(rows: string[]): string[] {
  const body = rows.filter((r) => !TABLE_RULE.test(r)).map(cells);
  const cols = Math.max(...body.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(...body.map((r) => displayWidth(r[i] ?? ''))));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c + ' '.repeat(widths[i]! - displayWidth(c)))).join('  ').trimEnd();
  const [head, ...rest] = body;
  return [line(head!), widths.map((w) => '─'.repeat(Math.max(w, 3))).join('  '), ...rest.map(line)];
}

/**
 * 답변 팀원이 쓴 마크다운 답 → 터미널 줄. 데스크톱은 같은 답을 마크다운으로 그리고, 터미널은 표시 문자 없이 읽히게 바꾼다.
 * 제목은 ▍ 강조(■는 한글 글꼴 cmd에서 두 칸이라 줄이 어긋난다), 표는 칸 맞춤, 코드 블록은 들여쓰기만.
 */
export function terminalMarkdown(md: string, highlight: ((text: string) => string) | null): string[] {
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      for (i++; i < lines.length && !FENCE.test(lines[i]!); i++) out.push(lines[i] === '' ? '' : `  ${lines[i]}`);
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows: string[] = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]!); i++) rows.push(lines[i]!);
      i--;
      out.push(...table(rows));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const title = `▍ ${inline(heading[1]!)}`;
      out.push(highlight !== null ? highlight(title) : title);
      continue;
    }
    out.push(inline(line));
  }
  return out;
}
