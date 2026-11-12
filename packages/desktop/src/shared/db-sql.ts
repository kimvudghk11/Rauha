import { DbInputError } from './db-names.js';

/** read: 데이터를 바꾸지 않는다 · write: 행을 바꾼다 · schema: 테이블·인덱스 같은 구조를 바꾼다 */
export type SqlKind = 'read' | 'write' | 'schema';
/** 어느 DB 의 문법으로 읽을지(문자열·주석 규칙과 허용 문장이 조금씩 다르다) */
export type SqlDialect = 'sqlite' | 'mysql' | 'postgres';

export const SQL_MAX_CHARS = 100_000;

/** 값 없이 읽을 때만 허용하는 PRAGMA(바꾸는 형태 `= 값` 이나 괄호 인자는 막는다) */
const PRAGMA_NO_ARG: ReadonlySet<string> = new Set(['database_list', 'collation_list', 'function_list', 'module_list', 'pragma_list', 'compile_options', 'user_version', 'application_id', 'encoding', 'page_count', 'page_size', 'freelist_count', 'data_version', 'journal_mode', 'foreign_keys']);
/** 괄호 인자(테이블 이름 등)로 읽는 것도 허용하는 PRAGMA */
const PRAGMA_WITH_ARG: ReadonlySet<string> = new Set(['table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list', 'foreign_key_check', 'integrity_check', 'quick_check']);

/** 읽기 전용으로 허용하는 PRAGMA 인지(대소문자 무시) */
export function isSafePragma(name: string): boolean {
  const n = name.toLowerCase();
  return PRAGMA_NO_ARG.has(n) || PRAGMA_WITH_ARG.has(n);
}
/** 이 PRAGMA 는 괄호 인자를 받아도 되는지. 아니면 인자 자리에 값이 있으면 "바꾸기"다. */
export function pragmaTakesArgument(name: string): boolean {
  return PRAGMA_WITH_ARG.has(name.toLowerCase());
}

/** 숫자 글자로 크기를 적는 BLOB 만들기 함수와 그 상한(64MB) */
const MAKES_BLOB: ReadonlySet<string> = new Set(['randomblob', 'zeroblob']);
const MAX_BLOB_LITERAL = 64 * 1024 * 1024;

/** 어디에 쓰였든 막는 함수 이름: 확장 불러오기·토크나이저 등록·파일 읽고 쓰기 */
export const BLOCKED_FUNCTIONS: ReadonlySet<string> = new Set(['load_extension', 'fts3_tokenizer', 'readfile', 'writefile']);

/** 서버에서 어디에 쓰였든 막는 낱말·함수: 서버 파일 읽고 쓰기, 다른 연결로 새기, 읽기 전용 풀기, 다른 세션 끊기 */
const SERVER_BLOCKED: Readonly<Record<'mysql' | 'postgres', ReadonlySet<string>>> = {
  mysql: new Set(['load_file', 'outfile', 'dumpfile', 'sys_exec', 'sys_eval']),
  postgres: new Set([
    'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'pg_file_write', 'lo_import', 'lo_export', 'dblink', 'dblink_exec', 'dblink_connect', 'dblink_send_query',
    'set_config', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile', 'pg_promote', 'pg_switch_wal',
  ]),
};

/** 첫 낱말이 이것이면 쓰기 모드에서도 실행하지 않는다 */
const BLOCKED_FIRST: Readonly<Record<string, string>> = {
  ATTACH: 'ATTACH DATABASE is not allowed (it could open other files).',
  DETACH: 'DETACH is not allowed.',
  VACUUM: 'VACUUM is not allowed (VACUUM INTO writes a new file).',
  BEGIN: 'Transactions are not supported here: each statement runs on its own.',
  COMMIT: 'Transactions are not supported here: each statement runs on its own.',
  END: 'Transactions are not supported here: each statement runs on its own.',
  ROLLBACK: 'Transactions are not supported here: each statement runs on its own.',
  SAVEPOINT: 'Transactions are not supported here: each statement runs on its own.',
  RELEASE: 'Transactions are not supported here: each statement runs on its own.',
};

/** PostgreSQL 달러 문자열의 여는 표시 */
const DOLLAR = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

