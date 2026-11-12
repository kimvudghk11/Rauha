import { DB_LIMITS, type DbResultSet, type DbTableInfo } from './db-api.js';
import type { DbCell } from './db-csv.js';
import { ServerTarget, type SslMode } from './db-server.js';

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

/** 테이블 찾기: 대소문자 무시 부분 일치, 이름 앞부분이 맞는 것을 먼저(같은 무리 안에서는 원래 순서). 빈 글이면 그대로 */
export function filterTables<T extends Pick<DbTableInfo, 'name'>>(tables: readonly T[], query: string): readonly T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return tables;
  const hits = tables.filter((t) => t.name.toLowerCase().includes(q));
  return [...hits.filter((t) => t.name.toLowerCase().startsWith(q)), ...hits.filter((t) => !t.name.toLowerCase().startsWith(q))];
}

/** 서버 폼의 SSL 고르기 아래 설명 한 줄(RDS 호스트면 RDS 에 맞게) */
export function sslHelp(mode: SslMode, host: string): string {
  const rds = ServerTarget.isAwsRdsHost(host);
  switch (mode) {
    case 'off':
      return rds ? 'Amazon RDS usually requires SSL. Pick "SSL + verify certificate" (Rauha trusts the Amazon RDS CA).' : 'Not encrypted. Fine for localhost or a private network/VPN.';
    case 'require':
      return 'Encrypted, but Rauha does not check who the server is (like sslmode=require). Use when the server has a self-signed certificate.';
    case 'verify':
      return rds ? 'Encrypted and the certificate is checked against the Amazon RDS CA bundle built into Rauha.' : 'Encrypted and the server certificate is checked against trusted CAs (like sslmode=verify-full).';
  }
}

const JSONISH = /^\s*[[{]/;
/** 칸 상세 보기 글: JSON 이면 들여 써서 펼치고, 아니면 그대로(NULL · 숫자 · BLOB 은 cellText) */
export function cellDetail(cell: DbCell): string {
  if (typeof cell !== 'string' || !JSONISH.test(cell)) return cellText(cell);
  try {
    return JSON.stringify(JSON.parse(cell), null, 2);
  } catch {
    return cell;
  }
}

/** 칸 하나를 복사할 글(NULL 은 NULL, BLOB 은 x'..' 미리보기) */
export function cellCopyText(cell: DbCell): string {
  if (cell !== null && typeof cell === 'object') return cell.preview;
  return cellText(cell);
}

/** 행 여러 개를 탭으로 나눈 글로(시트에 붙여 넣기). 칸 안의 탭·줄바꿈은 공백으로 */
export function rowsAsTsv(columns: readonly string[], rows: readonly (readonly DbCell[])[], withHeader: boolean): string {
  const clean = (v: string): string => v.replace(/[\t\r\n]+/g, ' ');
  const lines = rows.map((r) => r.map((c) => clean(cellCopyText(c))).join('\t'));
  return (withHeader ? [columns.map(clean).join('\t'), ...lines] : lines).join('\n');
}
