import { describe, expect, it } from 'vitest';
import type { DbResultSet, DbRowsPage, DbTableDetail, DbTableInfo } from '../../shared/db-api.js';
import { DbPassword, ServerTarget, type ServerKind } from '../../shared/db-server.js';
import { CONNECT_TIMEOUT_MS, ServerEngine, type RowSink, type ServerDriver, type ServerSession } from './server-engine.js';
import type { RunOutcome } from './sqlite-runner.js';

type Answer = { readonly columns?: readonly string[]; readonly rows?: readonly (readonly unknown[])[]; readonly changes?: number | null } | Error | 'hang';
type Script = (sql: string, params: readonly unknown[]) => Answer;

/** 가짜 드라이버: 받은 문장을 적어 두고 script 대로 답한다 */
class FakeDriver implements ServerDriver {
  readonly ran: { sql: string; params: readonly unknown[] }[] = [];
  readonly connects: { host: string; password: string; connectTimeoutMs: number; statementTimeoutMs: number }[] = [];
  destroyed = 0;
  closed = 0;
  constructor(private readonly script: Script) {}
  async connect(o: { readonly target: ServerTarget; readonly password: string; readonly connectTimeoutMs: number; readonly statementTimeoutMs: number }): Promise<ServerSession> {
    this.connects.push({ host: o.target.host, password: o.password, connectTimeoutMs: o.connectTimeoutMs, statementTimeoutMs: o.statementTimeoutMs });
    let dead = false;
    let wake: ((e: Error) => void) | null = null;
    return {
      run: (sql: string, params: readonly unknown[], sink: RowSink) => {
        if (dead) return Promise.reject(new Error('Connection is closed.'));
        this.ran.push({ sql, params });
        const a = this.script(sql, params);
        if (a === 'hang') return new Promise((_r, reject) => (wake = reject));
        if (a instanceof Error) return Promise.reject(a);
        if (a.columns !== undefined && a.columns.length > 0) sink.columns(a.columns);
        for (const row of a.rows ?? []) {
          if (!sink.row(row)) {
            dead = true;
            this.destroyed += 1;
            return Promise.resolve({ changes: null, stopped: true });
          }
        }
        return Promise.resolve({ changes: a.changes ?? null, stopped: false });
      },
      close: async () => {
        this.closed += 1;
      },
      destroy: () => {
        dead = true;
        this.destroyed += 1;
        wake?.(new Error('Connection terminated'));
      },
    };
  }
}

const target = (kind: ServerKind) => ServerTarget.parse({ kind, host: 'db.local', user: 'app', database: 'shop' });
const pw = DbPassword.parse('Secr3tPw');
const setup = (kind: ServerKind, script: Script) => {
  const driver = new FakeDriver(script);
  const engine = new ServerEngine({ [kind]: driver } as unknown as Record<ServerKind, ServerDriver>);
  return { driver, engine, conn: { target: target(kind), password: pw } };
};
function done<T>(o: RunOutcome): T {
  if (o.kind !== 'done') throw new Error(`expected done, got ${o.kind}`);
  if (!o.response.ok) throw new Error(`expected ok: ${o.response.message}`);
  return o.response.data as T;
}
function errorText(o: RunOutcome): string {
  if (o.kind !== 'done' || o.response.ok) throw new Error(`expected an error, got ${o.kind}`);
  return o.response.message;
}
const plain = (sqls: { sql: string }[]) => sqls.map((r) => r.sql);
const T = { timeoutMs: 5000, key: null };

describe('서버 엔진: 읽기 전용과 쓰기', () => {
  it('MySQL 읽기 쿼리는 읽기 전용 트랜잭션 안에서 돌고 끝나면 되돌린다', async () => {
    const { driver, engine, conn } = setup('mysql', (sql) => (sql === 'SELECT 1 AS n' ? { columns: ['n'], rows: [[1]] } : {}));
    const r = done<DbResultSet>(await engine.run(conn, { op: 'query', sql: 'SELECT 1 AS n', writable: false, kind: 'read', verb: 'SELECT' }, T));
    expect(r.rows).toEqual([[1]]);
    expect(r.changes).toBeNull();
    expect(plain(driver.ran)).toEqual(['SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION READ ONLY', 'SELECT 1 AS n', 'ROLLBACK']);
    expect(driver.closed).toBe(1);
  });

  it('PostgreSQL 읽기 쿼리는 BEGIN READ ONLY … ROLLBACK 안에서 돈다', async () => {
    const { driver, engine, conn } = setup('postgres', () => ({}));
    await engine.run(conn, { op: 'query', sql: 'SELECT 1', writable: false, kind: 'read', verb: 'SELECT' }, T);
    expect(plain(driver.ran)).toEqual(['BEGIN READ ONLY', 'SELECT 1', 'ROLLBACK']);
  });

  it('쓰기 허락이 있는 쓰기 문장은 트랜잭션 없이 바로 돌고 바뀐 행 수를 돌려준다', async () => {
    const { driver, engine, conn } = setup('postgres', () => ({ changes: 3 }));
    const r = done<DbResultSet>(await engine.run(conn, { op: 'query', sql: 'DELETE FROM t', writable: true, kind: 'write', verb: 'DELETE' }, T));
    expect(r.changes).toBe(3);
    expect(r.kind).toBe('write');
    expect(plain(driver.ran)).toEqual(['DELETE FROM t']);
  });

  it('쓰기 허락 없이 온 쓰기 문장은 엔진에서도 한 번 더 막아 서버에 보내지 않는다', async () => {
    const { driver, engine, conn } = setup('mysql', () => ({ changes: 1 }));
    const text = errorText(await engine.run(conn, { op: 'query', sql: 'DELETE FROM t', writable: false, kind: 'read', verb: 'DELETE' }, T));
    expect(text).toMatch(/Write mode/);
    expect(plain(driver.ran)).not.toContain('DELETE FROM t');
  });
});