type Token = { readonly t: 'word' | 'str' | 'id' | 'num' | 'punct'; readonly v: string };

/** 주석을 빼고 낱말·문자열·인용 식별자·기호로 자른다. 닫히지 않은 따옴표는 오류(뒤를 숨기는 입력을 막는다). */
function tokenize(sql: string, dialect: SqlDialect = 'sqlite'): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i += 1;
    } else if (c === '-' && sql[i + 1] === '-' && (dialect !== 'mysql' || i + 2 >= n || /\s/.test(sql[i + 2]!))) {
      // MySQL 은 `-- ` 처럼 뒤에 공백이 있어야 주석이다(`1--1` 은 빼기)
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (c === '#' && dialect === 'mysql') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      // MySQL 은 /*! … */ 안의 글을 실행한다: 검사를 숨길 수 있으니 받지 않는다
      if (dialect === 'mysql' && sql[i + 2] === '!') throw new DbInputError('MySQL version comments (/*! … */) are not allowed here.', 'blocked');
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '$' && dialect === 'postgres' && DOLLAR.test(sql.slice(i, i + 66))) {
      // PostgreSQL 달러 문자열: $tag$ … $tag$
      const tag = DOLLAR.exec(sql.slice(i, i + 66))![0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) throw new DbInputError('A $$ string in the SQL is never closed.');
      out.push({ t: 'str', v: sql.slice(i + tag.length, end) });
      i = end + tag.length;
    } else if (c === "'" || c === '"' || c === '`') {
      // MySQL 문자열과 PostgreSQL E'…' 문자열은 역슬래시로 따옴표를 감출 수 있다
      const prev = out[out.length - 1];
      const eString = dialect === 'postgres' && c === "'" && prev !== undefined && prev.t === 'word' && /^[eE]$/.test(prev.v) && sql[i - 1] === prev.v;
      if (eString) out.pop();
      const backslash = (dialect === 'mysql' && c !== '`') || eString;
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= n) throw new DbInputError('A quote in the SQL is never closed.');
        if (backslash && sql[j] === '\\') {
          value += sql[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            value += c;
            j += 2;
            continue;
          }
          break;
        }
        value += sql[j];
        j += 1;
      }
      out.push({ t: c === "'" ? 'str' : 'id', v: value });
      i = j + 1;
    } else if (c === '[') {
      const end = sql.indexOf(']', i + 1);
      if (end === -1) throw new DbInputError('A bracket in the SQL is never closed.');
      out.push({ t: 'id', v: sql.slice(i + 1, end) });
      i = end + 1;
    } else if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j]!)) j += 1;
      out.push({ t: 'word', v: sql.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(sql[j]!)) j += 1;
      out.push({ t: 'num', v: sql.slice(i, j) });
      i = j;
    } else {
      out.push({ t: 'punct', v: c });
      i += 1;
    }
  }
  return out;
}

const upper = (t: Token | undefined): string => (t !== undefined && t.t === 'word' ? t.v.toUpperCase() : '');

function pragmaKind(tokens: readonly Token[]): SqlKind {
  // PRAGMA [main.]name [ ( arg ) ]   — `=` 이나 허용 목록 밖의 이름·괄호는 막는다
  let i = 1;
  const first = tokens[i];
  if (first === undefined || first.t !== 'word') throw new DbInputError('PRAGMA needs a name.', 'blocked');
  let name = first.v;
  i += 1;
  if (tokens[i]?.t === 'punct' && tokens[i]!.v === '.') {
    if (first.v.toLowerCase() !== 'main') throw new DbInputError('Only the main database can be used with PRAGMA.', 'blocked');
    const nameToken = tokens[i + 1];
    if (nameToken === undefined || nameToken.t !== 'word') throw new DbInputError('PRAGMA needs a name.', 'blocked');
    name = nameToken.v;
    i += 2;
  }
  if (!isSafePragma(name)) throw new DbInputError(`PRAGMA ${name} is not allowed here (only read-only PRAGMAs such as table_info are).`, 'blocked');
  const next = tokens[i];
  if (next === undefined) return 'read';
  if (next.t === 'punct' && next.v === '(' && pragmaTakesArgument(name)) return 'read';
  throw new DbInputError(`PRAGMA ${name} can only be read here (no value or argument).`, 'blocked');
}

