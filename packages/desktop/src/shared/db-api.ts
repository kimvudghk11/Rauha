import { redactSecrets } from './chat-redact.js';
import { csvFileName } from './db-csv.js';
import type { DbCell } from './db-csv.js';
import type { DbConnectionView } from './db-connections.js';
import { ConnectionId, DbFilePath, DbInputError, PageNumber, SortSpec, TableName } from './db-names.js';
import { ConnectionLabel, DbPassword, ServerTarget } from './db-server.js';
import { SqlStatement, type SqlDialect, type SqlKind } from './db-sql.js';

/** DB 탭 IPC 채널. 화면은 연결 id 와 좁은 요청으로만 main 과 이야기하고, 파일 경로는 더하기·고르기 때만 보낸다. */
export const DB_IPC = {
  list: 'db:list',
  addPath: 'db:add-path',
  pick: 'db:pick',
  addServer: 'db:add-server',
  editServer: 'db:edit-server',
  testServer: 'db:test-server',
  unlock: 'db:unlock',
  remove: 'db:remove',
  tables: 'db:tables',
  detail: 'db:detail',
  rows: 'db:rows',
  query: 'db:query',
  cancel: 'db:cancel',
  exportCsv: 'db:export-csv',
} as const;

/** 크기·시간 상한(거대한 결과·끝없는 쿼리가 앱을 멈추지 않게) */
export const DB_LIMITS = {
  /** 결과 표에 가져오는 행 상한 */
  maxRows: 5000,
  /** 결과 크기 상한(대략, 바이트) */
  maxBytes: 5 * 1024 * 1024,
  /** 행 보기 한 쪽 */
  pageSize: 100,
  /** 칸 하나의 글자 상한(넘으면 잘라 보인다) */
  maxCellChars: 4000,
  defaultTimeoutSec: 10,
  maxTimeoutSec: 60,
  /** CSV 저장 상한 */
  maxCsvBytes: 20 * 1024 * 1024,
  /** 열 수 상한 */
  maxColumns: 500,
} as const;

/** 정직한 한계: 화면 위쪽에 늘 보이는 안내 */
export const DB_LIMIT_NOTE = 'SQLite files and MySQL / PostgreSQL servers. Everything opens read-only; results are capped at 5,000 rows or 5 MB and queries stop after the time limit.';

/** auth: 서버 로그인 실패 · no-server: 서버에 닿지 않음(주소·포트·VPN·SSL) · need-password: 저장한 비밀번호가 없어 물어야 한다 */
export type DbFailureKind = 'no-engine' | 'no-file' | 'not-sqlite' | 'busy' | 'timeout' | 'cancelled' | 'bad-input' | 'confirm' | 'write-mode' | 'blocked' | 'sql-error' | 'too-large' | 'failed' | 'auth' | 'no-server' | 'need-password';

/** 화면에 그대로 보여도 되는 실패 */
export interface DbFailure {
  readonly kind: DbFailureKind;
  readonly title: string;
  readonly message: string;
  readonly help: string | null;
}
export type DbResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: DbFailure };

/**
 * 연결 문자열·비밀번호가 든 글을 화면·기록에 내보내기 전에 가린다.
 * `scheme://user:비밀@host` → `scheme://user:[hidden]@host`, `password=…`(세미콜론·공백까지) → `password=[hidden]`, 토큰처럼 생긴 값.
 * 지금은 SQLite 파일만 열지만, 오류 글에 주소가 섞여 들어와도 새지 않게 모든 실패 글이 이 함수를 지난다.
 */
export function maskConnectionSecrets(text: string): string {
  const url = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]*):([^\s/@]*)@/gi, (_m, scheme: string, user: string) => `${scheme}${user}:[hidden]@`);
  const kv = url.replace(/\b(password|passwd|pwd|pass|secret|token|apikey|api_key|sslpassword)\s*=\s*(?:'[^']*'|"[^"]*"|[^;\s&]+)/gi, (_m, key: string) => `${key}=[hidden]`);
  return redactSecrets(kv);
}

const firstLines = (text: string, n: number): string => maskConnectionSecrets(text).trim().split(/\r?\n/).slice(0, n).join('\n');

export function failure(kind: DbFailureKind, title: string, message: string, help: string | null = null): DbFailure {
  return { kind, title, message: firstLines(message, 6), help };
}

/** 입력 검사에서 걸린 값을 화면에 보일 실패로 */
export function inputFailure(e: DbInputError): DbFailure {
  switch (e.kind) {
    case 'confirm':
      return failure('confirm', 'Confirmation needed', e.message);
    case 'write-mode':
      return failure('write-mode', 'Write mode is off', e.message, 'Turn on Write mode (top right) if you really want to change this database.');
    case 'blocked':
      return failure('blocked', 'That statement is not allowed', e.message);
    case 'bad-input':
      return failure('bad-input', 'That value cannot be used', e.message);
  }
}

