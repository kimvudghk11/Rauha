import { describe, expect, it } from 'vitest';
import { DbInputError } from './db-names.js';
import { isSafePragma, SqlStatement } from './db-sql.js';

const kind = (sql: string) => SqlStatement.parse(sql).kind;
const blocked = (sql: string) => {
  try {
    SqlStatement.parse(sql);
  } catch (e) {
    return e instanceof DbInputError && e.kind === 'blocked';
  }
  return false;
};

describe('SQL 문장 가르기: 읽기', () => {
  it('SELECT · VALUES · WITH…SELECT · EXPLAIN SELECT 는 읽기다', () => {
    expect(kind('SELECT * FROM t')).toBe('read');
    expect(kind('  select 1;  ')).toBe('read');
    expect(kind('VALUES (1),(2)')).toBe('read');
    expect(kind('WITH a AS (SELECT 1) SELECT * FROM a')).toBe('read');
    expect(kind('EXPLAIN QUERY PLAN SELECT * FROM t')).toBe('read');
  });
  it('앞의 주석과 줄바꿈을 건너뛰고 첫 낱말을 본다', () => {
    expect(kind('-- 주석\nSELECT 1')).toBe('read');
    expect(kind('/* c */ /* d */ SELECT 1')).toBe('read');
  });
  it('문자열 안의 DELETE·세미콜론·주석 기호는 낱말이 아니다', () => {
    expect(kind("SELECT 'DELETE FROM t; ATTACH x' AS s")).toBe('read');
    expect(kind('SELECT "update" FROM t')).toBe('read');
    expect(kind("SELECT 'it''s; DROP TABLE x' ")).toBe('read');
    expect(kind('SELECT replace(a, 1, 2) FROM t')).toBe('read');
  });
  it('안전한 읽기 PRAGMA 는 읽기다(인자 있는 것은 괄호로만)', () => {
    expect(kind('PRAGMA table_info(users)')).toBe('read');
    expect(kind("PRAGMA table_xinfo('users')")).toBe('read');
    expect(kind('PRAGMA main.index_list(users)')).toBe('read');
    expect(kind('PRAGMA foreign_key_list(orders)')).toBe('read');
    expect(kind('PRAGMA user_version')).toBe('read');
    expect(kind('PRAGMA database_list;')).toBe('read');
  });
});

describe('SQL 문장 가르기: 쓰기·스키마', () => {
  it('INSERT · UPDATE · DELETE · REPLACE 는 쓰기다', () => {
    for (const s of ['INSERT INTO t VALUES (1)', 'update t set a=1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)']) expect(kind(s), s).toBe('write');
  });
  it('WITH 로 시작해도 안에 INSERT·UPDATE·DELETE 가 있으면 쓰기다', () => {
    expect(kind('WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a')).toBe('write');
    expect(kind('WITH a AS (SELECT 1) DELETE FROM t WHERE x IN (SELECT * FROM a)')).toBe('write');
    expect(kind('WITH a AS (SELECT 1) UPDATE t SET x = 1')).toBe('write');
  });
  it('CREATE · DROP · ALTER · REINDEX · ANALYZE 는 스키마 변경이다', () => {
    for (const s of ['CREATE TABLE x(a)', 'drop table x', 'ALTER TABLE x ADD b', 'CREATE INDEX i ON t(a)', 'REINDEX', 'ANALYZE']) expect(kind(s), s).toBe('schema');
  });
  it('쓰기·스키마는 쓰기 모드가 있어야 한다', () => {
    expect(SqlStatement.parse('SELECT 1').needsWriteMode()).toBe(false);
    expect(SqlStatement.parse('DELETE FROM t').needsWriteMode()).toBe(true);
    expect(SqlStatement.parse('DROP TABLE t').needsWriteMode()).toBe(true);
  });
  it('쓰기 모드가 꺼져 있으면 write-mode 오류, 켜졌는데 확인이 없으면 confirm 오류, 둘 다 있으면 통과한다', () => {
    const del = SqlStatement.parse('DELETE FROM t');
    expect(() => del.assertAllowed({ writeMode: false, confirm: true })).toThrow(expect.objectContaining({ kind: 'write-mode' }));
    expect(() => del.assertAllowed({ writeMode: true, confirm: false })).toThrow(expect.objectContaining({ kind: 'confirm' }));
    expect(() => del.assertAllowed({ writeMode: true, confirm: true })).not.toThrow();
    expect(() => SqlStatement.parse('SELECT 1').assertAllowed({ writeMode: false, confirm: false })).not.toThrow();
  });
});

