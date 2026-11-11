import { DB_LIMITS, type DbResultSet } from './db-api.js';
import type { DbCell } from './db-csv.js';

/** 칸 하나를 화면 글로. NULL 은 빈 글과 구별되게 NULL 로 쓴다. */
export function cellText(cell: DbCell): string {
  if (cell === null) return 'NULL';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'string') return cell;
  return `<BLOB ${cell.blob} bytes>`;
}
/** 칸 종류별 CSS 클래스 이름(null · num · blob · text) */
export function cellClass(cell: DbCell): 'null' | 'num' | 'blob' | 'text' {
  if (cell === null) return 'null';
  if (typeof cell === 'number') return 'num';
  if (typeof cell === 'string') return 'text';
  return 'blob';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const plural = (n: number, one: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;

/** 결과 아래 한 줄: 읽기는 행 수 · 시간 · 크기, 쓰기는 바뀐 행 수 · 시간 */
export function resultLine(r: DbResultSet): string {
  if (r.kind === 'read') return `${plural(r.rows.length, 'row')} · ${r.elapsedMs} ms · ${formatBytes(r.bytes)}`;
  if (r.kind === 'write' && r.changes !== null) return `${r.verb}: ${plural(r.changes, 'row')} changed · ${r.elapsedMs} ms`;
  return `${r.verb}: done · ${r.elapsedMs} ms`;
}

/** 결과가 상한에서 잘렸을 때 화면에 띄울 안내. 잘리지 않았으면 null. */
export function truncationNote(r: DbResultSet): string | null {
  if (r.truncated === 'rows') return `Showing the first ${DB_LIMITS.maxRows.toLocaleString('en-US')} rows only. Add a WHERE or LIMIT to narrow the result.`;
  if (r.truncated === 'bytes') return `The result passed ${formatBytes(DB_LIMITS.maxBytes).replace('.0', '')}, so only the first ${r.rows.length.toLocaleString('en-US')} rows are shown. Select fewer columns or add a LIMIT.`;
  if (r.cellsTruncated) return `Some long values were cut at ${DB_LIMITS.maxCellChars.toLocaleString('en-US')} characters.`;
  return null;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
export function pageLabel(page: number, total: number, pageSize: number): string {
  if (total === 0) return 'No rows';
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return `Rows ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} · page ${page + 1} of ${pageCount(total, pageSize)}`;
}

/** 열 머리를 누를 때의 다음 정렬: 오름 → 내림 → 없음. 다른 열이면 그 열 오름부터. */
export function nextSort(current: { readonly column: string; readonly dir: 'asc' | 'desc' } | null, column: string): { column: string; dir: 'asc' | 'desc' } | null {
  if (current === null || current.column !== column) return { column, dir: 'asc' };
  return current.dir === 'asc' ? { column, dir: 'desc' } : null;
}

const PREVIEW_MAX = 600;
/** 확인 창에 보일 SQL(길면 앞부분만) */
export function sqlPreview(sql: string): string {
  return sql.length <= PREVIEW_MAX ? sql : `${sql.slice(0, PREVIEW_MAX)}…`;
}
