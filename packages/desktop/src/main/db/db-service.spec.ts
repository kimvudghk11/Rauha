import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbFailure, DbResult } from '../../shared/db-api.js';
import { DbService } from './db-service.js';
import { checkSqliteFile } from './db-file.js';
import { MemoryConnectionsStore } from './db-store.js';
import { ProcessRunner } from './sqlite-runner.js';
import { childSource, hasSqlite, makeDb, SHOP_SEED, tempDir } from './sqlite-test-kit.js';

const kit = tempDir();
afterAll(() => kit.cleanup());

let counter = 0;
const saved: { fileName: string; text: string }[] = [];
let nextPick: string | null = null;
function newService(): DbService {
  return new DbService({
    store: new MemoryConnectionsStore(),
    runner: new ProcessRunner({ execPath: process.execPath, childSource }),
    checkFile: checkSqliteFile,
    pickFile: async () => nextPick,
    saveCsv: async (fileName, text) => {
      saved.push({ fileName, text });
      return join(kit.dir, fileName);
    },
    newId: () => `id${(counter += 1)}`,
    now: () => 1000 + counter,
  });
}
function data<T>(r: DbResult<T>): T {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.failure)}`);
  return r.data;
}
function bad<T>(r: DbResult<T>): DbFailure {
  if (r.ok) throw new Error(`expected a failure: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.failure;
}

