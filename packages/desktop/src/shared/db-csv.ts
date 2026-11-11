/** 결과 칸 하나: 없음 · 숫자 · 글 · BLOB(크기와 앞부분 미리보기) */
export type DbCell = null | number | string | { readonly blob: number; readonly preview: string };

const FORMULA_START = /^[=+\-@\t\r]/;

function field(text: string): string {
  // 엑셀·시트가 수식으로 읽는 글은 작은따옴표를 앞에 붙여 글자로 만든다(CSV 수식 주입 방어)
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function cellText(cell: DbCell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'string') return field(cell);
  return `<BLOB ${cell.blob} bytes>`;
}

/** 결과를 CSV 글로. 줄 끝은 CRLF. 숫자는 그대로, 글로 된 칸만 수식 무력화를 거친다. */
export function toCsv(columns: readonly string[], rows: readonly (readonly DbCell[])[]): string {
  const lines = [columns.map((c) => field(c)).join(',')];
  for (const row of rows) lines.push(row.map(cellText).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** 저장 대화상자의 기본 파일 이름: 안전한 글자만 남기고 .csv 로 끝낸다 */
export function csvFileName(base: string): string {
  const safe = base.replace(/[^A-Za-z0-9._\- 가-힣]/g, '_').replace(/^\.+/, '').trim().slice(0, 80);
  return `${safe === '' ? 'result' : safe}.csv`;
}
