import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbProbeSql, DbTableName } from '@rauha/core';
import { DbRequest, type DbResult, type DbResultSet, type DbTableDetail } from '../../shared/db-api.js';
import { DbConnections } from '../../shared/db-connections.js';
import { ConnectionLabel, SavedPassword, ServerTarget } from '../../shared/db-server.js';
import { checkSqliteFile } from './db-file.js';
import { DbService } from './db-service.js';
import { MemoryConnectionsStore } from './db-store.js';
import { ProcessRunner } from './sqlite-runner.js';
import { childSource, hasSqlite, makeDb, tempDir } from './sqlite-test-kit.js';
import { TeamDatabase, linkRepoDatabase, resultText, type TeamDbSource } from './team-db.js';

const T = (n: string) => DbTableName.parse(n);

/** 가짜 서버 DB: 보낸 SQL 을 모으고 정해 둔 결과를 돌려준다 */
function fakeServer(over: Partial<TeamDbSource> = {}, opts: { secret?: string; canOpen?: boolean } = {}): TeamDbSource & { sent: string[] } {
  const sent: string[] = [];
  const c = DbConnections.empty();
  const target = ServerTarget.parse({ kind: 'postgres', host: 'db.prod.internal', port: 5432, user: 'app', database: 'shop' });
  c.addServer(target, ConnectionLabel.parse('Shop', target), SavedPassword.restore('c2VhbGVk'), 'conn1', 1);
  const set = (columns: string[], rows: (string | number | null)[][]): DbResultSet => ({ columns, rows, truncated: null, cellsTruncated: false, bytes: 0, elapsedMs: 1, changes: null, kind: 'read', verb: 'SELECT' });
  return {
    sent,
    connections: async () => c,
    canOpen: async () => opts.canOpen ?? true,
    detail: async (): Promise<DbResult<DbTableDetail>> => ({ ok: true, data: { name: 'users', kind: 'table', columns: [{ name: 'id', type: 'integer', notNull: true, defaultValue: null, primaryKey: 1, hidden: false }, { name: 'email', type: 'text', notNull: false, defaultValue: null, primaryKey: 0, hidden: false }], createSql: null } }),
    query: async (raw: unknown): Promise<DbResult<DbResultSet>> => {
      const r = raw as { sql: string; writeMode: boolean };
      sent.push(`${r.writeMode ? 'W' : 'R'} ${r.sql}`);
      return { ok: true, data: set(['QUERY PLAN'], [['[{"Plan":{"Node Type":"Seq Scan"}}]']]) };
    },
    ...over,
  };
}

describe('레포에 연결된 DB 찾기', () => {
  it('레포 설정과 맞고 바로 열 수 있는 연결이면 이름·종류만 가진 DB 를 돌려준다', async () => {
    const db = await linkRepoDatabase('/repo', fakeServer(), async () => [{ name: '.env', text: 'DATABASE_URL=postgres://app:pw@db.prod.internal:5432/shop' }]);
    expect(db?.name).toBe('shop');
    expect(db?.dialect).toBe('postgres');
    expect(db?.production).toBe(true);
    expect(JSON.stringify(db)).not.toMatch(/db\.prod\.internal|c2VhbGVk|conn1|app@/);
  });

  it('레포 설정과 맞지 않으면 null 이다', async () => {
    expect(await linkRepoDatabase('/repo', fakeServer(), async () => [{ name: '.env', text: 'DB_NAME=blog' }])).toBeNull();
  });

  it('비밀번호를 물어야 하는 연결이면 붙이지 않는다', async () => {
    expect(await linkRepoDatabase('/repo', fakeServer({}, { canOpen: false }), async () => [{ name: '.env', text: 'DB_NAME=shop' }])).toBeNull();
  });
});

