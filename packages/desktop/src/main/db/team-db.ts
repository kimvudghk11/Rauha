import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DbTableName, type DbDialect, type DbToolReply, type LinkedDatabase } from '@rauha/core';
import type { DbFailure, DbResult, DbResultSet, DbTableDetail } from '../../shared/db-api.js';
import type { DbConnections } from '../../shared/db-connections.js';
import type { DbCell } from '../../shared/db-csv.js';
import { REPO_ENV_FILES, REPO_ENV_MAX_CHARS, RepoDbHints, RepoDbMatch, looksLikeProduction, type RepoEnvFile } from '../../shared/repo-db-match.js';

/** 팀원 DB 도구가 쓰는 DB 서비스 부분(DbService). 모든 SQL 은 query 를 지나 읽기 전용 검사(db-sql)·읽기 전용 트랜잭션을 받는다. */
export interface TeamDbSource {
  connections(): Promise<DbConnections>;
  /** 비밀번호를 묻지 않고 바로 열 수 있는지 */
  canOpen(id: string): Promise<boolean>;
  detail(raw: unknown): Promise<DbResult<DbTableDetail>>;
  query(raw: unknown): Promise<DbResult<DbResultSet>>;
}

/** 조회 결과를 팀원에게 보일 때의 행 상한 */
const SELECT_MAX_ROWS = 100;
/** 카탈로그(테이블·인덱스) 결과 행 상한 */
const CATALOG_MAX_ROWS = 500;
const QUERY_TIMEOUT_SEC = 15;
const SQLITE_INDEX_MAX = 40;

const cellText = (c: DbCell): string => {
  if (c === null) return 'NULL';
  if (typeof c === 'number') return String(c);
  if (typeof c === 'string') return c.replace(/\r?\n|\r|\t/g, ' ');
  return `<blob ${c.blob} bytes>`;
};

/** 결과 표 → 글: 머리줄 + 행(칸은 " | " 로) + 몇 행인지 */
export function resultText(set: DbResultSet, maxRows: number): string {
  if (set.columns.length === 0) return '(no result rows)';
  const shown = set.rows.slice(0, maxRows);
  const lines = [set.columns.join(' | '), ...shown.map((r) => r.map(cellText).join(' | '))];
  const more = set.rows.length > shown.length || set.truncated !== null;
  lines.push(`(${shown.length} row${shown.length === 1 ? '' : 's'}${more ? ` shown; more rows exist, narrow the query` : ''})`);
  return lines.join('\n');
}

/** 화면용 실패 글을 팀원에게. 쓰기 막힘은 읽기 전용이라고 분명히 알린다. 접속 정보는 이미 가려져 있다(db-api failure). */
function failureText(f: DbFailure): string {
  const readOnly = f.kind === 'write-mode' || f.kind === 'confirm' || f.kind === 'blocked' ? 'Refused: these tools are read-only. ' : '';
  return `${readOnly}${f.title}: ${f.message}`;
}

const reply = <T>(r: DbResult<T>, text: (data: T) => string): DbToolReply => (r.ok ? { ok: true, text: text(r.data) } : { ok: false, text: failureText(r.failure) });

/** 방언별 카탈로그 질의. 테이블 이름은 DbTableName 이 따옴표 없는 값만 허락해서 문자열 값으로 그대로 넣는다. */
const CATALOG = {
  tables: {
    sqlite: "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    mysql: 'SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS AS estimated_rows FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
    postgres:
      "SELECT c.relname AS name, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'p' THEN 'partitioned table' ELSE 'table' END AS kind, c.reltuples::bigint AS estimated_rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY c.relname",
  },
  foreignKeys: {
    sqlite: (t: DbTableName) => `PRAGMA foreign_key_list(${t.literal()})`,
    mysql: (t: DbTableName) => `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${t.literal()} AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
    postgres: (t: DbTableName) => `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = ${t.literal()} AND con.contype = 'f' ORDER BY con.conname`,
  },
  indexes: {
    mysql: (t: DbTableName) => `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${t.literal()} ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    postgres: (t: DbTableName) => `SELECT i.relname AS name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary, pg_get_indexdef(ix.indexrelid) AS definition FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() AND t.relname = ${t.literal()} ORDER BY i.relname`,
  },
} as const;

/** SQLite 문자열 값(작은따옴표를 두 번) */
const sqliteText = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * 작업 레포에 연결된 DB 하나를 팀원 도구 모양(LinkedDatabase)으로. 연결 id·주소·비밀번호는 이 객체 안에만 있고 밖으로는 결과 글만 나간다.
 * 모든 질의는 DbService.query(읽기 전용 검사 + 읽기 전용 트랜잭션 + 행·크기 상한)를 지난다.
 */
export class TeamDatabase implements LinkedDatabase {
  /** 연결 id 와 서비스는 글·JSON 으로 바뀌어도 드러나지 않게 # 필드에 둔다 */
  readonly #source: TeamDbSource;
  readonly #id: string;

  private constructor(
    source: TeamDbSource,
    id: string,
    readonly dialect: DbDialect,
    readonly name: string,
    readonly production: boolean,
  ) {
    this.#source = source;
    this.#id = id;
  }

  static of(source: TeamDbSource, o: { readonly id: string; readonly dialect: DbDialect; readonly name: string; readonly production: boolean }): TeamDatabase {
    return new TeamDatabase(source, o.id, o.dialect, o.name, o.production);
  }

