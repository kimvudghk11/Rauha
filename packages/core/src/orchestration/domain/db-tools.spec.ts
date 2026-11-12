import { describe, expect, it } from 'vitest';
import { DbProbeSql, DbSampleSize, DbTableName, DbToolAccess, DbToolText, DB_SAMPLE_MAX_ROWS, DB_TOOL_MAX_CHARS } from './db-tools.js';

describe('DbToolAccess', () => {
  it('테스트·구현·리뷰·디버깅 팀원은 레포에 연결된 DB 가 있을 때만 DB 도구를 받는다', () => {
    for (const role of ['tester', 'implementer', 'reviewer', 'debugger'] as const) {
      expect(DbToolAccess.attaches(role, true)).toBe(true);
      expect(DbToolAccess.attaches(role, false)).toBe(false);
    }
  });

  it('코드 작업이 아닌 팀원은 DB 가 있어도 받지 않는다', () => {
    for (const role of ['router', 'answerer', 'writer', 'marketer', 'publisher', 'intake'] as const) expect(DbToolAccess.attaches(role, true)).toBe(false);
  });

  it('붙일 수 있는 역할인지는 DB 를 찾기 전에 따로 물을 수 있다', () => {
    expect(DbToolAccess.wants('reviewer')).toBe(true);
    expect(DbToolAccess.wants('router')).toBe(false);
  });
});

describe('DbTableName', () => {
  it('보통 테이블 이름과 한글 이름을 받는다', () => {
    expect(DbTableName.parse('user_orders').value).toBe('user_orders');
    expect(DbTableName.parse(' 주문 ').value).toBe('주문');
  });

  it('따옴표·역슬래시·세미콜론·제어 문자가 든 이름은 거절한다(SQL 에 끼워 넣지 못하게)', () => {
    for (const bad of ["a'b", 'a"b', 'a`b', 'a\\b', 'a;b', 'a\nb', '', '   ', 'x'.repeat(129), 3, null]) expect(() => DbTableName.parse(bad)).toThrow();
  });

  it('DB 마다 식별자 인용과 문자열 값을 만든다', () => {
    const t = DbTableName.parse('orders');
    expect(t.quoted('mysql')).toBe('`orders`');
    expect(t.quoted('postgres')).toBe('"orders"');
    expect(t.quoted('sqlite')).toBe('"orders"');
    expect(t.literal()).toBe("'orders'");
  });
});

describe('DbSampleSize', () => {
  it('샘플 행은 기본 10행, 최대 20행이다', () => {
    expect(DbSampleSize.parse(undefined)).toBe(10);
    expect(DbSampleSize.parse(5)).toBe(5);
    expect(DbSampleSize.parse(DB_SAMPLE_MAX_ROWS)).toBe(20);
  });

  it('20행을 넘거나 정수가 아니면 거절한다', () => {
    for (const bad of [0, -1, 21, 1.5, '10', 1000]) expect(() => DbSampleSize.parse(bad)).toThrow();
  });
});

describe('DbProbeSql', () => {
  it('조회 도구는 EXPLAIN 으로 시작하는 문장을 거절한다(계획은 explain 도구로, ANALYZE 실행 금지)', () => {
    expect(() => DbProbeSql.select('EXPLAIN ANALYZE SELECT 1')).toThrow();
    expect(() => DbProbeSql.select('/* x */ explain analyze select 1')).toThrow();
    expect(() => DbProbeSql.select('-- c\nEXPLAIN SELECT 1')).toThrow();
    expect(DbProbeSql.select(' SELECT id FROM users LIMIT 5 ')).toBe('SELECT id FROM users LIMIT 5');
  });

  it('비었거나 너무 긴 SQL 은 거절한다', () => {
    expect(() => DbProbeSql.select('')).toThrow();
    expect(() => DbProbeSql.select(42)).toThrow();
    expect(() => DbProbeSql.select(`SELECT '${'x'.repeat(20_000)}'`)).toThrow();
  });

  it('PostgreSQL 은 EXPLAIN (FORMAT JSON), MySQL 은 EXPLAIN FORMAT=JSON, SQLite 는 EXPLAIN QUERY PLAN 을 붙인다', () => {
    expect(DbProbeSql.explain('SELECT * FROM t WHERE id = 1', 'postgres')).toBe('EXPLAIN (FORMAT JSON) SELECT * FROM t WHERE id = 1');
    expect(DbProbeSql.explain('SELECT * FROM t', 'mysql')).toBe('EXPLAIN FORMAT=JSON SELECT * FROM t');
    expect(DbProbeSql.explain('SELECT * FROM t', 'sqlite')).toBe('EXPLAIN QUERY PLAN SELECT * FROM t');
  });

  it('explain 은 ANALYZE·ANALYSE 가 든 문장과 이미 EXPLAIN 인 문장을 거절한다(실제로 실행하지 않는다)', () => {
    expect(() => DbProbeSql.explain('EXPLAIN SELECT 1', 'postgres')).toThrow();
    expect(() => DbProbeSql.explain('SELECT 1; EXPLAIN ANALYZE SELECT 1', 'postgres')).toThrow();
    expect(() => DbProbeSql.explain('select analyse from t', 'postgres')).toThrow();
  });

  it('explain 은 SELECT·WITH 문장만 받는다(쓰기 문장의 계획도 보지 않는다)', () => {
    expect(() => DbProbeSql.explain('UPDATE t SET a = 1', 'mysql')).toThrow();
    expect(() => DbProbeSql.explain('DELETE FROM t', 'postgres')).toThrow();
    expect(DbProbeSql.explain('WITH x AS (SELECT 1) SELECT * FROM x', 'postgres')).toContain('WITH x');
  });
});

describe('DbToolText', () => {
  it('상한보다 긴 결과는 잘라서 잘랐다고 적는다', () => {
    const text = DbToolText.cap('a'.repeat(DB_TOOL_MAX_CHARS + 500));
    expect(text.length).toBeLessThan(DB_TOOL_MAX_CHARS + 100);
    expect(text).toContain('truncated');
  });

  it('짧은 결과는 그대로 둔다', () => {
    expect(DbToolText.cap('ok')).toBe('ok');
  });
});