/** 엔진(자식 프로세스)이 돌려준 SQLite 오류를 화면에 보일 실패로 가른다 */
export function engineFailure(message: string): DbFailure {
  const m = message;
  if (/file is not a database|file is encrypted|malformed database schema/i.test(m)) return failure('not-sqlite', 'Not a usable SQLite file', m, 'The file is not a SQLite database (or it is encrypted or damaged).');
  if (/database is locked|database table is locked|SQLITE_BUSY/i.test(m)) return failure('busy', 'The file is locked', m, 'Another program is writing to it. Close it there and try again.');
  if (/attempt to write a readonly database/i.test(m)) return failure('write-mode', 'The file is open read-only', m, 'Turn on Write mode (top right) to change this file.');
  if (/not authorized|authoriz/i.test(m)) return failure('blocked', 'That statement is not allowed', m);
  if (/string or blob too big|too many (columns|terms)|too large/i.test(m)) return failure('too-large', 'The value is too large', m);
  if (/unable to open database file|no such file/i.test(m)) return failure('no-file', 'Cannot open the file', m, 'The file may have been moved, deleted, or is not readable.');
  return failure('sql-error', 'SQL error', m);
}

/** MySQL·PostgreSQL 드라이버가 돌려준 오류를 화면에 보일 실패로 가른다(비밀번호·연결 문자열은 failure 가 가린다) */
export function serverFailure(message: string): DbFailure {
  const m = message;
  if (/password authentication failed|Access denied for user|no pg_hba\.conf entry|authentication failed|SASL/i.test(m)) return failure('auth', 'Sign-in failed', m, 'Check the user name and password.');
  if (/statement timeout|maximum statement execution time exceeded|Query execution was interrupted/i.test(m)) return failure('timeout', 'The query was stopped', m, 'Add a WHERE or LIMIT, or raise the time limit.');
  if (/read-only transaction|READ ONLY transaction/i.test(m)) return failure('write-mode', 'The database is open read-only', m, 'Turn on Write mode (top right) to change this database.');
  if (/certificate|SSL connection|does not support SSL|SSL is not|SSL routines|TLS|EPROTO/i.test(m)) return failure('no-server', 'Secure connection failed', m, 'Edit the connection and try another SSL setting. For Amazon RDS, pick "SSL + verify certificate".');
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET|connection timeout|connect timeout|timeout expired|Connection terminated|Could not reach/i.test(m)) return failure('no-server', 'Cannot reach the server', m, 'Check the host and port, your VPN, and that the server accepts connections from this computer.');
  if (/database ".*" does not exist|Unknown database/i.test(m)) return failure('bad-input', 'Database not found', m, 'Check the database name.');
  if (/lock wait timeout|deadlock|could not obtain lock|lock timeout/i.test(m)) return failure('busy', 'The table is locked', m, 'Another session is changing it. Try again in a moment.');
  return failure('sql-error', 'SQL error', m);
}

export const NO_ENGINE: DbFailure = failure(
  'no-engine',
  'SQLite engine is not available',
  'This build of Rauha cannot load the built-in SQLite engine (node:sqlite).',
  'Update Rauha to the latest version. If it keeps happening, copy diagnostics from Settings and report it.',
);

// ── 화면에 넘기는 값 ──

export interface DbConnectionList {
  readonly connections: readonly DbConnectionView[];
  /** 이 컴퓨터에서 비밀번호를 암호화해 저장할 수 있는지(safeStorage). 아니면 접속할 때마다 묻는다 */
  readonly canSavePasswords: boolean;
}

/** 서버 연결 추가 폼 */
export interface DbServerForm {
  readonly name: string;
  readonly kind: 'mysql' | 'postgres';
  readonly host: string;
  /** 비우면 기본 포트(3306 · 5432) */
  readonly port: string;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl: 'off' | 'require' | 'verify';
  readonly savePassword: boolean;
}

/** 저장한 서버 연결 고치기 폼: keepPassword 면 비밀번호 칸을 비워 두고 저장한(이번 실행에 기억한) 비밀번호를 그대로 쓴다 */
export interface DbServerEditForm extends DbServerForm {
  readonly id: string;
  readonly keepPassword: boolean;
}

/** 접속 시험 폼: 고치는 중이면 id 와 keepPassword 로 저장한 비밀번호를 쓸 수 있다 */
export interface DbServerTestForm extends DbServerForm {
  readonly id?: string;
  readonly keepPassword?: boolean;
}

/** 접속 시험 결과 */
export interface DbServerTest {
  /** 접속해서 SELECT 1 까지 걸린 시간 */
  readonly elapsedMs: number;
}