  private get source(): TeamDbSource {
    return this.#source;
  }

  private run(sql: string): Promise<DbResult<DbResultSet>> {
    return this.#source.query({ id: this.#id, sql, writeMode: false, confirm: false, timeoutSec: QUERY_TIMEOUT_SEC });
  }

  async tables(): Promise<DbToolReply> {
    return reply(await this.run(CATALOG.tables[this.dialect]), (s) => resultText(s, CATALOG_MAX_ROWS));
  }

  async describe(table: DbTableName): Promise<DbToolReply> {
    const detail = await this.source.detail({ id: this.#id, table: table.value });
    if (!detail.ok) return reply(detail, () => '');
    const d = detail.data;
    const columns = d.columns.map((c) => `${c.name} ${c.type}${c.notNull ? ' NOT NULL' : ''}${c.defaultValue !== null ? ` DEFAULT ${c.defaultValue}` : ''}${c.primaryKey > 0 ? ` PRIMARY KEY(${c.primaryKey})` : ''}${c.hidden ? ' GENERATED/HIDDEN' : ''}`);
    const fks = await this.run(CATALOG.foreignKeys[this.dialect](table));
    const fkText = fks.ok ? (fks.data.rows.length === 0 ? 'none' : resultText(fks.data, CATALOG_MAX_ROWS)) : `not available (${failureText(fks.failure)})`;
    return { ok: true, text: [`${d.kind} ${d.name}`, 'columns:', ...columns.map((c) => `  ${c}`), 'foreign keys:', fkText].join('\n') };
  }

  async indexes(table: DbTableName): Promise<DbToolReply> {
    if (this.dialect !== 'sqlite') return reply(await this.run(CATALOG.indexes[this.dialect](table)), (s) => (s.rows.length === 0 ? `no indexes on ${table.value}` : resultText(s, CATALOG_MAX_ROWS)));
    const list = await this.run(`PRAGMA index_list(${table.literal()})`);
    if (!list.ok) return reply(list, () => '');
    const nameAt = list.data.columns.indexOf('name');
    const uniqueAt = list.data.columns.indexOf('unique');
    const originAt = list.data.columns.indexOf('origin');
    if (list.data.rows.length === 0) return { ok: true, text: `no indexes on ${table.value}` };
    const lines: string[] = [];
    for (const row of list.data.rows.slice(0, SQLITE_INDEX_MAX)) {
      const name = String(row[nameAt] ?? '');
      const cols = await this.run(`PRAGMA index_info(${sqliteText(name)})`);
      const colAt = cols.ok ? cols.data.columns.indexOf('name') : -1;
      const colNames = cols.ok ? cols.data.rows.map((r) => cellText(r[colAt] ?? null)).join(', ') : '?';
      lines.push(`${name} (${colNames})${row[uniqueAt] === 1 ? ' UNIQUE' : ''}${originAt >= 0 ? ` origin=${cellText(row[originAt] ?? null)}` : ''}`);
    }
    return { ok: true, text: lines.join('\n') };
  }

  async sample(table: DbTableName, rows: number): Promise<DbToolReply> {
    return reply(await this.run(`SELECT * FROM ${table.quoted(this.dialect)} LIMIT ${rows}`), (s) => resultText(s, rows));
  }

  async select(sql: string): Promise<DbToolReply> {
    return reply(await this.run(sql), (s) => resultText(s, SELECT_MAX_ROWS));
  }

  async explain(statement: string): Promise<DbToolReply> {
    return reply(await this.run(statement), (s) => resultText(s, SELECT_MAX_ROWS));
  }
}

/** 레포 맨 위 설정 파일(.env 등)을 읽는다. 없거나 못 읽으면 건너뛴다. 이 글은 연결 고르기에만 쓰고 팀원에게 보내지 않는다. */
export async function readRepoEnvFiles(root: string): Promise<RepoEnvFile[]> {
  const out: RepoEnvFile[] = [];
  for (const name of REPO_ENV_FILES) {
    try {
      out.push({ name, text: (await readFile(join(root, name), 'utf8')).slice(0, REPO_ENV_MAX_CHARS) });
    } catch {
      /* 없는 파일 */
    }
  }
  return out;
}

/**
 * 작업 레포에 연결된 DB 를 찾는다: DB 탭에 저장한 연결 중 레포 설정과 맞고(RepoDbMatch) 비밀번호를 묻지 않고 열 수 있는 것.
 * 없으면 null(팀원에게 아무것도 붙지 않는다).
 */
export async function linkRepoDatabase(root: string, source: TeamDbSource, readEnv: (root: string) => Promise<readonly RepoEnvFile[]> = readRepoEnvFiles): Promise<LinkedDatabase | null> {
  const connections = await source.connections();
  if (connections.list().length === 0) return null;
  const view = RepoDbMatch.pick(connections, RepoDbHints.fromEnvFiles(await readEnv(root)), root);
  if (view === null || !(await source.canOpen(view.id))) return null;
  const at = connections.locate(view.id);
  if (at === undefined) return null;
  const dialect: DbDialect = at.kind === 'file' ? 'sqlite' : at.target.kind;
  const name = at.kind === 'file' ? at.path.fileName() : at.target.database;
  const production = looksLikeProduction(view.name, ...(at.kind === 'server' ? at.target.addresses.list().map((a) => `${a.host} ${a.label ?? ''}`) : []));
  return TeamDatabase.of(source, { id: view.id, dialect, name, production });
}
