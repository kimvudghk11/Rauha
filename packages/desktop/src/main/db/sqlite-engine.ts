import { DB_LIMITS, type DbColumnInfo, type DbResultSet, type DbRowsPage, type DbTableDetail, type DbTableInfo } from '../../shared/db-api.js';
import type { DbCell } from '../../shared/db-csv.js';
import { GRAPH_MAX_TABLES, SchemaGraph, type DbSchemaGraph } from '../../shared/db-diagram.js';
import { quoteIdent } from '../../shared/db-names.js';
import { BLOCKED_FUNCTIONS, isSafePragma, pragmaTakesArgument, SqlStatement, type SqlKind } from '../../shared/db-sql.js';

/**
 * SQLite 엔진: Node 에 들어 있는 node:sqlite 를 쓴다(네이티브 모듈을 따로 싣지 않는다).
 * 이 파일은 "자식 프로세스" 안에서만 돈다 — 끝나지 않는 쿼리는 부모가 프로세스를 죽여 멈춘다(sqlite-runner.ts).
 * 문장은 부모가 이미 한 번 검사(SqlStatement)했고, 여기서는 읽기 전용 열기 + SQLite 인가 함수로 한 번 더 막는다.
 */

export type EngineRequest =
  | { readonly op: 'tables'; readonly file: string }
  | { readonly op: 'detail'; readonly file: string; readonly table: string }
  | { readonly op: 'graph'; readonly file: string }
  | { readonly op: 'rows'; readonly file: string; readonly table: string; readonly page: number; readonly sort: { readonly column: string; readonly dir: 'asc' | 'desc' } | null }
  | { readonly op: 'query'; readonly file: string; readonly sql: string; readonly writable: boolean; readonly kind: SqlKind; readonly verb: string; readonly hooks?: EngineTestHooks };

/** 시험 전용: 방어 층을 하나씩 꺼서 나머지 층만으로도 막히는지 본다(앱은 쓰지 않는다) */
export interface EngineTestHooks {
  /** SQLite 인가 함수가 없는 Node(예: CI 의 Node 22)를 흉내 낸다 */
  readonly noAuthorizer?: boolean;
  /** 엔진 안의 문장 검사를 건너뛴다(인가 함수만으로 막히는지 본다) */
  readonly noStatementCheck?: boolean;
  /** SQLite 길이·ATTACH 한계(limits 옵션, Node 24+)와 메모리 상한 PRAGMA 가 없는 환경을 흉내 낸다 */
  readonly noLimits?: boolean;
}

export type EngineResponse =
  | { readonly ok: true; readonly data: readonly DbTableInfo[] | DbTableDetail | DbRowsPage | DbResultSet | DbSchemaGraph | true }
  | { readonly ok: false; readonly code: 'no-engine' | 'error'; readonly message: string };

// node:sqlite 의 타입(@types/node 22 에는 없는 부분이 있어 필요한 것만 직접 적는다)
interface Statement {
  columns(): readonly { readonly name: string }[];
  setReturnArrays(on: boolean): void;
  setReadBigInts(on: boolean): void;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { readonly changes: number | bigint };
  iterate(...params: unknown[]): IterableIterator<unknown>;
}
interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
  setAuthorizer?(callback: ((action: number, a1: string | null, a2: string | null, dbName: string | null, trigger: string | null) => number) | null): void;
  enableDefensive?(on: boolean): void;
}
interface SqliteModule {
  readonly DatabaseSync: new (path: string, options?: Record<string, unknown>) => Database;
  readonly constants: Readonly<Record<string, number>>;
}

export function loadSqlite(): SqliteModule | null {
  try {
    return (process.getBuiltinModule('node:sqlite') as unknown as SqliteModule | undefined) ?? null;
  } catch {
    return null;
  }
}

const MB = 1024 * 1024;

