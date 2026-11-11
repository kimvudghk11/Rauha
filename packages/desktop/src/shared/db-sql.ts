import { DbInputError } from './db-names.js';

/** read: 데이터를 바꾸지 않는다 · write: 행을 바꾼다 · schema: 테이블·인덱스 같은 구조를 바꾼다 */
export type SqlKind = 'read' | 'write' | 'schema';

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

/** 어디에 쓰였든 막는 함수 이름: 확장 불러오기·토크나이저 등록·파일 읽고 쓰기 */
export const BLOCKED_FUNCTIONS: ReadonlySet<string> = new Set(['load_extension', 'fts3_tokenizer', 'readfile', 'writefile']);

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

type Token = { readonly t: 'word' | 'str' | 'id' | 'num' | 'punct'; readonly v: string };

/** 주석을 빼고 낱말·문자열·인용 식별자·기호로 자른다. 닫히지 않은 따옴표는 오류(뒤를 숨기는 입력을 막는다). */
function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i += 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= n) throw new DbInputError('A quote in the SQL is never closed.');
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

function classify(tokens: readonly Token[]): SqlKind {
  const first = upper(tokens[0]);
  if (first === '') throw new DbInputError('That is not a SQL statement I can run (it must start with a keyword such as SELECT).');
  const blockedText = BLOCKED_FIRST[first];
  if (blockedText !== undefined) throw new DbInputError(blockedText, 'blocked');
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

  static parse(input: unknown): SqlStatement {
    if (typeof input !== 'string') throw new DbInputError('The SQL is missing.');
    if (input.includes('\0')) throw new DbInputError('The SQL has a NUL character.');
    if (input.length > SQL_MAX_CHARS) throw new DbInputError(`The SQL is too long (up to ${SQL_MAX_CHARS} characters).`);
    const tokens = tokenize(input);
    if (tokens.length === 0) throw new DbInputError('The SQL is empty.');
    // 막는 함수는 문장 어디에 있든 거절한다(인용 식별자로 감싼 것도)
    for (const t of tokens) {
      if ((t.t === 'word' || t.t === 'id') && BLOCKED_FUNCTIONS.has(t.v.toLowerCase())) throw new DbInputError(`${t.v} is not allowed (it could touch files or load code).`, 'blocked');
    }
    // 한 문장만: 첫 `;` 뒤에 낱말이 더 있으면 거절한다(주석·공백은 이미 빠졌다)
    const semi = tokens.findIndex((t) => t.t === 'punct' && t.v === ';');
    const body = semi === -1 ? tokens : tokens.slice(0, semi);
    if (semi !== -1 && tokens.length > semi + 1) throw new DbInputError('Run one statement at a time (found text after the first ;).');
    if (body.length === 0) throw new DbInputError('The SQL is empty.');
    const kind = classify(body);
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
