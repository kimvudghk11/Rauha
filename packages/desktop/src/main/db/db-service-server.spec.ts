import { describe, expect, it } from 'vitest';
import type { DbFailure, DbResult } from '../../shared/db-api.js';
import { DbService } from './db-service.js';
import { MemoryConnectionsStore } from './db-store.js';
import type { SecretBox } from './server-passwords.js';
import type { ServerConnection, ServerOutcome, ServerRequest, ServerRunner } from './server-engine.js';
import type { EngineRunner } from './sqlite-runner.js';

/** 가짜 서버: 비밀번호가 'right' 일 때만 들어가진다 */
class FakeServers implements ServerRunner {
  readonly seen: { password: string; req: ServerRequest }[] = [];
  answer: (req: ServerRequest) => ServerOutcome = () => ({ kind: 'done', response: { ok: true, data: [] } });
  async run(conn: ServerConnection, req: ServerRequest): Promise<ServerOutcome> {
    this.seen.push({ password: conn.password.reveal(), req });
    if (conn.password.reveal() !== 'right') return { kind: 'done', response: { ok: false, code: 'error', message: `password authentication failed for user "${conn.target.user}"` } };
    return this.answer(req);
  }
  cancel(): boolean {
    return false;
  }
  stopAll(): void {}
}

/** 가짜 암호 상자: 뒤집어서 base64 로 */
const box = (available = true): SecretBox & { opened: number; broken: boolean } => {
  const b = {
    opened: 0,
    broken: false,
    available: () => available,
    seal: (plain: string) => Buffer.from(plain.split('').reverse().join('')).toString('base64'),
    open(sealed: string): string {
      b.opened += 1;
      if (b.broken) throw new Error('cannot decrypt');
      return Buffer.from(sealed, 'base64').toString().split('').reverse().join('');
    },
  };
  return b;
};

const noSqlite: EngineRunner = {
  run: () => Promise.resolve({ kind: 'crashed', detail: 'not used' }),
  cancel: () => false,
  stopAll: () => undefined,
};