function openDatabase(sqlite: SqliteModule, file: string, writable: boolean, noLimits = false): Database {
  const db = new sqlite.DatabaseSync(file, {
    readOnly: !writable,
    timeout: 2000,
    allowExtension: false,
    enableForeignKeyConstraints: true,
    // 모르는 파일을 열 때의 안전판: 값 하나 64MB, ATTACH 불가, 식·복합 SELECT 깊이 제한
    ...(noLimits ? {} : { limits: { length: 64 * MB, sqlLength: 200_000, attach: 0, exprDepth: 200, compoundSelect: 100, functionArg: 32 } }),
  });
  try {
    db.enableDefensive?.(true);
  } catch {
    /* 오래된 Node 에는 없다: 읽기 전용 열기와 인가 함수가 막는다 */
  }
  // 스키마에 적힌 뷰·트리거가 안전하지 않은 함수를 못 부르게 하고, 메모리를 상한으로 묶는다
  db.exec('PRAGMA trusted_schema = OFF');
  if (!noLimits) db.exec(`PRAGMA hard_heap_limit = ${512 * MB}`);
  return db;
}

/** 사용자 SQL 용 인가: ATTACH·트랜잭션·허용 밖 PRAGMA·막는 함수는 거절하고, 읽기 전용이면 쓰기·구조 변경도 거절한다 */
function authorizer(c: Readonly<Record<string, number>>, writable: boolean): (action: number, a1: string | null, a2: string | null) => number {
  const OK = c['SQLITE_OK']!;
  const DENY = c['SQLITE_DENY']!;
  const write = new Set(
    [
      'SQLITE_INSERT', 'SQLITE_UPDATE', 'SQLITE_DELETE', 'SQLITE_ALTER_TABLE', 'SQLITE_REINDEX', 'SQLITE_ANALYZE', 'SQLITE_CREATE_VTABLE', 'SQLITE_DROP_VTABLE',
      'SQLITE_CREATE_INDEX', 'SQLITE_CREATE_TABLE', 'SQLITE_CREATE_TEMP_INDEX', 'SQLITE_CREATE_TEMP_TABLE', 'SQLITE_CREATE_TEMP_TRIGGER', 'SQLITE_CREATE_TEMP_VIEW', 'SQLITE_CREATE_TRIGGER', 'SQLITE_CREATE_VIEW',
      'SQLITE_DROP_INDEX', 'SQLITE_DROP_TABLE', 'SQLITE_DROP_TEMP_INDEX', 'SQLITE_DROP_TEMP_TABLE', 'SQLITE_DROP_TEMP_TRIGGER', 'SQLITE_DROP_TEMP_VIEW', 'SQLITE_DROP_TRIGGER', 'SQLITE_DROP_VIEW',
    ].map((n) => c[n]!),
  );
  const always = new Set(['SQLITE_ATTACH', 'SQLITE_DETACH', 'SQLITE_TRANSACTION', 'SQLITE_SAVEPOINT', 'SQLITE_COPY'].map((n) => c[n]!));
  const PRAGMA = c['SQLITE_PRAGMA']!;
  const FUNCTION = c['SQLITE_FUNCTION']!;
  return (action, a1, a2) => {
    if (always.has(action)) return DENY;
    if (action === PRAGMA) {
      const name = String(a1 ?? '');
      if (!isSafePragma(name)) return DENY;
      return !pragmaTakesArgument(name) && a2 !== null ? DENY : OK;
    }
    if (action === FUNCTION) return BLOCKED_FUNCTIONS.has(String(a2 ?? '').toLowerCase()) ? DENY : OK;
    if (write.has(action)) return writable ? OK : DENY;
    return OK;
  };
}

/**
 * 인가 함수를 건다. node:sqlite 의 setAuthorizer 는 Node 24.10+ 에만 있다(Electron 45 의 Node 24 에는 있고, CI 의 Node 22 에는 없다).
 * 없으면 걸지 않는다 — 그때는 읽기 전용 열기 + 엔진 안의 문장 검사(SqlStatement)가 막는다.
 */
function installAuthorizer(db: Database, sqlite: SqliteModule, writable: boolean, off = false): void {
  if (off || typeof db.setAuthorizer !== 'function') return;
  db.setAuthorizer(authorizer(sqlite.constants, writable));
}