describe('팀원 DB 도구(가짜 서버)', () => {
  it('모든 질의는 쓰기 모드 없이(읽기 전용으로) 보낸다', async () => {
    const src = fakeServer();
    const db = (await linkRepoDatabase('/repo', src, async () => [{ name: '.env', text: 'DB_NAME=shop' }]))!;
    await db.tables();
    await db.indexes(T('users'));
    await db.sample(T('users'), 5);
    await db.select('SELECT 1');
    await db.explain('EXPLAIN (FORMAT JSON) SELECT * FROM users');
    expect(src.sent.every((s) => s.startsWith('R '))).toBe(true);
    expect(src.sent).toContain('R SELECT * FROM "users" LIMIT 5');
  });

  it('MySQL·PostgreSQL 카탈로그·샘플·EXPLAIN 질의는 DB 탭의 읽기 전용 검사(db-sql)를 그대로 통과한다', async () => {
    for (const dialect of ['mysql', 'postgres'] as const) {
      const checked: string[] = [];
      const src = fakeServer({
        query: async (raw) => {
          const req = DbRequest.query(raw, dialect);
          checked.push(`${req.statement.kind} ${req.statement.verb}`);
          return { ok: true, data: { columns: ['x'], rows: [], truncated: null, cellsTruncated: false, bytes: 0, elapsedMs: 0, changes: null, kind: 'read', verb: 'SELECT' } };
        },
      });
      const db = TeamDatabase.of(src, { id: 'conn1', dialect, name: 'shop', production: false });
      for (const r of [await db.tables(), await db.describe(T('users')), await db.indexes(T('users')), await db.sample(T('users'), 3), await db.explain(DbProbeSql.explain('SELECT * FROM users WHERE id = 1', dialect))]) expect(r.ok).toBe(true);
      expect(checked.length).toBeGreaterThanOrEqual(5);
      expect(checked.every((c) => c.startsWith('read '))).toBe(true);
    }
  });

  it('EXPLAIN ANALYZE 는 DB 에 닿기 전에 막힌다', () => {
    expect(() => DbProbeSql.explain('SELECT 1', 'postgres')).not.toThrow();
    expect(() => DbProbeSql.select('EXPLAIN ANALYZE DELETE FROM users')).toThrow();
  });

  it('테이블 구조는 열·NOT NULL·기본 키와 외래 키를 함께 보인다', async () => {
    const db = TeamDatabase.of(fakeServer(), { id: 'conn1', dialect: 'postgres', name: 'shop', production: false });
    const text = (await db.describe(T('users'))).text;
    expect(text).toContain('id integer NOT NULL PRIMARY KEY(1)');
    expect(text).toContain('foreign keys:');
  });

  it('실패 글에 쓰기 막힘이면 읽기 전용이라고 알린다', async () => {
    const src = fakeServer({ query: async () => ({ ok: false, failure: { kind: 'write-mode', title: 'Write mode is off', message: 'UPDATE changes the database.', help: null } }) });
    const r = await TeamDatabase.of(src, { id: 'conn1', dialect: 'postgres', name: 'shop', production: false }).select('UPDATE users SET a = 1');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/read-only/);
  });
});

describe('결과 글', () => {
  it('상한보다 많은 행은 자르고 더 있다고 적는다', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [i, 'a\nb']);
    const text = resultText({ columns: ['n', 's'], rows, truncated: null, cellsTruncated: false, bytes: 0, elapsedMs: 0, changes: null, kind: 'read', verb: 'SELECT' }, 10);
    expect(text.split('\n')).toHaveLength(12);
    expect(text).toContain('more rows exist');
    expect(text).toContain('a b');
  });
});

const kit = tempDir();
afterAll(() => kit.cleanup());

describe.skipIf(!hasSqlite())('팀원 DB 도구(실제 SQLite 파일)', () => {
  let db: Awaited<ReturnType<typeof linkRepoDatabase>> = null;
  beforeAll(async () => {
    const repo = join(kit.dir, 'repo');
    const file = makeDb(
      join(kit.dir, 'shop.db'),
      `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT);
       CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), total INTEGER, created_at TEXT);
       CREATE INDEX orders_user ON orders(user_id);
       INSERT INTO users VALUES (1, 'kim@example.com', '김'), (2, 'lee@example.com', '이');
       INSERT INTO orders VALUES (1, 1, 100, '2026-01-01'), (2, 2, 200, '2026-01-02');`,
    );
    let n = 0;
    const service = new DbService({
      store: new MemoryConnectionsStore(),
      runner: new ProcessRunner({ execPath: process.execPath, childSource }),
      servers: { run: () => Promise.resolve({ kind: 'crashed', detail: 'no server' }), cancel: () => false, stopAll: () => undefined },
      secrets: { available: () => false, seal: () => '', open: () => '' },
      checkFile: checkSqliteFile,
      pickFile: async () => null,
      saveCsv: async () => null,
      newId: () => `id${(n += 1)}`,
      now: () => 1000 + n,
    });
    await service.addPath({ path: file });
    // 파일은 레포 밖에 있지만 레포 폴더를 그 파일이 있는 폴더로 두면 "레포 안" 이다
    db = await linkRepoDatabase(kit.dir, service, async () => []);
    void repo;
  });

  it('레포 안의 SQLite 파일 연결을 찾는다', () => {
    expect(db?.dialect).toBe('sqlite');
    expect(db?.name).toBe('shop.db');
  });

  it('테이블 목록·구조(외래 키 포함)·인덱스를 읽는다', async () => {
    expect((await db!.tables()).text).toMatch(/orders \| table/);
    const described = (await db!.describe(T('orders'))).text;
    expect(described).toContain('user_id INTEGER NOT NULL');
    expect(described).toMatch(/users/);
    const idx = (await db!.indexes(T('orders'))).text;
    expect(idx).toContain('orders_user (user_id)');
  });

  it('샘플 행·조회·EXPLAIN QUERY PLAN 을 돌린다', async () => {
    expect((await db!.sample(T('users'), 1)).text).toContain('(1 row)');
    expect((await db!.select('SELECT COUNT(*) AS n FROM orders')).text).toContain('2');
    const plan = await db!.explain('EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 1');
    expect(plan.ok).toBe(true);
    expect(plan.text).toMatch(/orders_user/);
  });

  it('쓰기·DDL 은 db-sql 검사에서 막힌다', async () => {
    for (const sql of ['DELETE FROM users', 'UPDATE users SET name = 1', 'DROP TABLE users', "ATTACH DATABASE 'x' AS y"]) {
      const r = await db!.select(sql);
      expect(r.ok).toBe(false);
    }
    expect((await db!.select('SELECT COUNT(*) FROM users')).text).toContain('2');
  });
});