export interface DbTableInfo {
  readonly name: string;
  readonly kind: 'table' | 'view';
}
export interface DbColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
  /** 기본 키에서 몇 번째 열인지(0 이면 기본 키가 아니다) */
  readonly primaryKey: number;
  /** 숨은 열·생성 열 */
  readonly hidden: boolean;
}
export interface DbTableDetail {
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly columns: readonly DbColumnInfo[];
  /** CREATE 문(스키마에 적힌 그대로) */
  readonly createSql: string | null;
}

/** 쿼리·행 보기 결과 */
export interface DbResultSet {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly DbCell[])[];
  readonly truncated: 'rows' | 'bytes' | null;
  /** 칸 글이 잘렸는지 */
  readonly cellsTruncated: boolean;
  /** 대략의 결과 크기(바이트) */
  readonly bytes: number;
  readonly elapsedMs: number;
  /** 행을 바꾼 문장이면 바뀐 행 수. 읽기면 null */
  readonly changes: number | null;
  readonly kind: SqlKind;
  /** 이 결과를 만든 문장의 첫 낱말 */
  readonly verb: string;
}
export interface DbRowsPage {
  readonly result: DbResultSet;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
export interface DbCsvSaved {
  readonly saved: boolean;
  readonly fileName: string | null;
}

/** 화면이 쓰는 DB API(preload 가 채널로 이어 준다) */
export interface DbApi {
  list(): Promise<DbResult<DbConnectionList>>;
  /** 파일 경로를 직접 적어 더한다(main 이 다시 검사한다) */
  addPath(req: { readonly path: string }): Promise<DbResult<DbConnectionView>>;
  /** 파일 고르기 창을 열어 더한다. 취소하면 data 가 null */
  pick(): Promise<DbResult<DbConnectionView | null>>;
  /** 서버 연결을 더한다: main 이 먼저 접속해 보고 되면 저장한다. 비밀번호는 다시 돌아오지 않는다 */
  addServer(req: DbServerForm): Promise<DbResult<DbConnectionView>>;
  /** 저장한 서버 연결을 고친다: 고친 값으로 먼저 접속해 보고 되면 같은 id 로 저장한다 */
  editServer(req: DbServerEditForm): Promise<DbResult<DbConnectionView>>;
  /** 저장하지 않고 접속만 해 본다 */
  testServer(req: DbServerTestForm): Promise<DbResult<DbServerTest>>;
  /** 저장한 비밀번호가 없는 서버 연결에 비밀번호를 준다(이번 실행 동안 기억, savePassword 면 암호화해 저장) */
  unlock(req: { readonly id: string; readonly password: string; readonly savePassword: boolean }): Promise<DbResult<DbConnectionView>>;
  remove(id: string): Promise<DbResult<DbConnectionList>>;
  tables(id: string): Promise<DbResult<readonly DbTableInfo[]>>;
  detail(req: { readonly id: string; readonly table: string }): Promise<DbResult<DbTableDetail>>;
  rows(req: { readonly id: string; readonly table: string; readonly page?: number; readonly sort?: { readonly column: string; readonly dir: 'asc' | 'desc' } | null }): Promise<DbResult<DbRowsPage>>;
  query(req: { readonly id: string; readonly sql: string; readonly writeMode: boolean; readonly confirm: boolean; readonly timeoutSec?: number; readonly key?: string }): Promise<DbResult<DbResultSet>>;
  cancel(key: string): Promise<boolean>;
  exportCsv(req: { readonly csv: string; readonly name: string }): Promise<DbResult<DbCsvSaved>>;
}

// ── 바깥 입력 검증(DTO) ──

type Obj = Readonly<Record<string, unknown>>;
const obj = (raw: unknown): Obj => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DbInputError('The request is not valid.');
  return raw as Obj;
};

/** 쿼리 시간 제한(초) 값 객체: 비어 있으면 기본, 1~60 정수만 */
export class TimeoutSeconds {
  private constructor(readonly value: number) {}
  static parse(input: unknown): TimeoutSeconds {
    if (input === undefined || input === null) return new TimeoutSeconds(DB_LIMITS.defaultTimeoutSec);
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > DB_LIMITS.maxTimeoutSec) throw new DbInputError(`The time limit must be 1 to ${DB_LIMITS.maxTimeoutSec} seconds.`);
    return new TimeoutSeconds(input);
  }
  ms(): number {
    return this.value * 1000;
  }
}