function toCell(v: unknown, state: { cellsTruncated: boolean }): { readonly cell: DbCell; readonly size: number } {
  if (v === null || v === undefined) return { cell: null, size: 1 };
  if (typeof v === 'number') return { cell: v, size: 8 };
  if (typeof v === 'bigint') {
    const safe = v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER);
    return safe ? { cell: Number(v), size: 8 } : { cell: v.toString(), size: v.toString().length };
  }
  if (typeof v === 'string') {
    if (v.length > DB_LIMITS.maxCellChars) {
      state.cellsTruncated = true;
      const cut = `${v.slice(0, DB_LIMITS.maxCellChars)}…`;
      return { cell: cut, size: Buffer.byteLength(cut) };
    }
    return { cell: v, size: Buffer.byteLength(v) };
  }
  if (v instanceof Uint8Array) {
    const head = Buffer.from(v.subarray(0, 16)).toString('hex').toUpperCase();
    const preview = `x'${head}${v.length > 16 ? '…' : ''}'`;
    return { cell: { blob: v.length, preview }, size: preview.length + 8 };
  }
  return { cell: String(v), size: 8 };
}

interface Collected {
  readonly columns: readonly string[];
  readonly rows: DbCell[][];
  readonly truncated: 'rows' | 'bytes' | null;
  readonly cellsTruncated: boolean;
  readonly bytes: number;
}

/** 문장을 돌려 행을 모은다. 행·크기 상한에 닿으면 거기서 멈추고 truncated 로 알린다. */
function collect(stmt: Statement): Collected {
  const columns = stmt.columns().map((c) => c.name);
  if (columns.length > DB_LIMITS.maxColumns) throw new Error(`Too many columns (${columns.length}). Select fewer columns (up to ${DB_LIMITS.maxColumns}).`);
  stmt.setReturnArrays(true);
  stmt.setReadBigInts(true);
  const rows: DbCell[][] = [];
  const state = { cellsTruncated: false };
  let bytes = columns.reduce((n, c) => n + c.length, 0);
  let truncated: 'rows' | 'bytes' | null = null;
  for (const raw of stmt.iterate()) {
    if (rows.length >= DB_LIMITS.maxRows) {
      truncated = 'rows';
      break;
    }
    const row: DbCell[] = [];
    for (const v of raw as unknown[]) {
      const { cell, size } = toCell(v, state);
      row.push(cell);
      bytes += size;
    }
    if (bytes > DB_LIMITS.maxBytes) {
      truncated = 'bytes';
      break;
    }
    rows.push(row);
  }
  return { columns, rows, truncated, cellsTruncated: state.cellsTruncated, bytes };
}

function resultOf(c: Collected, started: number, kind: SqlKind, verb: string, changes: number | null): DbResultSet {
  return { columns: c.columns, rows: c.rows, truncated: c.truncated, cellsTruncated: c.cellsTruncated, bytes: c.bytes, elapsedMs: Math.max(0, Math.round(performance.now() - started)), changes, kind, verb };
}

function schemaEntry(db: Database, table: string): { readonly kind: 'table' | 'view'; readonly sql: string | null } {
  const row = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = ? AND type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").get(table) as { type: 'table' | 'view'; sql: string | null } | undefined;
  if (row === undefined) throw new Error(`no such table: ${table}`);
  return { kind: row.type, sql: row.sql };
}

function columnsOf(db: Database, table: string): DbColumnInfo[] {
  const stmt = db.prepare('SELECT name, type, "notnull" AS nn, dflt_value, pk, hidden FROM pragma_table_xinfo(?)');
  return (stmt.all(table) as { name: string; type: string; nn: number; dflt_value: string | null; pk: number; hidden: number }[]).map((r) => ({
    name: r.name,
    type: r.type,
    notNull: r.nn === 1,
    defaultValue: r.dflt_value,
    primaryKey: r.pk,
    hidden: r.hidden !== 0,
  }));
}