describe.skipIf(!hasSqlite())('DB 서비스', () => {
  let shop = '';
  beforeAll(() => {
    shop = makeDb(join(kit.dir, 'shop.db'), SHOP_SEED);
  });

  it('파일 경로를 더하면 목록에 이름이 보이고, 같은 파일을 또 더해도 하나다', async () => {
    const s = newService();
    const a = data(await s.addPath({ path: shop }));
    expect(a.name).toBe('shop.db');
    expect(data(await s.addPath({ path: shop })).id).toBe(a.id);
    expect(data(await s.list()).connections.map((c) => c.id)).toContain(a.id);
  });

  it('파일 고르기 창으로 더한다(취소하면 아무 일 없다)', async () => {
    const s = newService();
    nextPick = null;
    expect(data(await s.pick())).toBeNull();
    nextPick = shop;
    expect(data(await s.pick())?.name).toBe('shop.db');
    expect(data(await s.list()).connections).toHaveLength(1);
  });

  it('연결 id 로 테이블·스키마·행 보기·쿼리를 쓴다', async () => {
    const s = newService();
    const { id } = data(await s.addPath({ path: shop }));
    expect(data(await s.tables(id)).map((t) => t.name)).toEqual(['blobs', 'users', 'weird "table', 'adults']);
    expect(data(await s.detail({ id, table: 'users' })).columns).toHaveLength(4);
    const page = data(await s.rows({ id, table: 'users', page: 0, sort: { column: 'name', dir: 'asc' } }));
    expect(page.result.rows.map((r) => r[1])).toEqual(['Ada', 'Linus', '김평화']);
    const q = data(await s.query({ id, sql: 'SELECT count(*) AS n FROM users', writeMode: false, confirm: false }));
    expect(q.rows).toEqual([[3]]);
  });

  it('지우면 목록에서 빠지고 그 id 로는 더 못 쓴다', async () => {
    const s = newService();
    const { id } = data(await s.addPath({ path: shop }));
    expect(data(await s.remove(id)).connections).toEqual([]);
    expect(bad(await s.tables(id)).kind).toBe('bad-input');
  });

  it('읽기 모드에서 쓰기 문장은 실행되기 전에 거절되고 파일은 그대로다', async () => {
    const s = newService();
    const f = makeDb(join(kit.dir, 'ro.db'), 'CREATE TABLE t (a); INSERT INTO t VALUES (1);');
    const before = readFileSync(f);
    const { id } = data(await s.addPath({ path: f }));
    expect(bad(await s.query({ id, sql: 'DELETE FROM t', writeMode: false, confirm: true })).kind).toBe('write-mode');
    expect(bad(await s.query({ id, sql: 'DROP TABLE t', writeMode: false, confirm: true })).kind).toBe('write-mode');
    expect(readFileSync(f).equals(before)).toBe(true);
  });

  it('쓰기 모드여도 확인이 없으면 거절하고, 둘 다 있으면 실행한다', async () => {
    const s = newService();
    const f = makeDb(join(kit.dir, 'rw.db'), 'CREATE TABLE t (a); INSERT INTO t VALUES (1),(2);');
    const { id } = data(await s.addPath({ path: f }));
    expect(bad(await s.query({ id, sql: 'DELETE FROM t', writeMode: true, confirm: false })).kind).toBe('confirm');
    expect(data(await s.query({ id, sql: 'SELECT count(*) FROM t', writeMode: false, confirm: false })).rows).toEqual([[2]]);
    const done = data(await s.query({ id, sql: 'DELETE FROM t WHERE a = 1', writeMode: true, confirm: true }));
    expect(done.changes).toBe(1);
    expect(done.kind).toBe('write');
    expect(data(await s.query({ id, sql: 'SELECT count(*) FROM t', writeMode: false, confirm: false })).rows).toEqual([[1]]);
  });

  it('쓰기 모드가 켜져 있어도 읽기 문장은 읽기 전용으로 열린다', async () => {
    const s = newService();
    const { id } = data(await s.addPath({ path: shop }));
    const r = data(await s.query({ id, sql: 'SELECT 1', writeMode: true, confirm: true }));
    expect(r.rows).toEqual([[1]]);
  });

  it('시간 제한이 지나면 timeout 실패를 돌려주고, 쓰는 도중이었으면 파일을 되돌려 놓는다', async () => {
    const s = newService();
    const f = makeDb(join(kit.dir, 'timeout.db'), 'CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);');
    const { id } = data(await s.addPath({ path: f }));
    const failure = bad(await s.query({ id, sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) INSERT INTO t SELECT x FROM c', writeMode: true, confirm: true, timeoutSec: 1 }));
    expect(failure.kind).toBe('timeout');
    expect(data(await s.query({ id, sql: 'SELECT count(*) FROM t', writeMode: false, confirm: false })).rows).toEqual([[1]]);
  }, 30_000);

  it('실행 중인 쿼리를 키로 취소한다', async () => {
    const s = newService();
    const { id } = data(await s.addPath({ path: shop }));
    const p = s.query({ id, sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c', writeMode: false, confirm: false, key: 'run1', timeoutSec: 30 });
    await new Promise((r) => setTimeout(r, 700));
    expect(await s.cancel('run1')).toBe(true);
    expect(bad(await p).kind).toBe('cancelled');
    expect(await s.cancel('../bad')).toBe(false);
  }, 30_000);

  it('CSV 저장은 BOM 을 붙여 저장 창으로 넘긴다', async () => {
    const s = newService();
    const r = data(await s.exportCsv({ csv: 'a,b\r\n1,2\r\n', name: 'users' }));
    expect(r).toEqual({ saved: true, fileName: 'users.csv' });
    expect(saved.at(-1)!.text.startsWith('\uFEFF')).toBe(true);
  });

  it('SQLite 파일이 사라지면 파일 없음 안내를 준다', async () => {
    const s = newService();
    const f = makeDb(join(kit.dir, 'gone.db'), 'CREATE TABLE t (a);');
    const { id } = data(await s.addPath({ path: f }));
    const { rmSync } = await import('node:fs');
    rmSync(f);
    expect(bad(await s.tables(id)).kind).toBe('no-file');
  });
});

describe.skipIf(!hasSqlite())('경로 검증(렌더러가 보낸 경로를 믿지 않는다)', () => {
  it('SQLite 가 아닌 파일·빈 파일·폴더·없는 파일은 목록에 더해지지 않는다', async () => {
    const s = newService();
    const text = join(kit.dir, 'notes.db');
    writeFileSync(text, 'hello '.repeat(200));
    const empty = join(kit.dir, 'empty.db');
    writeFileSync(empty, '');
    const dir = join(kit.dir, 'folder.db');
    mkdirSync(dir);
    expect(bad(await s.addPath({ path: text })).kind).toBe('not-sqlite');
    expect(bad(await s.addPath({ path: empty })).kind).toBe('not-sqlite');
    expect(bad(await s.addPath({ path: dir })).kind).toBe('bad-input');
    expect(bad(await s.addPath({ path: join(kit.dir, 'missing.db') })).kind).toBe('no-file');
    expect(data(await s.list()).connections).toEqual([]);
  });

  it('상대 경로·.. 경로·UNC·URL·연결 문자열·NUL 경로는 파일을 보기도 전에 거절한다', async () => {
    const s = newService();
    for (const path of ['shop.db', '../shop.db', `${kit.dir}/../x.db`, '\\\\attacker\\share\\x.db', '//attacker/share/x.db', 'file:///etc/passwd', 'postgres://u:pw@h/db', 'sqlite:///x.db', `${kit.dir}/a\0.db`, '', '-f']) {
      const r = await s.addPath({ path });
      expect(r.ok, path).toBe(false);
      if (!r.ok) expect(r.failure.kind, path).toBe('bad-input');
    }
  });

  it('렌더러가 연결 id 대신 경로를 보내도 파일 대신 거절한다', async () => {
    const s = newService();
    const f = makeDb(join(kit.dir, 'idtest.db'), 'CREATE TABLE t (a);');
    for (const id of [f, '../etc/passwd', 'C:\\Windows\\win.ini']) {
      expect(bad(await s.tables(id)).kind).toBe('bad-input');
      expect(bad(await s.query({ id, sql: 'SELECT 1', writeMode: false, confirm: false })).kind).toBe('bad-input');
    }
  });

  it('심볼릭 링크는 가리키는 진짜 파일을 확인하고, SQLite 가 아니면 거절한다', async () => {
    const real = join(kit.dir, 'real.txt');
    writeFileSync(real, 'not sqlite '.repeat(100));
    const link = join(kit.dir, 'link.db');
    try {
      symlinkSync(real, link);
    } catch {
      return; // 윈도우에서 링크를 만들 권한이 없으면 건너뛴다
    }
    const s = newService();
    expect(bad(await s.addPath({ path: link })).kind).toBe('not-sqlite');
  });
});
