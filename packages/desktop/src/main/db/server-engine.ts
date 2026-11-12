import { DB_LIMITS, type DbColumnInfo, type DbResultSet, type DbRowsPage, type DbTableDetail, type DbTableInfo } from '../../shared/db-api.js';
import type { DbCell } from '../../shared/db-csv.js';
import type { DbPassword, ServerKind, ServerTarget } from '../../shared/db-server.js';
import { SqlStatement, type SqlKind } from '../../shared/db-sql.js';
import type { RunOutcome } from './sqlite-runner.js';

/**
 * MySQL·PostgreSQL 엔진: SQLite 엔진(sqlite-engine.ts)과 같은 요청(테이블 · 스키마 · 행 · 쿼리)을 받아 같은 모양으로 돌려준다.
 * 서버 드라이버(mysql2 · pg)는 비동기라 main 프로세스에서 돈다. 요청마다 연결을 새로 열고 끝나면 닫는다.
 * 읽기는 읽기 전용 트랜잭션 안에서 돌리고 ROLLBACK 한다(문장 검사가 놓친 쓰기도 서버가 막는다). 쓰기는 쓰기 모드 + 확인이 있을 때만 그대로 돈다.
 * 시간이 지나거나 취소하면 연결째 끊는다. 비밀번호는 드라이버에만 넘기고, 오류 글에 섞여 있으면 지운다.
 */

export const CONNECT_TIMEOUT_MS = 10_000;
/** 목록·스키마처럼 안쪽에서 읽는 결과의 행 상한 */
const CATALOG_MAX_ROWS = 20_000;

/** 드라이버가 행을 하나씩 넘기는 곳. row 가 false 를 돌려주면 드라이버는 더 받지 않고(연결을 끊어도 된다) stopped 로 끝낸다. */
export interface RowSink {
  columns(names: readonly string[]): void;
  row(values: readonly unknown[]): boolean;
}

/** 연결 하나. 드라이버(mysql2 · pg)를 이 모양으로 감싼다. */
export interface ServerSession {
  /** 문장 하나를 돌린다. params 는 드라이버의 자리표시자(? · $1)에 들어간다 */
  run(sql: string, params: readonly unknown[], sink: RowSink): Promise<{ readonly changes: number | null; readonly stopped: boolean }>;
  close(): Promise<void>;
  /** 바로 끊는다(시간 초과 · 취소). 돌던 run 은 실패로 끝난다 */
  destroy(): void;
}

export interface ServerDriver {
  connect(o: { readonly target: ServerTarget; readonly password: string; readonly connectTimeoutMs: number; readonly statementTimeoutMs: number }): Promise<ServerSession>;
}

export type ServerRequest =
  | { readonly op: 'ping' }
  | { readonly op: 'tables' }
  | { readonly op: 'detail'; readonly table: string }
  | { readonly op: 'rows'; readonly table: string; readonly page: number; readonly sort: { readonly column: string; readonly dir: 'asc' | 'desc' } | null }
  | { readonly op: 'query'; readonly sql: string; readonly writable: boolean; readonly kind: SqlKind; readonly verb: string };

export interface ServerConnection {
  readonly target: ServerTarget;
  readonly password: DbPassword;
}

/** 서비스가 쓰는 모양(시험에서는 가짜로 바꾼다) */
export interface ServerRunner {
  run(conn: ServerConnection, req: ServerRequest, o: { readonly timeoutMs: number; readonly key?: string | null }): Promise<RunOutcome>;
  cancel(key: string): boolean;
  stopAll(): void;
}

// ── 서버별 문법 ──

interface Dialect {
  quote(name: string): string;
  /** n 번째(1부터) 자리표시자 */
  param(n: number): string;
  readonly beginRead: readonly string[];
  tablesSql(oneTable: boolean): string;
  detail(session: ServerSession, table: string, kind: 'table' | 'view'): Promise<{ readonly columns: DbColumnInfo[]; readonly createSql: string | null }>;
}