export function runEngine(req: EngineRequest): EngineResponse {
  const sqlite = loadSqlite();
  if (sqlite === null) return { ok: false, code: 'no-engine', message: 'node:sqlite is not available' };
  let db: Database | null = null;
  try {
    db = openDatabase(sqlite, req.file, req.op === 'query' && req.writable, req.op === 'query' && req.hooks?.noLimits === true);
    switch (req.op) {
      case 'tables': {
        installAuthorizer(db, sqlite, false);
        const rows = db.prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name").all() as { name: string; type: 'table' | 'view' }[];
        return { ok: true, data: rows.map((r) => ({ name: r.name, kind: r.type })) };
      }
      case 'detail': {
        const entry = schemaEntry(db, req.table);
        installAuthorizer(db, sqlite, false);
        return { ok: true, data: { name: req.table, kind: entry.kind, columns: columnsOf(db, req.table), createSql: entry.sql } };
      }
      case 'graph': {
        installAuthorizer(db, sqlite, false);
        const tables = db.prepare(`SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name LIMIT ${GRAPH_MAX_TABLES + 1}`).all() as { name: string; type: string }[];
        const cols = db.prepare('SELECT name, type, pk FROM pragma_table_info(?)');
        const fks = db.prepare('SELECT id, "table" AS ref, "from" AS col, "to" AS refcol FROM pragma_foreign_key_list(?) ORDER BY id, seq');
        const columns: [string, string, string][] = [];
        const keys: [string, string, number][] = [];
        const links: [string, string, string, string, string][] = [];
        for (const t of tables.slice(0, GRAPH_MAX_TABLES)) {
          for (const c of cols.all(t.name) as { name: string; type: string; pk: number }[]) {
            columns.push([t.name, c.name, c.type]);
            if (c.pk > 0) keys.push([t.name, c.name, c.pk]);
          }
          if (t.type !== 'table') continue;
          for (const f of fks.all(t.name) as { id: number; ref: string; col: string; refcol: string | null }[]) links.push([`fk${f.id}`, t.name, f.col, f.ref, f.refcol ?? '']);
        }
        return { ok: true, data: SchemaGraph.fromRows({ tables: tables.map((t) => [t.name, t.type] as const), columns, keys, links }).toJSON() };
      }
      case 'rows': {
        const started = performance.now();
        schemaEntry(db, req.table);
        installAuthorizer(db, sqlite, false);
        const names = columnsOf(db, req.table).map((c) => c.name);
        let order = '';
        if (req.sort !== null) {
          if (!names.includes(req.sort.column)) throw new Error(`no such column: ${req.sort.column}`);
          order = ` ORDER BY ${quoteIdent(req.sort.column)} ${req.sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
        }
        const from = quoteIdent(req.table);
        const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${from}`).get() as { n: number | bigint }).n);
        const page = db.prepare(`SELECT * FROM ${from}${order} LIMIT ${DB_LIMITS.pageSize} OFFSET ${req.page * DB_LIMITS.pageSize}`);
        const result = resultOf(collect(page), started, 'read', 'SELECT', null);
        return { ok: true, data: { result, total, page: req.page, pageSize: DB_LIMITS.pageSize } };
      }
      case 'query': {
        const started = performance.now();
        // 부모가 이미 검사했지만, 이 프로세스에서도 같은 검사를 한 번 더 한다(인가 함수가 없는 Node 에서는 이것이 읽기/쓰기 구분의 방어선이다)
        if (req.hooks?.noStatementCheck !== true) SqlStatement.parse(req.sql).assertAllowed({ writeMode: req.writable, confirm: true });
        installAuthorizer(db, sqlite, req.writable, req.hooks?.noAuthorizer === true);
        const stmt = db.prepare(req.sql);
        if (stmt.columns().length === 0) {
          const info = stmt.run();
          return { ok: true, data: resultOf({ columns: [], rows: [], truncated: null, cellsTruncated: false, bytes: 0 }, started, req.kind, req.verb, Number(info.changes)) };
        }
        return { ok: true, data: resultOf(collect(stmt), started, req.kind, req.verb, null) };
      }
    }
    throw new Error('Unknown database action.');
  } catch (error) {
    return { ok: false, code: 'error', message: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      db?.close();
    } catch {
      /* 이미 닫혔다 */
    }
  }
}