/** EXPLAIN 뒤에서 실제로 설명할(ANALYZE 면 실행할) 문장이 시작하는 낱말 */
const EXPLAINED: ReadonlySet<string> = new Set(['SELECT', 'VALUES', 'WITH', 'TABLE', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'MERGE']);

/** MySQL·PostgreSQL 문장 가르기 */
function classifyServer(tokens: readonly Token[], dialect: 'mysql' | 'postgres'): SqlKind {
  const first = upper(tokens[0]);
  const hasWord = (w: string): boolean => tokens.some((t) => upper(t) === w);
  switch (first) {
    case 'SELECT':
      // PostgreSQL 의 SELECT … INTO 새_테이블 은 테이블을 만든다
      return dialect === 'postgres' && hasWord('INTO') ? 'schema' : 'read';
    case 'VALUES':
    case 'SHOW':
    case 'DESCRIBE':
    case 'DESC':
      return 'read';
    case 'TABLE':
      if (dialect === 'postgres') return 'read';
      break;
    case 'WITH': {
      for (let i = 0; i < tokens.length; i += 1) {
        const w = upper(tokens[i]);
        if (w === 'INSERT' || w === 'UPDATE' || w === 'DELETE' || w === 'MERGE') return 'write';
        if (w === 'REPLACE' && !(tokens[i + 1]?.t === 'punct' && tokens[i + 1]!.v === '(')) return 'write';
      }
      return dialect === 'postgres' && hasWord('INTO') ? 'schema' : 'read';
    }
    case 'EXPLAIN': {
      // EXPLAIN ANALYZE 는 문장을 실제로 실행하니 설명하는 문장의 종류를 따른다
      const at = tokens.findIndex((t, i) => i > 0 && t.t === 'word' && EXPLAINED.has(t.v.toUpperCase()));
      if (at === -1) throw new DbInputError('EXPLAIN needs a SELECT, INSERT, UPDATE or DELETE after it.');
      return classifyServer(tokens.slice(at), dialect);
    }
    case 'INSERT':
    case 'REPLACE':
    case 'UPDATE':
    case 'DELETE':
    case 'TRUNCATE':
    case 'MERGE':
    case 'CALL': // 저장 프로시저는 무엇이든 할 수 있으니 쓰기로 본다
      return 'write';
    case 'CREATE':
    case 'DROP':
    case 'ALTER':
    case 'RENAME':
    case 'GRANT':
    case 'REVOKE':
    case 'COMMENT':
    case 'ANALYZE':
    case 'REINDEX':
      return 'schema';
  }
  throw new DbInputError(`${first} statements are not supported here.`);
}

function classify(tokens: readonly Token[], dialect: SqlDialect = 'sqlite'): SqlKind {
  const first = upper(tokens[0]);
  if (first === '') throw new DbInputError('That is not a SQL statement I can run (it must start with a keyword such as SELECT).');
  const blockedText = BLOCKED_FIRST[first];
  if (blockedText !== undefined) throw new DbInputError(blockedText, 'blocked');
  if (dialect !== 'sqlite') return classifyServer(tokens, dialect);
  switch (first) {
    case 'SELECT':
    case 'VALUES':
      return 'read';
    case 'WITH': {
      for (let i = 0; i < tokens.length; i += 1) {
        const w = upper(tokens[i]);
        if (w === 'INSERT' || w === 'UPDATE' || w === 'DELETE') return 'write';
        if (w === 'REPLACE' && !(tokens[i + 1]?.t === 'punct' && tokens[i + 1]!.v === '(')) return 'write';
      }
      return 'read';
    }
    case 'EXPLAIN': {
      let rest = tokens.slice(1);
      if (upper(rest[0]) === 'QUERY' && upper(rest[1]) === 'PLAN') rest = rest.slice(2);
      return classify(rest);
    }
    case 'PRAGMA':
      return pragmaKind(tokens);
    case 'INSERT':
    case 'REPLACE':
    case 'UPDATE':
    case 'DELETE':
      return 'write';
    case 'CREATE':
    case 'DROP':
    case 'ALTER':
    case 'REINDEX':
    case 'ANALYZE':
      return 'schema';
    default:
      throw new DbInputError(`${first} statements are not supported here.`);
  }
}

