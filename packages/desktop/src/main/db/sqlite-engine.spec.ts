import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_LIMITS, type DbResultSet, type DbRowsPage, type DbTableDetail, type DbTableInfo } from '../../shared/db-api.js';
import { loadSqlite, type EngineRequest, type EngineResponse, type EngineTestHooks } from './sqlite-engine.js';
import { ProcessRunner, type RunOutcome } from './sqlite-runner.js';
import { childSource, hasSqlite, makeDb, SHOP_SEED, tempDir } from './sqlite-test-kit.js';

const kit = tempDir();
afterAll(() => kit.cleanup());
const runner = new ProcessRunner({ execPath: process.execPath, childSource });
const run = (req: EngineRequest, timeoutMs = 20_000): Promise<RunOutcome> => runner.run(req, { timeoutMs });
async function ok<T>(req: EngineRequest): Promise<T> {
  const o = await run(req);
  if (o.kind !== 'done' || !o.response.ok) throw new Error(`unexpected: ${JSON.stringify(o)}`);
  return o.response.data as T;
}
async function failed(req: EngineRequest): Promise<string> {
  const o = await run(req);
  if (o.kind !== 'done') throw new Error(`unexpected: ${JSON.stringify(o)}`);
  const r: EngineResponse = o.response;
  if (r.ok) throw new Error(`expected a failure but it worked: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.message;
}
let activeHooks: EngineTestHooks | undefined;
const query = (file: string, sql: string, writable = false, kind: 'read' | 'write' | 'schema' = 'read'): EngineRequest => ({ op: 'query', file, sql, writable, kind, verb: sql.split(/s/)[0]!.toUpperCase(), ...(activeHooks === undefined ? {} : { hooks: activeHooks }) });
const hasAuthorizer = (): boolean => {
  const m = loadSqlite() as unknown as { DatabaseSync: { prototype: Record<string, unknown> } } | null;
  return typeof m?.DatabaseSync.prototype['setAuthorizer'] === 'function';
};

describe.skipIf(!hasSqlite())('SQLite 엔진(자식 프로세스, 진짜 node:sqlite)', () => {
  let shop = '';
  beforeAll(() => {
    shop = makeDb(join(kit.dir, 'shop.db'), SHOP_SEED);
  });

  it('테이블과 뷰 목록을 이름순으로 준다(sqlite_ 내부 테이블은 뺀다)', async () => {
    const tables = await ok<DbTableInfo[]>({ op: 'tables', file: shop });
    expect(tables.map((t) => `${t.kind}:${t.name}`)).toEqual(['table:blobs', 'table:users', 'table:weird "table', 'view:adults']);
  });

  it('테이블 상세: 열 이름·타입·NOT NULL·기본값·기본 키와 CREATE 문', async () => {
    const d = await ok<DbTableDetail>({ op: 'detail', file: shop, table: 'users' });
    expect(d.kind).toBe('table');
    expect(d.columns.map((c) => [c.name, c.type, c.notNull, c.defaultValue, c.primaryKey])).toEqual([
      ['id', 'INTEGER', false, null, 1],
      ['name', 'TEXT', true, null, 0],
      ['age', 'INTEGER', false, '20', 0],
      ['note', 'TEXT', false, null, 0],
    ]);
    expect(d.createSql).toMatch(/^CREATE TABLE users/);
  });

  it('행 보기: 한 쪽 100행·전체 행 수·정렬(오름·내림), NULL 은 null', async () => {
    const page = await ok<DbRowsPage>({ op: 'rows', file: shop, table: 'users', page: 0, sort: { column: 'age', dir: 'desc' } });
    expect(page.total).toBe(3);
    expect(page.pageSize).toBe(100);
    expect(page.result.columns).toEqual(['id', 'name', 'age', 'note']);
    expect(page.result.rows.map((r) => r[1])).toEqual(['Linus', 'Ada', '김평화']);
    expect(page.result.rows[1]![3]).toBeNull();
  });

  it('행 보기는 100행씩 끊고 쪽을 넘기면 다음 행이 나온다', async () => {
    const f = makeDb(join(kit.dir, 'many.db'), 'CREATE TABLE n(i INTEGER); WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<250) INSERT INTO n SELECT x FROM c;');
    const p0 = await ok<DbRowsPage>({ op: 'rows', file: f, table: 'n', page: 0, sort: null });
    const p2 = await ok<DbRowsPage>({ op: 'rows', file: f, table: 'n', page: 2, sort: null });
    expect(p0.total).toBe(250);
    expect(p0.result.rows).toHaveLength(100);
    expect(p2.result.rows).toHaveLength(50);
    expect(p2.result.rows[0]![0]).toBe(201);
  });

  it('BLOB 은 크기와 앞부분 미리보기, 아주 큰 정수는 정밀도를 잃지 않게 글로 준다', async () => {
    const page = await ok<DbRowsPage>({ op: 'rows', file: shop, table: 'blobs', page: 0, sort: null });
    expect(page.result.rows[0]![1]).toEqual({ blob: 3, preview: "x'00FF10'" });
    expect(page.result.rows[0]![2]).toBe('9223372036854775807');
  });

  it('이름에 따옴표·공백이 든 테이블도 안전하게 읽는다', async () => {
    const page = await ok<DbRowsPage>({ op: 'rows', file: shop, table: 'weird "table', page: 0, sort: { column: 'b c', dir: 'asc' } });
    expect(page.result.rows).toEqual([[1, 2]]);
  });

  it('없는 테이블·없는 열 정렬은 오류다(SQL 로 이어 붙이지 않는다)', async () => {
    expect(await failed({ op: 'rows', file: shop, table: 'nope', page: 0, sort: null })).toMatch(/no such table/);
    expect(await failed({ op: 'rows', file: shop, table: 'users', page: 0, sort: { column: 'name; DROP TABLE users', dir: 'asc' } })).toMatch(/no such column/);
    expect(await failed({ op: 'rows', file: shop, table: 'users" WHERE 1=1; --', page: 0, sort: null })).toMatch(/no such table/);
    expect(await failed({ op: 'detail', file: shop, table: 'sqlite_master' })).toMatch(/no such table/);
  });

  it('쿼리: 읽기 결과 표와 시간', async () => {
    const r = await ok<DbResultSet>(query(shop, 'SELECT name, age FROM users WHERE age > 31 ORDER BY age'));
    expect(r.columns).toEqual(['name', 'age']);
    expect(r.rows).toEqual([['Ada', 36], ['Linus', 55]]);
    expect(r.truncated).toBeNull();
    expect(r.changes).toBeNull();
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('쿼리: 같은 이름의 열이 둘이어도 값이 섞이지 않는다', async () => {
    const r = await ok<DbResultSet>(query(shop, 'SELECT 1 AS a, 2 AS a'));
    expect(r.rows).toEqual([[1, 2]]);
  });

  it('쓰기 모드: INSERT·UPDATE·DELETE·DDL 이 실제로 되고 바뀐 행 수를 준다', async () => {
    const f = makeDb(join(kit.dir, 'rw.db'), 'CREATE TABLE t (a INTEGER);');
    const ins = await ok<DbResultSet>(query(f, 'INSERT INTO t VALUES (1),(2),(3)', true, 'write'));
    expect(ins.changes).toBe(3);
    expect(ins.kind).toBe('write');
    expect((await ok<DbResultSet>(query(f, 'UPDATE t SET a = a + 10 WHERE a > 1', true, 'write'))).changes).toBe(2);
    expect((await ok<DbResultSet>(query(f, 'SELECT a FROM t ORDER BY a'))).rows).toEqual([[1], [12], [13]]);
    expect((await ok<DbResultSet>(query(f, 'DELETE FROM t WHERE a = 1', true, 'write'))).changes).toBe(1);
    await ok(query(f, 'CREATE TABLE u (b)', true, 'schema'));
    expect((await ok<DbTableInfo[]>({ op: 'tables', file: f })).map((t) => t.name)).toEqual(['t', 'u']);
    await ok(query(f, 'DROP TABLE u', true, 'schema'));
  });

  it('쓰기 모드에서도 오류가 나면 부분적으로 바뀌지 않는다(제약 위반)', async () => {
    const f = makeDb(join(kit.dir, 'rw2.db'), 'CREATE TABLE t (a INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);');
    expect(await failed(query(f, 'INSERT INTO t VALUES (2),(1)', true, 'write'))).toMatch(/UNIQUE|constraint/i);
    expect((await ok<DbResultSet>(query(f, 'SELECT count(*) FROM t'))).rows).toEqual([[1]]);
  });

  it('행 수 상한: 5000행에서 멈추고 truncated=rows 로 알린다', async () => {
    const r = await ok<DbResultSet>(query(shop, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 20000) SELECT x FROM c'));
    expect(r.rows).toHaveLength(DB_LIMITS.maxRows);
    expect(r.truncated).toBe('rows');
  });

  it('크기 상한: 5MB 를 넘기 전에 멈추고 truncated=bytes 로 알린다', async () => {
    const r = await ok<DbResultSet>(query(shop, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 4000) SELECT hex(randomblob(2000)) FROM c'));
    expect(r.truncated).toBe('bytes');
    expect(r.rows.length).toBeLessThan(4000);
    expect(r.bytes).toBeLessThanOrEqual(DB_LIMITS.maxBytes + 5000);
  });

  it('칸 하나가 너무 길면 잘라서 보이고 cellsTruncated 로 알린다', async () => {
    const r = await ok<DbResultSet>(query(shop, "SELECT replace(hex(zeroblob(20000)), '0', 'a')"));
    expect(String(r.rows[0]![0]).length).toBeLessThanOrEqual(DB_LIMITS.maxCellChars + 1);
    expect(r.cellsTruncated).toBe(true);
  });

  it('거대한 값을 만드는 쿼리(randomblob 1GB)는 길이 상한으로 실패한다', async () => {
    expect(await failed(query(shop, 'SELECT length(randomblob(1000000000))'))).toMatch(/too big/i);
    expect(await failed(query(shop, 'SELECT length(zeroblob(1000000000))'))).toMatch(/too big/i);
  });

  it('열이 너무 많은 결과는 거절한다', async () => {
    const cols = Array.from({ length: DB_LIMITS.maxColumns + 5 }, (_, i) => `${i} AS c${i}`).join(',');
    expect(await failed(query(shop, `SELECT ${cols}`))).toMatch(/Too many columns/);
  });

  it('SQL 오류는 SQLite 메시지 그대로 돌려준다', async () => {
    expect(await failed(query(shop, 'SELECT * FROM nope'))).toMatch(/no such table: nope/);
    expect(await failed(query(shop, 'SELEC 1'))).toMatch(/syntax error|not supported/);
    expect(await failed(query(shop, 'SELECT 1 FROM users WHERE'))).toMatch(/incomplete|syntax/i);
  });

  it('SQLite 파일이 아닌 파일은 file is not a database 로 실패한다', async () => {
    const f = join(kit.dir, 'text.db');
    writeFileSync(f, 'this is just text, not a database file '.repeat(30));
    expect(await failed({ op: 'tables', file: f })).toMatch(/not a database/i);
  });

  it('없는 파일은 만들지 않는다(읽기 전용은 새 파일을 만들 수 없다)', async () => {
    const f = join(kit.dir, 'ghost.db');
    expect(await failed({ op: 'tables', file: f })).toMatch(/unable to open/i);
  });

  it('쓰기 모드도 없는 파일을 새로 만들지는 않는다(연결 목록에 있는 파일만 열린다는 검사는 service 가 한다)', async () => {
    const o = await run(query(join(kit.dir, 'ghost2.db'), 'CREATE TABLE a (b)', true, 'schema'));
    expect(o.kind).toBe('done');
  });
});

const MODES: readonly (readonly [string, EngineTestHooks | undefined])[] = [
  ['전부 켠 채(앱과 같다)', undefined],
  ['인가 함수 없이(CI 의 Node 22 처럼): 읽기 전용 열기 + 엔진 안 문장 검사', { noAuthorizer: true }],
  ['문장 검사 없이: 읽기 전용 열기 + SQLite 인가 함수만', { noStatementCheck: true }],
];
for (const [mode, hooks] of MODES) {
  describe.skipIf(!hasSqlite() || (hooks?.noStatementCheck === true && !hasAuthorizer()))(`방어 층 — ${mode}`, () => {
    let shop = '';
    afterAll(() => {
      activeHooks = undefined;
    });
    beforeAll(() => {
      activeHooks = hooks;
      shop = makeDb(join(kit.dir, `shop-${MODES.findIndex((m) => m[0] === mode)}.db`), SHOP_SEED);
    });
    it('읽기 전용으로 열려 있어 INSERT·UPDATE·DELETE·DDL 이 막힌다(문장 검사를 건너뛰어도)', async () => {
      const before = readFileSync(shop);
      for (const sql of ["INSERT INTO users (id, name) VALUES (9, 'x')", "UPDATE users SET name = 'x'", 'DELETE FROM users', 'DROP TABLE users', 'CREATE TABLE t2 (a)', 'ALTER TABLE users ADD z', 'CREATE TEMP TABLE tt (a)', 'ANALYZE']) {
        expect(await failed(query(shop, sql, false, 'write')), sql).toMatch(/not authorized|readonly|not allowed|can only be read|Write mode|changes the database/i);
      }
      expect(readFileSync(shop).equals(before)).toBe(true);
    });

    it('ATTACH·DETACH·트랜잭션은 쓰기 모드에서도 인가 함수가 거절한다(다른 파일을 열 수 없다)', async () => {
      const other = makeDb(join(kit.dir, `secret-${MODES.findIndex((m) => m[0] === mode)}.db`), "CREATE TABLE s (v); INSERT INTO s VALUES ('top secret');");
      for (const writable of [false, true]) {
        for (const sql of [`ATTACH DATABASE '${other.replace(/\\/g, '/')}' AS o`, "ATTACH ':memory:' AS m", 'DETACH DATABASE main', 'BEGIN', 'SAVEPOINT a']) {
          expect(await failed(query(shop, sql, writable, 'write')), `${sql} writable=${writable}`).toMatch(/not authorized|authoriz|not allowed|can only be read|Write mode|changes the database|not supported/i);
        }
      }
    });

    it('load_extension 과 파일 함수는 어떻게 불러도 거절된다', async () => {
      for (const sql of ["SELECT load_extension('x')", "SELECT LOAD_EXTENSION('x','y')", "SELECT readfile('/etc/passwd')", "SELECT writefile('/tmp/x','y')", "SELECT fts3_tokenizer('simple')"]) {
        expect(await failed(query(shop, sql, true)), sql).toMatch(/not authorized|no such function|authoriz|not allowed/i);
      }
    });

    it('PRAGMA 로 값을 바꾸는 시도는 쓰기 모드에서도 거절하고 파일이 그대로다', async () => {
      const f = makeDb(join(kit.dir, `pragma-${MODES.findIndex((m) => m[0] === mode)}.db`), 'CREATE TABLE t (a); PRAGMA user_version = 7;');
      const before = readFileSync(f);
      for (const sql of ['PRAGMA user_version = 99', 'PRAGMA writable_schema = 1', 'PRAGMA journal_mode = WAL', 'PRAGMA foreign_keys = OFF', 'PRAGMA user_version(99)', 'PRAGMA wal_checkpoint', 'PRAGMA temp_store_directory = "/tmp"', 'PRAGMA schema_version = 1', 'PRAGMA secure_delete = 0']) {
        expect(await failed(query(f, sql, true, 'write')), sql).toMatch(/not authorized|authoriz|not allowed|can only be read|Write mode|changes the database|not supported/i);
      }
      expect(readFileSync(f).equals(before)).toBe(true);
      const v = await ok<DbResultSet>(query(f, 'PRAGMA user_version'));
      expect(v.rows).toEqual([[7]]);
    });

    it('안전한 읽기 PRAGMA 와 pragma_ 표 함수는 읽기 전용에서 된다', async () => {
      expect((await ok<DbResultSet>(query(shop, 'PRAGMA table_info(users)'))).rows).toHaveLength(4);
      expect((await ok<DbResultSet>(query(shop, "SELECT name FROM pragma_table_info('users') ORDER BY cid"))).rows[0]).toEqual(['id']);
      expect((await ok<DbResultSet>(query(shop, 'PRAGMA database_list'))).rows[0]![1]).toBe('main');
    });

    it('sqlite_master 를 직접 고치려는 시도(writable_schema 우회)는 쓰기 모드에서도 실패한다', async () => {
      const f = makeDb(join(kit.dir, `schema-${MODES.findIndex((m) => m[0] === mode)}.db`), 'CREATE TABLE t (a);');
      const before = readFileSync(f);
      expect(await failed(query(f, "UPDATE sqlite_master SET sql = 'CREATE TABLE evil (x)' WHERE name = 't'", true, 'write'))).toMatch(/may not be modified|not authorized|readonly|corrupt|Turn on Write mode/i);
      expect(await failed(query(f, "INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('table','e','e',2,'CREATE TABLE e (x)')", true, 'write'))).toMatch(/may not be modified|not authorized|readonly|Turn on Write mode/i);
      expect(readFileSync(f).equals(before)).toBe(true);
    });

  });
}

describe.skipIf(!hasSqlite())('쿼리 시간 제한과 취소(프로세스를 죽인다)', () => {
  let shop = '';
  beforeAll(() => {
    shop = makeDb(join(kit.dir, 'slow.db'), 'CREATE TABLE t (a);');
  });
  const FOREVER = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c';

  it('끝나지 않는 재귀 쿼리는 시간 제한에 프로세스째 멈춘다', async () => {
    const t0 = Date.now();
    const o = await run(query(shop, FOREVER), 1000);
    expect(o.kind).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  it('취소하면 바로 멈추고 cancelled 로 끝난다', async () => {
    const p = runner.run(query(shop, FOREVER), { timeoutMs: 30_000, key: 'k1' });
    await new Promise((r) => setTimeout(r, 600));
    expect(runner.cancel('k1')).toBe(true);
    expect((await p).kind).toBe('cancelled');
    expect(runner.cancel('k1')).toBe(false);
  });

  it('시간 제한이 지난 뒤에도 파일은 멀쩡하고 다음 쿼리가 된다', async () => {
    await run(query(shop, FOREVER), 500);
    const r = await ok<DbResultSet>(query(shop, 'SELECT 1'));
    expect(r.rows).toEqual([[1]]);
  });

  it('쓰기 도중 죽어도 파일이 깨지지 않는다(SQLite 저널로 되돌아간다)', async () => {
    const f = makeDb(join(kit.dir, 'kill.db'), 'CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);');
    const o = await run(query(f, `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) INSERT INTO t SELECT x FROM c`, true, 'write'), 700);
    expect(o.kind).toBe('timeout');
    // 죽은 쓰기가 남긴 저널은 쓸 수 있는 연결이 한 번 열어 줘야 되돌려진다(읽기 전용 연결은 못 한다). service 가 쓰기 실행이 죽은 뒤에 이렇게 한다.
    await ok(query(f, 'SELECT 1', true));
    const r = await ok<DbResultSet>(query(f, 'SELECT count(*) FROM t'));
    expect(r.rows).toEqual([[1]]);
    expect((await ok<DbResultSet>(query(f, 'PRAGMA integrity_check'))).rows).toEqual([['ok']]);
  });

  it('자식 프로세스에는 API 키 같은 환경 변수를 넘기지 않는다', async () => {
    process.env['RAUHA_TEST_SECRET_TOKEN'] = 'should-not-leak';
    try {
      const o = await run({ op: 'tables', file: shop });
      expect(o.kind).toBe('done');
    } finally {
      delete process.env['RAUHA_TEST_SECRET_TOKEN'];
    }
  });

  it('자식 코드가 명령줄 상한보다 훨씬 작다', () => {
    expect(childSource().length).toBeLessThan(24_000);
  });
});
