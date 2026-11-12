import { DomainError } from '../../shared/domain-error.js';
import type { MemberRole } from './member-role.js';

/** 팀원이 DB 를 볼 때의 SQL 문법 */
export type DbDialect = 'sqlite' | 'mysql' | 'postgres';

/** 샘플 행 상한(개인정보가 있을 수 있어 작게) */
export const DB_SAMPLE_MAX_ROWS = 20;
const DB_SAMPLE_DEFAULT_ROWS = 10;
/** 도구 결과 한 번의 글자 상한(모델 입력이 커지지 않게) */
export const DB_TOOL_MAX_CHARS = 20_000;
/** 팀원이 보내는 SQL 글자 상한 */
export const DB_PROBE_SQL_MAX_CHARS = 10_000;
const TABLE_NAME_MAX = 128;

/** 코드를 쓰거나 고치거나 검토하는 팀원. 이들만 레포에 연결된 DB 를 본다. */
const DB_ROLES: ReadonlySet<MemberRole> = new Set(['tester', 'implementer', 'reviewer', 'debugger']);

/** DB 도구를 붙일지. 연결된 DB 가 없으면 아무것도 붙지 않는다(도구 설명만큼의 입력도 쓰지 않는다). */
export class DbToolAccess {
  private constructor() {}

  /** 이 역할이 DB 도구를 받을 수 있는지(DB 를 찾기 전에 묻는다: 아니면 찾지도 않는다) */
  static wants(role: MemberRole): boolean {
    return DB_ROLES.has(role);
  }

  static attaches(role: MemberRole, linked: boolean): boolean {
    return linked && DbToolAccess.wants(role);
  }
}

const invalid = (message: string): DomainError => new DomainError('INVALID_INPUT', message);

/** SQL 에 끼워 넣는 테이블 이름. 따옴표·역슬래시·세미콜론·제어 문자가 없어 인용 식별자와 문자열 값으로 그대로 쓸 수 있다. */
export class DbTableName {
  private constructor(readonly value: string) {}

  static parse(input: unknown): DbTableName {
    if (typeof input !== 'string') throw invalid('table must be a string.');
    const v = input.trim();
    if (v === '' || v.length > TABLE_NAME_MAX) throw invalid(`table must be 1 to ${TABLE_NAME_MAX} characters.`);
    if (!/^[\p{L}\p{N}_$ .-]+$/u.test(v)) throw invalid('table may contain only letters, digits, space, "_", "$", "." and "-".');
    return new DbTableName(v);
  }

  quoted(dialect: DbDialect): string {
    return dialect === 'mysql' ? `\`${this.value}\`` : `"${this.value}"`;
  }

  /** 카탈로그 질의에 넣는 문자열 값 */
  literal(): string {
    return `'${this.value}'`;
  }
}

/** 샘플 행 수: 기본 10, 1~20 */
export class DbSampleSize {
  private constructor() {}

  static parse(input: unknown): number {
    if (input === undefined || input === null) return DB_SAMPLE_DEFAULT_ROWS;
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > DB_SAMPLE_MAX_ROWS) throw invalid(`rows must be an integer from 1 to ${DB_SAMPLE_MAX_ROWS}.`);
    return input;
  }
}

/** 앞쪽 공백과 주석(-- …, # …, /* … *\/)을 걷어 낸다. 첫 낱말을 보려고 쓴다. */
function withoutLeadingComments(sql: string): string {
  let rest = sql;
  for (;;) {
    const next = rest.replace(/^\s+/, '').replace(/^(--|#)[^\n]*(\n|$)/, '').replace(/^\/\*[\s\S]*?\*\//, '');
    if (next === rest) return rest;
    rest = next;
  }
}

function sqlText(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') throw invalid('sql must be a non-empty string.');
  if (input.length > DB_PROBE_SQL_MAX_CHARS) throw invalid(`sql is too long (up to ${DB_PROBE_SQL_MAX_CHARS} characters).`);
  return input.trim();
}

const firstWord = (sql: string): string => (/^[A-Za-z]+/.exec(withoutLeadingComments(sql))?.[0] ?? '').toUpperCase();

/**
 * 팀원이 보낸 SQL. 읽기 전용 검사(쓰기·DDL·위험 함수 차단)는 DB 를 여는 쪽(데스크톱 db-sql)이 한 번 더 한다.
 * 여기서는 도구별 규칙만: 조회는 EXPLAIN 을 받지 않고, 계획은 우리가 EXPLAIN 을 붙이며 ANALYZE(실제 실행)는 어디에도 쓸 수 없다.
 */
export class DbProbeSql {
  private constructor() {}

  static select(input: unknown): string {
    const sql = sqlText(input);
    if (firstWord(sql) === 'EXPLAIN') throw invalid('Use the explain tool for query plans (EXPLAIN ANALYZE is not allowed).');
    return sql;
  }

  static explain(input: unknown, dialect: DbDialect): string {
    const sql = sqlText(input);
    const first = firstWord(sql);
    if (first === 'EXPLAIN') throw invalid('Send the query itself; rauha adds EXPLAIN.');
    if (/\banaly[sz]e\b/i.test(sql)) throw invalid('ANALYZE is not allowed: it would run the query.');
    if (first !== 'SELECT' && first !== 'WITH') throw invalid('explain takes a SELECT (or WITH … SELECT) query only.');
    const prefix = dialect === 'postgres' ? 'EXPLAIN (FORMAT JSON)' : dialect === 'mysql' ? 'EXPLAIN FORMAT=JSON' : 'EXPLAIN QUERY PLAN';
    return `${prefix} ${sql}`;
  }
}

/** 도구 결과 글 크기 상한 */
export class DbToolText {
  private constructor() {}

  static cap(text: string): string {
    if (text.length <= DB_TOOL_MAX_CHARS) return text;
    return `${text.slice(0, DB_TOOL_MAX_CHARS)}\n… (truncated: ${text.length - DB_TOOL_MAX_CHARS} more characters; narrow the query)`;
  }
}