/**
 * 사용자가 쓴 SQL 한 문장. 바깥 입력이라 믿지 않는다: 한 문장만, 막는 문장·함수는 어디에 있든 거절,
 * 읽기·쓰기·스키마 변경으로 가른다. 이 검사는 첫 번째 울타리일 뿐이고, main 은 읽기 전용 열기와 SQLite 인가 함수로 한 번 더 막는다.
 */
export class SqlStatement {
  private constructor(
    readonly text: string,
    readonly kind: SqlKind,
    /** 첫 낱말(대문자). 확인 창과 결과 줄에 보인다 */
    readonly verb: string,
  ) {}

  static parse(input: unknown, dialect: SqlDialect = 'sqlite'): SqlStatement {
    if (typeof input !== 'string') throw new DbInputError('The SQL is missing.');
    if (input.includes('\0')) throw new DbInputError('The SQL has a NUL character.');
    if (input.length > SQL_MAX_CHARS) throw new DbInputError(`The SQL is too long (up to ${SQL_MAX_CHARS} characters).`);
    const tokens = tokenize(input, dialect);
    if (tokens.length === 0) throw new DbInputError('The SQL is empty.');
    // 막는 함수는 문장 어디에 있든 거절한다(인용 식별자로 감싼 것도)
    const serverBlocked = dialect === 'sqlite' ? null : SERVER_BLOCKED[dialect];
    for (const t of tokens) {
      if ((t.t === 'word' || t.t === 'id') && BLOCKED_FUNCTIONS.has(t.v.toLowerCase())) throw new DbInputError(`${t.v} is not allowed (it could touch files or load code).`, 'blocked');
      if (t.t === 'word' && serverBlocked?.has(t.v.toLowerCase()) === true) throw new DbInputError(`${t.v} is not allowed here (it could touch server files, other connections or the read-only setting).`, 'blocked');
    }
    // 거대한 값을 만드는 줄 알 수 있는 호출(randomblob(1000000000) 같은)은 막는다. 길이 한계 API(SQLITE_LIMIT_LENGTH)는 Node 24 에만 있어 문장 검사가 모든 Node 에서 통하는 방어선이다.
    for (let i = 0; i + 2 < tokens.length; i += 1) {
      const t = tokens[i]!;
      if (t.t === 'word' && MAKES_BLOB.has(t.v.toLowerCase()) && tokens[i + 1]!.v === '(' && tokens[i + 2]!.t === 'num') {
        const n = Number(tokens[i + 2]!.v);
        if (Number.isNaN(n) || n > MAX_BLOB_LITERAL) throw new DbInputError(`${t.v}(${tokens[i + 2]!.v}) would allocate too much memory (limit ${MAX_BLOB_LITERAL.toLocaleString('en-US')} bytes).`, 'blocked');
      }
    }
    // 한 문장만: 첫 `;` 뒤에 낱말이 더 있으면 거절한다(주석·공백은 이미 빠졌다)
    const semi = tokens.findIndex((t) => t.t === 'punct' && t.v === ';');
    const body = semi === -1 ? tokens : tokens.slice(0, semi);
    if (semi !== -1 && tokens.length > semi + 1) throw new DbInputError('Run one statement at a time (found text after the first ;).');
    if (body.length === 0) throw new DbInputError('The SQL is empty.');
    const kind = classify(body, dialect);
    return new SqlStatement(input.trim(), kind, upper(body[0]));
  }

  needsWriteMode(): boolean {
    return this.kind !== 'read';
  }

  /** 쓰기 모드가 꺼져 있거나 확인이 없으면 던진다 */
  assertAllowed(o: { readonly writeMode: boolean; readonly confirm: boolean }): void {
    if (!this.needsWriteMode()) return;
    if (!o.writeMode) throw new DbInputError(`${this.verb} changes the database. Turn on Write mode first. Nothing was changed.`, 'write-mode');
    if (!o.confirm) throw new DbInputError(`${this.verb} changes the database and needs confirmation. Nothing was changed.`, 'confirm');
  }
}