let counter = 0;
function newService(store = new MemoryConnectionsStore(), secrets: SecretBox = box(), servers = new FakeServers()) {
  const service = new DbService({
    store,
    runner: noSqlite,
    servers,
    secrets,
    checkFile: () => Promise.resolve({ ok: false, failure: { kind: 'no-file', title: '', message: '', help: null } }),
    pickFile: async () => null,
    saveCsv: async () => null,
    newId: () => `id${(counter += 1)}`,
    now: () => 1000 + counter,
  });
  return { service, store, servers };
}
function data<T>(r: DbResult<T>): T {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.failure)}`);
  return r.data;
}
function bad<T>(r: DbResult<T>): DbFailure {
  if (r.ok) throw new Error('expected a failure');
  return r.failure;
}
const form = (o: Record<string, unknown> = {}) => ({ name: 'Shop', kind: 'postgres', host: 'db.local', port: '', user: 'app', password: 'right', database: 'shop', ssl: 'off', savePassword: true, ...o });

describe('DB 서비스: 서버 연결', () => {
  it('서버 연결은 먼저 접속해 보고, 되면 목록에 저장한다(비밀번호는 암호문으로만)', async () => {
    const { service, store } = newService();
    const v = data(await service.addServer(form()));
    expect(v).toMatchObject({ kind: 'postgres', name: 'Shop', path: 'app@db.local:5432/shop', savedPassword: true });
    const list = data(await service.list());
    expect(list.canSavePasswords).toBe(true);
    expect(JSON.stringify(list)).not.toContain('right');
    const loc = (await store.load()).locate(v.id);
    expect(loc?.kind === 'server' && loc.password.isSaved()).toBe(true);
  });

  it('접속이 안 되면(비밀번호 틀림) 저장하지 않고 로그인 실패를 알린다', async () => {
    const { service } = newService();
    const f = bad(await service.addServer(form({ password: 'wrong' })));
    expect(f.kind).toBe('auth');
    expect(f.message).not.toContain('wrong');
    expect(data(await service.list()).connections).toEqual([]);
  });

  it('저장한 비밀번호는 다음 실행에서 풀어 쓰고, 화면에 다시 보내지 않는다', async () => {
    const store = new MemoryConnectionsStore();
    const { service } = newService(store);
    const v = data(await service.addServer(form()));
    const later = newService(store);
    expect(data(await later.service.tables(v.id))).toEqual([]);
    expect(later.servers.seen.at(-1)?.password).toBe('right');
  });

  it('암호화를 못 쓰면 비밀번호를 저장하지 않고 이번 실행 동안만 기억한다 → 다음 실행에서는 다시 묻는다', async () => {
    const store = new MemoryConnectionsStore();
    const { service } = newService(store, box(false));
    const v = data(await service.addServer(form()));
    expect(v.savedPassword).toBe(false);
    expect(data(await service.list()).canSavePasswords).toBe(false);
    expect(data(await service.tables(v.id))).toEqual([]);
    const later = newService(store, box(false));
    expect(bad(await later.service.tables(v.id)).kind).toBe('need-password');
    expect(later.servers.seen).toHaveLength(0);
    expect(bad(await later.service.unlock({ id: v.id, password: 'wrong' })).kind).toBe('auth');
    expect(data(await later.service.unlock({ id: v.id, password: 'right' })).id).toBe(v.id);
    expect(data(await later.service.tables(v.id))).toEqual([]);
  });

  it('저장해 둔 암호문을 이 컴퓨터에서 못 풀면 비밀번호를 다시 묻고, 다시 받으면 새로 저장한다', async () => {
    const store = new MemoryConnectionsStore();
    const secrets = box();
    const { service } = newService(store, secrets);
    const v = data(await service.addServer(form()));
    secrets.broken = true;
    const later = newService(store, secrets);
    expect(bad(await later.service.tables(v.id)).kind).toBe('need-password');
    secrets.broken = false;
    data(await later.service.unlock({ id: v.id, password: 'right', savePassword: true }));
    expect((await store.load()).find(v.id)?.savedPassword).toBe(true);
  });

  it('비밀번호를 저장하지 말라고 하면 암호문도 남기지 않는다', async () => {
    const { service } = newService();
    expect(data(await service.addServer(form({ savePassword: false }))).savedPassword).toBe(false);
  });

  it('서버 쿼리는 그 서버의 문법으로 검사하고, 쓰기 문장은 쓰기 모드와 확인이 있어야 서버로 간다', async () => {
    const { service, servers } = newService(undefined, box(), new FakeServers());
    const { id } = data(await service.addServer(form({ kind: 'mysql' })));
    servers.answer = () => ({ kind: 'done', response: { ok: true, data: { columns: [], rows: [], truncated: null, cellsTruncated: false, bytes: 0, elapsedMs: 1, changes: 1, kind: 'write', verb: 'DELETE' } } });
    expect(data(await service.query({ id, sql: 'SHOW TABLES', writeMode: false, confirm: false })).verb).toBe('DELETE');
    expect(bad(await service.query({ id, sql: 'DELETE FROM t', writeMode: false, confirm: true })).kind).toBe('write-mode');
    expect(bad(await service.query({ id, sql: 'DELETE FROM t', writeMode: true, confirm: false })).kind).toBe('confirm');
    const before = servers.seen.length;
    data(await service.query({ id, sql: 'DELETE FROM t', writeMode: true, confirm: true }));
    expect(servers.seen.length).toBe(before + 1);
    expect(servers.seen.at(-1)?.req).toMatchObject({ op: 'query', writable: true, kind: 'write' });
  });

  it('읽기 문장은 쓰기 모드가 켜져 있어도 읽기 전용으로 보낸다', async () => {
    const { service, servers } = newService();
    const { id } = data(await service.addServer(form()));
    await service.query({ id, sql: 'SELECT 1', writeMode: true, confirm: true });
    expect(servers.seen.at(-1)?.req).toMatchObject({ op: 'query', writable: false });
  });

  it('서버 시간 초과·취소는 SQLite 와 같은 실패로 보인다', async () => {
    const { service, servers } = newService();
    const { id } = data(await service.addServer(form()));
    servers.answer = () => ({ kind: 'timeout' });
    expect(bad(await service.query({ id, sql: 'SELECT 1', writeMode: false, confirm: false, timeoutSec: 1 })).kind).toBe('timeout');
  });

  it('연결을 지우면 이번 실행에서 기억한 비밀번호도 잊는다', async () => {
    const store = new MemoryConnectionsStore();
    const { service } = newService(store, box(false));
    const v = data(await service.addServer(form()));
    data(await service.remove(v.id));
    const again = data(await service.addServer(form({ password: 'right' })));
    expect(again.id).not.toBe(v.id);
    expect(bad(await service.tables(v.id)).kind).toBe('bad-input');
  });
});

describe('DB 서비스: 서버 연결 고치기·접속 시험', () => {
  it('접속 시험은 저장하지 않고 되는지만 알려 준다', async () => {
    const { service } = newService();
    expect(data(await service.testServer(form())).elapsedMs).toBeGreaterThanOrEqual(0);
    expect(bad(await service.testServer(form({ password: 'wrong' }))).kind).toBe('auth');
    expect(data(await service.list()).connections).toEqual([]);
  });
  it('고치는 중인 연결은 비밀번호를 비워도 저장한 비밀번호로 시험한다', async () => {
    const { service, servers } = newService();
    const v = data(await service.addServer(form()));
    data(await service.testServer(form({ id: v.id, password: '', keepPassword: true, host: 'db2.local' })));
    expect(servers.seen.at(-1)?.password).toBe('right');
  });
  it('고치면 같은 id 로 대상이 바뀌고, 비밀번호를 비우면 저장한 것을 그대로 쓴다', async () => {
    const { service, store, servers } = newService();
    const v = data(await service.addServer(form()));
    const e = data(await service.editServer(form({ id: v.id, name: 'Shop 2', host: 'db2.local', port: '6543', password: '', keepPassword: true })));
    expect(e).toMatchObject({ id: v.id, name: 'Shop 2', path: 'app@db2.local:6543/shop', savedPassword: true });
    expect(servers.seen.at(-1)?.password).toBe('right');
    expect((await store.load()).list()).toHaveLength(1);
  });
  it('고친 값으로 접속이 안 되면 바꾸지 않는다', async () => {
    const { service, store } = newService();
    const v = data(await service.addServer(form()));
    expect(bad(await service.editServer(form({ id: v.id, host: 'db2.local', password: 'wrong', keepPassword: false }))).kind).toBe('auth');
    expect((await store.load()).find(v.id)?.path).toBe('app@db.local:5432/shop');
  });
  it('기억한 비밀번호가 없는데 비밀번호를 비우면 비밀번호를 달라고 한다', async () => {
    const store = new MemoryConnectionsStore();
    const { service } = newService(store, box(false));
    const v = data(await service.addServer(form()));
    const later = newService(store, box(false));
    expect(bad(await later.service.editServer(form({ id: v.id, password: '', keepPassword: true }))).kind).toBe('need-password');
  });
});

describe('DB 서비스: 붙은 주소(via)', () => {
  const via = { index: 1, total: 2, label: 'Public', endpoint: '3.35.12.4:5432' };
  const twoHosts = form({ host: undefined, addresses: [{ host: '10.0.0.5', label: 'Private' }, { host: '3.35.12.4', label: 'Public' }] });

  it('서버를 열면 붙은 주소를 이번 실행 동안 기억해 연결 목록에 함께 보인다', async () => {
    const servers = new FakeServers();
    const { service } = newService(undefined, box(), servers);
    servers.answer = () => ({ kind: 'done', response: { ok: true, data: [] }, via });
    const v = data(await service.addServer(twoHosts));
    expect(v.server?.addresses.map((a) => a.host)).toEqual(['10.0.0.5', '3.35.12.4']);
    data(await service.tables(v.id));
    expect(data(await service.list()).connections.find((c) => c.id === v.id)?.via).toEqual(via);
  });

  it('접속 시험도 어느 주소로 붙었는지 알려 준다', async () => {
    const servers = new FakeServers();
    const { service } = newService(undefined, box(), servers);
    servers.answer = () => ({ kind: 'done', response: { ok: true, data: true }, via });
    expect(data(await service.testServer(twoHosts)).via).toEqual(via);
  });

  it('목록에서 지우면 기억한 주소도 잊는다', async () => {
    const servers = new FakeServers();
    const { service } = newService(undefined, box(), servers);
    servers.answer = () => ({ kind: 'done', response: { ok: true, data: [] }, via });
    const v = data(await service.addServer(twoHosts));
    data(await service.tables(v.id));
    data(await service.remove(v.id));
    const again = data(await service.addServer(twoHosts));
    expect(data(await service.list()).connections.find((c) => c.id === again.id)?.via).toEqual(via);
    expect(data(await service.list()).connections.find((c) => c.id === v.id)).toBeUndefined();
  });
});