const mysql: Dialect = {
  quote: (name) => `\`${name.replace(/`/g, '``')}\``,
  param: () => '?',
  beginRead: ['SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION READ ONLY'],
  tablesSql: (one) => `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()${one ? ' AND TABLE_NAME = ?' : ''} ORDER BY TABLE_TYPE, TABLE_NAME`,
  async detail(session, table) {
    const cols = await all(session, 'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [table]);
    const keys = await all(session, "SELECT COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'", [table]);
    const pk = new Map(keys.map((k) => [String(k[0]), Number(k[1])]));
    let createSql: string | null = null;
    try {
      const shown = await all(session, `SHOW CREATE TABLE ${mysql.quote(table)}`, []);
      createSql = typeof shown[0]?.[1] === 'string' ? shown[0][1] : null;
    } catch {
      /* 권한이 없으면 CREATE 문 없이 보인다 */
    }
    return {
      columns: cols.map((c) => ({ name: String(c[0]), type: textOf(c[1]), notNull: c[2] === 'NO', defaultValue: c[3] === null || c[3] === undefined ? null : textOf(c[3]), primaryKey: pk.get(String(c[0])) ?? 0, hidden: /GENERATED|INVISIBLE/i.test(textOf(c[4])) })),
      createSql,
    };
  },
};