const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** 화면에서 온 요청을 검사해 값 객체로 바꾼다. 실패하면 DbInputError(message 는 화면에 보인다). */
export const DbRequest = {
  connection(id: unknown): ConnectionId {
    return ConnectionId.parse(id);
  },
  addPath(raw: unknown): DbFilePath {
    return DbFilePath.parse(obj(raw)['path']);
  },
  detail(raw: unknown): { readonly id: ConnectionId; readonly table: TableName } {
    const o = obj(raw);
    return { id: ConnectionId.parse(o['id']), table: TableName.parse(o['table']) };
  },
  rows(raw: unknown): { readonly id: ConnectionId; readonly table: TableName; readonly page: PageNumber; readonly sort: SortSpec | null } {
    const o = obj(raw);
    return { id: ConnectionId.parse(o['id']), table: TableName.parse(o['table']), page: PageNumber.parse(o['page']), sort: SortSpec.parse(o['sort']) };
  },
  /** 서버 연결 추가: 대상 · 이름 · 비밀번호 · 저장 여부. 거절 글에는 비밀번호를 넣지 않는다 */
  addServer(raw: unknown): { readonly target: ServerTarget; readonly label: ConnectionLabel; readonly password: DbPassword; readonly savePassword: boolean } {
    const o = obj(raw);
    const target = ServerTarget.parse(o);
    return { target, label: ConnectionLabel.parse(o['name'], target), password: DbPassword.parse(o['password']), savePassword: o['savePassword'] === true };
  },
  /** 서버 연결 고치기: keepPassword 가 true 면 password 는 null(저장한 것을 쓴다) */
  editServer(raw: unknown): { readonly id: ConnectionId; readonly target: ServerTarget; readonly label: ConnectionLabel; readonly password: DbPassword | null; readonly savePassword: boolean } {
    const o = obj(raw);
    const target = ServerTarget.parse(o);
    const keep = o['keepPassword'] === true;
    return { id: ConnectionId.parse(o['id']), target, label: ConnectionLabel.parse(o['name'], target), password: keep ? null : DbPassword.parse(o['password']), savePassword: o['savePassword'] === true };
  },
  /** 접속 시험: 저장한 비밀번호를 쓰려면(keepPassword) 고치는 연결 id 가 있어야 한다 */
  testServer(raw: unknown): { readonly id: ConnectionId | null; readonly target: ServerTarget; readonly password: DbPassword | null } {
    const o = obj(raw);
    const target = ServerTarget.parse(o);
    const keep = o['keepPassword'] === true;
    const id = o['id'] === undefined || o['id'] === null ? null : ConnectionId.parse(o['id']);
    if (keep && id === null) throw new DbInputError('Type the password.');
    return { id, target, password: keep ? null : DbPassword.parse(o['password']) };
  },
  unlock(raw: unknown): { readonly id: ConnectionId; readonly password: DbPassword; readonly savePassword: boolean } {
    const o = obj(raw);
    return { id: ConnectionId.parse(o['id']), password: DbPassword.parse(o['password']), savePassword: o['savePassword'] === true };
  },
  /** 쿼리가 갈 연결 id 만 먼저 꺼낸다(연결 종류를 알아야 문법을 고를 수 있다) */
  queryTarget(raw: unknown): ConnectionId {
    return ConnectionId.parse(obj(raw)['id']);
  },
  /** 쓰기 문장은 writeMode 와 confirm 이 둘 다 true 여야 통과한다(SqlStatement.assertAllowed). dialect 는 연결 종류의 문법 */
  query(raw: unknown, dialect: SqlDialect = 'sqlite'): { readonly id: ConnectionId; readonly statement: SqlStatement; readonly writeMode: boolean; readonly timeout: TimeoutSeconds; readonly key: string | null } {
    const o = obj(raw);
    const statement = SqlStatement.parse(o['sql'], dialect);
    const writeMode = o['writeMode'] === true;
    statement.assertAllowed({ writeMode, confirm: o['confirm'] === true });
    const key = o['key'];
    if (key !== undefined && key !== null && (typeof key !== 'string' || !KEY.test(key))) throw new DbInputError('The run key is not valid.');
    return { id: ConnectionId.parse(o['id']), statement, writeMode, timeout: TimeoutSeconds.parse(o['timeoutSec']), key: typeof key === 'string' ? key : null };
  },
  cancel(key: unknown): string {
    if (typeof key !== 'string' || !KEY.test(key)) throw new DbInputError('The run key is not valid.');
    return key;
  },
  exportCsv(raw: unknown): { readonly csv: string; readonly fileName: string } {
    const o = obj(raw);
    const csv = o['csv'];
    if (typeof csv !== 'string') throw new DbInputError('There is nothing to save.');
    if (csv.length > DB_LIMITS.maxCsvBytes) throw new DbInputError('The CSV is too large to save.');
    const name = typeof o['name'] === 'string' ? o['name'] : '';
    return { csv, fileName: csvFileName(name) };
  },
};
