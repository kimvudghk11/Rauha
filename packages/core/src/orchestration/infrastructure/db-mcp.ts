import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DomainError } from '../../shared/domain-error.js';
import { DB_SAMPLE_MAX_ROWS, DbProbeSql, DbSampleSize, DbTableName, DbToolText, type DbDialect } from '../domain/db-tools.js';
import type { DbToolReply, LinkedDatabase } from '../application/linked-database.js';

/** 팀원에게 붙이는 DB 도구 서버 이름. 도구는 mcp__rauha_db__<이름> 이다. */
export const DB_SERVER = 'rauha_db';
export const DB_TOOLS = ['tables', 'describe_table', 'indexes', 'sample_rows', 'select', 'explain'] as const;
type DbToolName = (typeof DB_TOOLS)[number];

interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const DIALECT_NAME: Readonly<Record<DbDialect, string>> = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' };

const result = (reply: DbToolReply): ToolResult => ({ content: [{ type: 'text', text: DbToolText.cap(reply.text) }], ...(reply.ok ? {} : { isError: true }) });

/** 입력 검사 실패는 그 이유를, 그 밖의 예외는 짧은 글만(드라이버 오류에 섞인 접속 정보를 내보내지 않는다) */
async function guarded(task: () => Promise<DbToolReply>): Promise<ToolResult> {
  try {
    return result(await task());
  } catch (error) {
    return result({ ok: false, text: error instanceof DomainError ? error.message : 'The database call failed unexpectedly.' });
  }
}

/** 도구별 처리: 입력 검사(도메인) → DB 에 묻기 → 결과 글 상한 */
export function dbToolHandlers(db: LinkedDatabase): Record<DbToolName, (args: Record<string, unknown>) => Promise<ToolResult>> {
  return {
    tables: () => guarded(() => db.tables()),
    describe_table: (a) => guarded(() => db.describe(DbTableName.parse(a['table']))),
    indexes: (a) => guarded(() => db.indexes(DbTableName.parse(a['table']))),
    sample_rows: (a) => guarded(() => db.sample(DbTableName.parse(a['table']), DbSampleSize.parse(a['rows']))),
    select: (a) => guarded(() => db.select(DbProbeSql.select(a['sql']))),
    explain: (a) => guarded(() => db.explain(DbProbeSql.explain(a['sql'], db.dialect))),
  };
}

/** 도구 설명 앞머리: 어떤 DB 인지(이름·종류만), 운영 DB 면 경고 */
export function dbToolDescription(db: LinkedDatabase, what: string): string {
  const head = `Read-only ${DIALECT_NAME[db.dialect]} database "${db.name}" linked to this repository.`;
  const prod = db.production ? ' PRODUCTION database: run only light queries (LIMIT, filter on indexed columns, no large scans).' : '';
  return `${head}${prod} ${what}`;
}

const TABLE = { table: z.string().describe('Table or view name') };
const SQL = { sql: z.string().describe('One SQL statement') };

/** 레포에 연결된 DB 를 팀원이 읽기 전용으로 보는 in-process MCP 서버 */
export function dbToolServer(db: LinkedDatabase): { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] } {
  const h = dbToolHandlers(db);
  const d = (what: string) => dbToolDescription(db, what);
  const server = createSdkMcpServer({
    name: DB_SERVER,
    tools: [
      tool('tables', d('List tables and views (with estimated row counts where the database keeps them).'), {}, () => h.tables({})),
      tool('describe_table', d('Columns of a table: name, type, NOT NULL, default, primary key, and foreign keys.'), TABLE, (a) => h.describe_table(a)),
      tool('indexes', d('Indexes of a table with their columns, uniqueness and definition.'), TABLE, (a) => h.indexes(a)),
      tool('sample_rows', d(`A few rows of a table (default 10, max ${DB_SAMPLE_MAX_ROWS}). Rows may hold personal data: never copy values into code, tests or reports.`), { ...TABLE, rows: z.number().int().min(1).max(DB_SAMPLE_MAX_ROWS).optional() }, (a) => h.sample_rows(a)),
      tool('select', d('Run one read-only statement (SELECT, WITH, SHOW). Writes, DDL and EXPLAIN ANALYZE are refused. Always add LIMIT.'), SQL, (a) => h.select(a)),
      tool('explain', d('Query plan of a SELECT without running it (PostgreSQL EXPLAIN (FORMAT JSON), MySQL EXPLAIN FORMAT=JSON, SQLite EXPLAIN QUERY PLAN). Send the SELECT only; ANALYZE is refused.'), SQL, (a) => h.explain(a)),
    ],
  });
  return { servers: { [DB_SERVER]: server }, tools: DB_TOOLS.map((n) => `mcp__${DB_SERVER}__${n}`) };
}

/** 도구 묶음에 DB 서버를 더한다. 연결된 DB 가 없으면 그대로(아무것도 붙지 않는다). */
export function withDatabase<T extends { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] }>(kits: T, db: LinkedDatabase | null): T {
  if (db === null) return kits;
  const added = dbToolServer(db);
  return { ...kits, servers: { ...kits.servers, ...added.servers }, tools: [...kits.tools, ...added.tools] };
}