const postgres: Dialect = {
  quote: (name) => `"${name.replace(/"/g, '""')}"`,
  param: (n) => `$${n}`,
  beginRead: ['BEGIN READ ONLY'],
  tablesSql: (one) => `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema()${one ? ' AND table_name = $1' : ''} ORDER BY table_type, table_name`,
  async detail(session, table, kind) {
    const cols = await all(
      session,
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.is_generated,
  COALESCE((SELECT k.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema AND k.table_name = tc.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND k.column_name = c.column_name), 0) AS pk
FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = $1 ORDER BY c.ordinal_position`,
      [table],
    );
    let createSql: string | null = null;
    if (kind === 'view') {
      const def = await all(session, 'SELECT pg_get_viewdef(c.oid, true) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = $1', [table]);
      createSql = typeof def[0]?.[0] === 'string' ? `CREATE VIEW ${postgres.quote(table)} AS\n${def[0][0]}` : null;
    }
    return {
      columns: cols.map((c) => ({ name: String(c[0]), type: textOf(c[1]), notNull: c[2] === 'NO', defaultValue: c[3] === null || c[3] === undefined ? null : textOf(c[3]), primaryKey: Number(c[5] ?? 0), hidden: c[4] === 'ALWAYS' })),
      createSql,
    };
  },
};

const DIALECTS: Readonly<Record<ServerKind, Dialect>> = { mysql, postgres };

// ── 값 바꾸기 · 결과 모으기 ──

const textOf = (v: unknown): string => (v === null || v === undefined ? '' : Buffer.isBuffer(v) ? v.toString('utf8') : String(v));

function cut(text: string, state: { cellsTruncated: boolean }): { readonly cell: DbCell; readonly size: number } {
  if (text.length <= DB_LIMITS.maxCellChars) return { cell: text, size: Buffer.byteLength(text) };
  state.cellsTruncated = true;
  const short = `${text.slice(0, DB_LIMITS.maxCellChars)}…`;
  return { cell: short, size: Buffer.byteLength(short) };
}

/** 서버 값 하나를 표 칸으로: 날짜는 ISO 글, 참거짓은 true/false, JSON·배열은 JSON 글, 바이트는 BLOB 미리보기 */
export function serverCell(v: unknown, state: { cellsTruncated: boolean }): { readonly cell: DbCell; readonly size: number } {
  if (v === null || v === undefined) return { cell: null, size: 1 };
  if (typeof v === 'number') return Number.isFinite(v) ? { cell: v, size: 8 } : { cell: String(v), size: 8 };
  if (typeof v === 'bigint') {
    const safe = v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER);
    return safe ? { cell: Number(v), size: 8 } : { cell: v.toString(), size: v.toString().length };
  }
  if (typeof v === 'string') return cut(v, state);
  if (typeof v === 'boolean') return { cell: v ? 'true' : 'false', size: 5 };
  if (v instanceof Date) return { cell: Number.isNaN(v.getTime()) ? 'Invalid date' : v.toISOString(), size: 24 };
  if (v instanceof Uint8Array) {
    const head = Buffer.from(v.subarray(0, 16)).toString('hex').toUpperCase();
    const preview = `x'${head}${v.length > 16 ? '…' : ''}'`;
    return { cell: { blob: v.length, preview }, size: preview.length + 8 };
  }
  try {
    return cut(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)) ?? String(v), state);
  } catch {
    return cut(String(v), state);
  }
}

/** 행·크기 상한에 닿으면 멈추는 결과 모으기 */
class Collector implements RowSink {
  names: readonly string[] = [];
  readonly rows: DbCell[][] = [];
  private readonly state = { cellsTruncated: false };
  bytes = 0;
  truncated: 'rows' | 'bytes' | null = null;

  columns(names: readonly string[]): void {
    if (names.length > DB_LIMITS.maxColumns) throw new Error(`Too many columns (${names.length}). Select fewer columns (up to ${DB_LIMITS.maxColumns}).`);
    this.names = names;
    this.bytes = names.reduce((n, c) => n + c.length, 0);
  }
  row(values: readonly unknown[]): boolean {
    if (this.rows.length >= DB_LIMITS.maxRows) {
      this.truncated = 'rows';
      return false;
    }
    const row: DbCell[] = [];
    let size = 0;
    for (const v of values) {
      const c = serverCell(v, this.state);
      row.push(c.cell);
      size += c.size;
    }
    if (this.bytes + size > DB_LIMITS.maxBytes) {
      this.truncated = 'bytes';
      return false;
    }
    this.bytes += size;
    this.rows.push(row);
    return true;
  }
  result(started: number, kind: SqlKind, verb: string, changes: number | null): DbResultSet {
    return { columns: this.names, rows: this.rows, truncated: this.truncated, cellsTruncated: this.state.cellsTruncated, bytes: this.bytes, elapsedMs: Math.max(0, Math.round(performance.now() - started)), changes, kind, verb };
  }
}

/** 안쪽 질의(목록·스키마)의 행을 그대로 모은다 */
async function all(session: ServerSession, sql: string, params: readonly unknown[]): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  await session.run(sql, params, { columns: () => undefined, row: (r) => rows.push([...r]) < CATALOG_MAX_ROWS });
  return rows;
}

const ignore: RowSink = { columns: () => undefined, row: () => true };

/** 오류 글에 비밀번호가 그대로 섞여 들어오면 지운다(너무 짧은 값은 다른 글을 망가뜨리니 그대로 둔다) */
function scrub(message: string, password: string): string {
  return password.length >= 3 ? message.split(password).join('[hidden]') : message;
}

// ── 엔진 ──

interface Live {
  session: ServerSession | null;
  cancelled: boolean;
  timedOut: boolean;
  /** 끊었거나 드라이버가 스스로 멈췄다(닫지 않는다) */
  dead: boolean;
}

export class ServerEngine implements ServerRunner {
  private readonly live = new Map<string, Live>();
  private readonly running = new Set<Live>();

  constructor(private readonly drivers: Readonly<Record<ServerKind, ServerDriver>>) {}

  async run(conn: ServerConnection, req: ServerRequest, o: { readonly timeoutMs: number; readonly key?: string | null }): Promise<RunOutcome> {
    const dialect = DIALECTS[conn.target.kind];
    const password = conn.password.reveal();
    const entry: Live = { session: null, cancelled: false, timedOut: false, dead: false };
    const key = o.key ?? null;
    if (key !== null) this.live.set(key, entry);
    this.running.add(entry);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      // 부모가 이미 검사했지만 엔진에서도 한 번 더(쓰기 허락 없이 온 쓰기 문장은 서버에 보내지 않는다)
      if (req.op === 'query') SqlStatement.parse(req.sql, conn.target.kind).assertAllowed({ writeMode: req.writable, confirm: true });
      const session = await this.connect(conn.target, password, o.timeoutMs);
      entry.session = session;
      if (entry.cancelled) {
        this.kill(entry);
        return { kind: 'cancelled' };
      }
      timer = setTimeout(() => {
        entry.timedOut = true;
        this.kill(entry);
      }, o.timeoutMs);
      // 드라이버가 상한 때문에 스스로 끊은 연결은 더 쓰지 않는다(되돌리기·닫기를 건너뛴다)
      const tracked: ServerSession = {
        run: async (sql, params, sink) => {
          const r = await session.run(sql, params, sink);
          if (r.stopped) entry.dead = true;
          return r;
        },
        close: () => session.close(),
        destroy: () => session.destroy(),
      };
      const data = await this.perform(tracked, dialect, req, entry);
      if (entry.cancelled) return { kind: 'cancelled' };
      if (entry.timedOut) return { kind: 'timeout' };
      return { kind: 'done', response: { ok: true, data } };
    } catch (error) {
      if (entry.cancelled) return { kind: 'cancelled' };
      if (entry.timedOut) return { kind: 'timeout' };
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'done', response: { ok: false, code: 'error', message: scrub(message, password) } };
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (key !== null && this.live.get(key) === entry) this.live.delete(key);
      this.running.delete(entry);
      if (entry.session !== null && !entry.dead) await entry.session.close().catch(() => undefined);
    }
  }

  /** 접속: 드라이버에 10초 제한을 주고, 드라이버가 그래도 멈추면 조금 뒤에 포기한다(늦게 열린 연결은 닫는다) */
  private connect(target: ServerTarget, password: string, timeoutMs: number): Promise<ServerSession> {
    return new Promise<ServerSession>((resolve, reject) => {
      let settled = false;
      const giveUp = setTimeout(() => {
        settled = true;
        reject(new Error(`Could not reach the server within ${CONNECT_TIMEOUT_MS / 1000} seconds.`));
      }, CONNECT_TIMEOUT_MS + 2000);
      this.drivers[target.kind].connect({ target, password, connectTimeoutMs: CONNECT_TIMEOUT_MS, statementTimeoutMs: timeoutMs }).then(
        (s) => {
          clearTimeout(giveUp);
          if (settled) s.destroy();
          else resolve(s);
        },
        (e: unknown) => {
          clearTimeout(giveUp);
          if (!settled) reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private kill(entry: Live): void {
    entry.dead = true;
    try {
      entry.session?.destroy();
    } catch {
      /* 이미 끊겼다 */
    }
  }

  /** 읽기 전용 트랜잭션 안에서 task 를 돌리고 되돌린다. 드라이버가 상한 때문에 스스로 끊었으면 되돌리기는 서버가 한다. */
  private async readOnly<T>(session: ServerSession, dialect: Dialect, entry: Live, task: () => Promise<T>): Promise<T> {
    for (const sql of dialect.beginRead) await session.run(sql, [], ignore);
    const out = await task();
    if (!entry.dead) await session.run('ROLLBACK', [], ignore);
    return out;
  }

  private async tableKind(session: ServerSession, dialect: Dialect, table: string): Promise<'table' | 'view'> {
    const found = await all(session, dialect.tablesSql(true), [table]);
    if (found[0] === undefined) throw new Error(`no such table: ${table}`);
    return found[0][1] === 'VIEW' ? 'view' : 'table';
  }

  private async perform(session: ServerSession, dialect: Dialect, req: ServerRequest, entry: Live): Promise<true | readonly DbTableInfo[] | DbTableDetail | DbRowsPage | DbResultSet> {
    switch (req.op) {
      case 'ping':
        return this.readOnly(session, dialect, entry, async () => {
          await session.run('SELECT 1', [], ignore);
          return true as const;
        });
      case 'tables':
        return this.readOnly(session, dialect, entry, async () => (await all(session, dialect.tablesSql(false), [])).map((r) => ({ name: String(r[0]), kind: r[1] === 'VIEW' ? ('view' as const) : ('table' as const) })));
      case 'detail':
        return this.readOnly(session, dialect, entry, async () => {
          const kind = await this.tableKind(session, dialect, req.table);
          const d = await dialect.detail(session, req.table, kind);
          return { name: req.table, kind, columns: d.columns, createSql: d.createSql };
        });
      case 'rows':
        return this.readOnly(session, dialect, entry, async () => {
          const started = performance.now();
          const kind = await this.tableKind(session, dialect, req.table);
          let order = '';
          if (req.sort !== null) {
            const names = (await dialect.detail(session, req.table, kind)).columns.map((c) => c.name);
            if (!names.includes(req.sort.column)) throw new Error(`no such column: ${req.sort.column}`);
            order = ` ORDER BY ${dialect.quote(req.sort.column)} ${req.sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
          }
          const from = dialect.quote(req.table);
          const counted = await all(session, `SELECT COUNT(*) FROM ${from}`, []);
          const total = Number(counted[0]?.[0] ?? 0);
          const page = new Collector();
          await session.run(`SELECT * FROM ${from}${order} LIMIT ${DB_LIMITS.pageSize} OFFSET ${req.page * DB_LIMITS.pageSize}`, [], page);
          return { result: page.result(started, 'read', 'SELECT', null), total: Number.isFinite(total) ? total : 0, page: req.page, pageSize: DB_LIMITS.pageSize };
        });
      case 'query': {
        const started = performance.now();
        const out = new Collector();
        const run = async (): Promise<DbResultSet> => {
          const r = await session.run(req.sql, [], out);
          return out.names.length > 0 ? out.result(started, req.kind, req.verb, null) : out.result(started, req.kind, req.verb, r.changes);
        };
        return req.writable ? run() : this.readOnly(session, dialect, entry, run);
      }
    }
  }

  cancel(key: string): boolean {
    const entry = this.live.get(key);
    if (entry === undefined) return false;
    entry.cancelled = true;
    this.live.delete(key);
    this.kill(entry);
    return true;
  }

  stopAll(): void {
    for (const entry of this.running) this.kill(entry);
  }
}