describe('서버 엔진: 상한 · 시간 · 취소 · 비밀번호', () => {
  it('결과는 5,000행에서 자르고 드라이버에 그만 받으라고 알린다', async () => {
    const rows = Array.from({ length: 6000 }, (_v, i) => [i]);
    const { driver, engine, conn } = setup('mysql', (sql) => (sql.startsWith('SELECT') ? { columns: ['i'], rows } : {}));
    const r = done<DbResultSet>(await engine.run(conn, { op: 'query', sql: 'SELECT i FROM big', writable: false, kind: 'read', verb: 'SELECT' }, T));
    expect(r.rows).toHaveLength(5000);
    expect(r.truncated).toBe('rows');
    expect(driver.destroyed).toBe(1);
  });

  it('접속에는 10초 제한, 문장에는 고른 시간 제한을 드라이버에 넘긴다', async () => {
    const { driver, engine, conn } = setup('postgres', () => ({}));
    await engine.run(conn, { op: 'ping' }, { timeoutMs: 30_000, key: null });
    expect(driver.connects[0]).toMatchObject({ connectTimeoutMs: CONNECT_TIMEOUT_MS, statementTimeoutMs: 30_000, password: 'Secr3tPw' });
    expect(CONNECT_TIMEOUT_MS).toBe(10_000);
  });

  it('시간 제한이 지나면 연결을 끊고 timeout 으로 끝난다', async () => {
    const { driver, engine, conn } = setup('mysql', (sql) => (sql.startsWith('SELECT') ? 'hang' : {}));
    const o = await engine.run(conn, { op: 'query', sql: 'SELECT SLEEP(100)', writable: false, kind: 'read', verb: 'SELECT' }, { timeoutMs: 50, key: null });
    expect(o.kind).toBe('timeout');
    expect(driver.destroyed).toBeGreaterThanOrEqual(1);
  });

  it('실행 중인 쿼리를 키로 취소하면 연결을 끊고 cancelled 로 끝난다', async () => {
    const { engine, conn } = setup('postgres', (sql) => (sql.startsWith('SELECT') ? 'hang' : {}));
    const p = engine.run(conn, { op: 'query', sql: 'SELECT pg_sleep(100)', writable: false, kind: 'read', verb: 'SELECT' }, { timeoutMs: 30_000, key: 'k1' });
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.cancel('k1')).toBe(true);
    expect((await p).kind).toBe('cancelled');
    expect(engine.cancel('k1')).toBe(false);
  });

  it('오류 글에 비밀번호가 섞여 있어도 지우고 돌려준다', async () => {
    const { engine, conn } = setup('mysql', () => new Error('weird failure near Secr3tPw'));
    const text = errorText(await engine.run(conn, { op: 'ping' }, T));
    expect(text).not.toContain('Secr3tPw');
  });

  it('접속이 실패하면 오류 응답으로 돌려준다(던지지 않는다)', async () => {
    const engine = new ServerEngine({ mysql: { connect: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:3306')) }, postgres: new FakeDriver(() => ({})) });
    expect(errorText(await engine.run({ target: target('mysql'), password: pw }, { op: 'ping' }, T))).toMatch(/ECONNREFUSED/);
  });
});

describe('서버 엔진: 테이블 · 스키마 · 행 보기', () => {
  const mysqlCatalog: Script = (sql, params) => {
    if (/information_schema\.TABLES/i.test(sql)) {
      const all = [['orders', 'BASE TABLE'], ['users', 'BASE TABLE'], ['adults', 'VIEW']];
      return { columns: ['name', 'type'], rows: params.length > 0 ? all.filter((r) => r[0] === params[0]) : all };
    }
    if (/information_schema\.COLUMNS/i.test(sql)) return { columns: ['name', 'type', 'nullable', 'dflt', 'extra'], rows: [['id', 'int', 'NO', null, 'auto_increment'], ['name', 'varchar(50)', 'YES', 'x', ''], ['g', 'int', 'YES', null, 'VIRTUAL GENERATED']] };
    if (/STATISTICS/i.test(sql)) return { columns: ['name', 'seq'], rows: [['id', 1]] };
    if (/^SHOW CREATE TABLE/i.test(sql)) return { columns: ['Table', 'Create Table'], rows: [['users', 'CREATE TABLE `users` (...)']] };
    if (/COUNT\(\*\)/.test(sql)) return { columns: ['n'], rows: [['250']] };
    if (/^SELECT \* FROM/.test(sql)) return { columns: ['id', 'name'], rows: [[1, 'Ada']] };
    return {};
  };

  it('MySQL 테이블 목록은 테이블과 뷰를 가른다', async () => {
    const { engine, conn } = setup('mysql', mysqlCatalog);
    const t = done<DbTableInfo[]>(await engine.run(conn, { op: 'tables' }, T));
    expect(t).toEqual([{ name: 'orders', kind: 'table' }, { name: 'users', kind: 'table' }, { name: 'adults', kind: 'view' }]);
  });

  it('MySQL 스키마는 열·기본 키·생성 열·CREATE 문을 보여 준다', async () => {
    const { engine, conn } = setup('mysql', mysqlCatalog);
    const d = done<DbTableDetail>(await engine.run(conn, { op: 'detail', table: 'users' }, T));
    expect(d.kind).toBe('table');
    expect(d.columns.map((c) => [c.name, c.notNull, c.primaryKey, c.hidden])).toEqual([['id', true, 1, false], ['name', false, 0, false], ['g', false, 0, true]]);
    expect(d.createSql).toContain('CREATE TABLE');
  });

  it('행 보기는 백틱으로 이름을 감싸고, 쪽·정렬·전체 수를 돌려준다', async () => {
    const { driver, engine, conn } = setup('mysql', mysqlCatalog);
    const r = done<DbRowsPage>(await engine.run(conn, { op: 'rows', table: 'users', page: 2, sort: { column: 'name', dir: 'desc' } }, T));
    expect(r.total).toBe(250);
    expect(r.result.rows).toEqual([[1, 'Ada']]);
    expect(plain(driver.ran)).toContain('SELECT * FROM `users` ORDER BY `name` DESC LIMIT 100 OFFSET 200');
  });

  it('없는 테이블·없는 정렬 열은 서버에 SELECT 를 보내기 전에 거절한다', async () => {
    const { driver, engine, conn } = setup('mysql', mysqlCatalog);
    expect(errorText(await engine.run(conn, { op: 'rows', table: 'nope`; DROP', page: 0, sort: null }, T))).toMatch(/no such table/);
    expect(errorText(await engine.run(conn, { op: 'rows', table: 'users', page: 0, sort: { column: 'evil', dir: 'asc' } }, T))).toMatch(/no such column/);
    expect(plain(driver.ran).some((s) => s.startsWith('SELECT * FROM'))).toBe(false);
  });

  it('PostgreSQL 행 보기는 큰따옴표로 이름을 감싼다', async () => {
    const pgCatalog: Script = (sql, params) => {
      if (/information_schema\.tables/.test(sql)) return { columns: ['name', 'type'], rows: [['weird "t', 'BASE TABLE']].filter((r) => params.length === 0 || r[0] === params[0]) };
      if (/information_schema\.columns/.test(sql)) return { columns: ['name', 'type', 'nullable', 'dflt', 'generated', 'pk'], rows: [['a b', 'integer', 'NO', null, 'NEVER', 1]] };
      if (/count\(\*\)/i.test(sql)) return { columns: ['n'], rows: [[1]] };
      return { columns: ['a b'], rows: [[1]] };
    };
    const { driver, engine, conn } = setup('postgres', pgCatalog);
    done<DbRowsPage>(await engine.run(conn, { op: 'rows', table: 'weird "t', page: 0, sort: { column: 'a b', dir: 'asc' } }, T));
    expect(plain(driver.ran)).toContain('SELECT * FROM "weird ""t" ORDER BY "a b" ASC LIMIT 100 OFFSET 0');
    const d = done<DbTableDetail>(await engine.run(conn, { op: 'detail', table: 'weird "t' }, T));
    expect(d.columns[0]).toMatchObject({ name: 'a b', type: 'integer', notNull: true, primaryKey: 1 });
  });

  it('서버 값(날짜·참거짓·JSON·BLOB·큰 정수)을 표 칸으로 바꾼다', async () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    const { engine, conn } = setup('postgres', (sql) => (sql === 'SELECT v' ? { columns: ['a', 'b', 'c', 'd', 'e', 'f'], rows: [[when, true, { k: 1 }, Buffer.from([0, 255]), 2n ** 70n, null]] } : {}));
    const r = done<DbResultSet>(await engine.run(conn, { op: 'query', sql: 'SELECT v', writable: false, kind: 'read', verb: 'SELECT' }, T));
    expect(r.rows[0]).toEqual(['2026-01-02T03:04:05.000Z', 'true', '{"k":1}', { blob: 2, preview: "x'00FF'" }, (2n ** 70n).toString(), null]);
  });
});