describe('SQL 문장 가르기: 막는 것(공격)', () => {
  it('ATTACH · DETACH · VACUUM · 트랜잭션·SAVEPOINT 는 쓰기 모드에서도 막는다', () => {
    for (const s of ["ATTACH DATABASE '/etc/x.db' AS x", "attach ':memory:' as m", 'DETACH x', 'VACUUM', "VACUUM INTO '/tmp/copy.db'", 'BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT a', 'RELEASE a']) expect(blocked(s), s).toBe(true);
  });
  it('주석이나 줄바꿈으로 첫 낱말을 숨겨도 막는다', () => {
    expect(blocked("/* x */ ATTACH 'a' AS b")).toBe(true);
    expect(blocked("-- hi\n  ATTACH 'a' AS b")).toBe(true);
    expect(blocked("\n\n\tATTACH\n'a' AS b")).toBe(true);
  });
  it('load_extension · fts3_tokenizer · readfile · writefile 은 어디에 있든 막는다', () => {
    for (const s of ["SELECT load_extension('evil.dll')", "SELECT LOAD_EXTENSION('x', 'y')", 'select "load_extension"(1)', "SELECT fts3_tokenizer('x')", "SELECT readfile('/etc/passwd')", "SELECT writefile('/tmp/x', 'y')", 'SELECT [load_extension](1)', 'SELECT `load_extension`(1)']) expect(blocked(s), s).toBe(true);
  });
  it('문자열 안의 load_extension 글자는 막지 않는다(낱말이 아니다)', () => {
    expect(kind("SELECT 'load_extension' AS s")).toBe('read');
  });
  it('여러 문장은 거절한다(주입: ; 뒤의 문장)', () => {
    for (const s of ['SELECT 1; DROP TABLE t', 'SELECT 1; SELECT 2', 'SELECT 1;;DELETE FROM t', "SELECT 1; -- x\nATTACH 'a' AS b", 'SELECT 1; /* c */ DELETE FROM t']) expect(() => SqlStatement.parse(s), s).toThrow(/one statement/i);
  });
  it('끝의 세미콜론과 뒤따르는 주석·공백은 괜찮다', () => {
    expect(kind('SELECT 1; -- done')).toBe('read');
    expect(kind('SELECT 1;  \n /* c */ ')).toBe('read');
  });
  it('PRAGMA 는 허용 목록 밖이거나 값을 바꾸면 막는다', () => {
    for (const s of ['PRAGMA user_version = 5', 'PRAGMA writable_schema = 1', 'PRAGMA journal_mode = DELETE', 'PRAGMA foreign_keys = OFF', 'PRAGMA key = x', 'PRAGMA wal_checkpoint', 'PRAGMA temp_store_directory = "/tmp"', 'PRAGMA table_info = x', 'PRAGMA user_version(5)', 'PRAGMA other.table_info(t)', 'PRAGMA', 'PRAGMA ;']) expect(blocked(s), s).toBe(true);
  });
  it('EXPLAIN 뒤에 막는 문장이 와도 막는다', () => {
    expect(blocked("EXPLAIN ATTACH 'a' AS b")).toBe(true);
    expect(kind('EXPLAIN DELETE FROM t')).toBe('write');
  });
  it('닫히지 않은 따옴표로 뒤를 숨기려는 입력은 거절한다', () => {
    expect(() => SqlStatement.parse("SELECT 'abc")).toThrow(DbInputError);
    expect(() => SqlStatement.parse('SELECT "abc')).toThrow(DbInputError);
  });
  it('모르는 첫 낱말·빈 문장·글이 아닌 값·너무 긴 값은 거절한다', () => {
    for (const s of ['', '   ', '-- only a comment', ';', 'FOO BAR', '1', '(SELECT 1)', undefined, 5, 'SELECT ' + '1,'.repeat(60000) + '1']) expect(() => SqlStatement.parse(s), String(s)).toThrow(DbInputError);
  });
  it('NUL 이 든 SQL 은 거절한다', () => {
    expect(() => SqlStatement.parse('SELECT 1\0; ATTACH')).toThrow(DbInputError);
  });
});

describe('안전한 PRAGMA 목록', () => {
  it('값 없이 읽는 것과 괄호 인자로 읽는 것을 가른다', () => {
    expect(isSafePragma('table_info')).toBe(true);
    expect(isSafePragma('user_version')).toBe(true);
    expect(isSafePragma('writable_schema')).toBe(false);
    expect(isSafePragma('TABLE_INFO')).toBe(true);
  });
});
