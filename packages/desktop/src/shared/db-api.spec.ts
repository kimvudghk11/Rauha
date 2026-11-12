import { describe, expect, it } from 'vitest';
import { DB_LIMITS, DbRequest, engineFailure, inputFailure, maskConnectionSecrets, serverFailure, TimeoutSeconds } from './db-api.js';
import { DbInputError } from './db-names.js';

describe('연결 문자열·비밀 가리기', () => {
  it('주소의 비밀번호와 password= 값을 가린다', () => {
    const masked = maskConnectionSecrets('failed postgres://admin:hunter2@db.local:5432/shop');
    expect(masked).not.toContain('hunter2');
    expect(masked).toContain('db.local');
    expect(maskConnectionSecrets('mysql://root:p%40ss@h/db?x=1')).not.toContain('p%40ss');
    expect(maskConnectionSecrets('Server=h;Database=d;User Id=u;Password=Sup3rSecret;Encrypt=true')).not.toContain('Sup3rSecret');
    expect(maskConnectionSecrets('host=h password="two words" user=u')).not.toContain('two words');
    expect(maskConnectionSecrets("pwd='abc def'")).not.toContain('abc def');
  });
  it('비밀이 없는 글은 그대로 둔다', () => {
    expect(maskConnectionSecrets('no such table: users')).toBe('no such table: users');
  });
});

describe('실패 가르기', () => {
  it('SQLite 오류를 종류별로 가른다', () => {
    expect(engineFailure('file is not a database').kind).toBe('not-sqlite');
    expect(engineFailure('database is locked').kind).toBe('busy');
    expect(engineFailure('attempt to write a readonly database').kind).toBe('write-mode');
    expect(engineFailure('not authorized').kind).toBe('blocked');
    expect(engineFailure('string or blob too big').kind).toBe('too-large');
    expect(engineFailure('no such table: x').kind).toBe('sql-error');
  });
  it('실패 글은 길이를 줄이고 비밀을 가린다', () => {
    const f = engineFailure('error near postgres://u:secretpw@h/db\n2\n3\n4\n5\n6\n7\n8');
    expect(f.message).not.toContain('secretpw');
    expect(f.message.split('\n').length).toBeLessThanOrEqual(6);
  });
  it('입력 오류는 종류를 그대로 옮긴다', () => {
    expect(inputFailure(new DbInputError('x', 'confirm')).kind).toBe('confirm');
    expect(inputFailure(new DbInputError('x', 'write-mode')).kind).toBe('write-mode');
    expect(inputFailure(new DbInputError('x', 'blocked')).kind).toBe('blocked');
    expect(inputFailure(new DbInputError('x')).kind).toBe('bad-input');
  });
});

describe('DB 요청 검사', () => {
  it('읽기 쿼리는 쓰기 모드·확인 없이 통과한다', () => {
    const q = DbRequest.query({ id: 'c1', sql: 'SELECT 1', writeMode: false, confirm: false });
    expect(q.statement.kind).toBe('read');
    expect(q.timeout.value).toBe(DB_LIMITS.defaultTimeoutSec);
  });
  it('쓰기 문장은 쓰기 모드가 꺼져 있으면 write-mode 오류다(확인이 있어도)', () => {
    expect(() => DbRequest.query({ id: 'c1', sql: 'DELETE FROM t', writeMode: false, confirm: true })).toThrow(expect.objectContaining({ kind: 'write-mode' }));
  });
  it('쓰기 모드가 켜져도 확인(confirm: true)이 없으면 거절한다', () => {
    expect(() => DbRequest.query({ id: 'c1', sql: 'DROP TABLE t', writeMode: true })).toThrow(expect.objectContaining({ kind: 'confirm' }));
    expect(() => DbRequest.query({ id: 'c1', sql: 'DROP TABLE t', writeMode: true, confirm: 'yes' })).toThrow(expect.objectContaining({ kind: 'confirm' }));
    expect(DbRequest.query({ id: 'c1', sql: 'DROP TABLE t', writeMode: true, confirm: true }).writeMode).toBe(true);
  });
  it('writeMode 는 true 일 때만 켜진 것이다("true" 문자열·1 은 꺼짐)', () => {
    expect(() => DbRequest.query({ id: 'c1', sql: 'DELETE FROM t', writeMode: 'true', confirm: true })).toThrow(expect.objectContaining({ kind: 'write-mode' }));
    expect(() => DbRequest.query({ id: 'c1', sql: 'DELETE FROM t', writeMode: 1, confirm: true })).toThrow(expect.objectContaining({ kind: 'write-mode' }));
  });
  it('막는 문장은 쓰기 모드와 확인이 있어도 거절한다', () => {
    expect(() => DbRequest.query({ id: 'c1', sql: "ATTACH 'x' AS y", writeMode: true, confirm: true })).toThrow(expect.objectContaining({ kind: 'blocked' }));
  });
  it('연결 id·키·요청 모양이 잘못되면 거절한다', () => {
    for (const bad of [null, 'x', 5, [], { sql: 'SELECT 1' }, { id: '../x', sql: 'SELECT 1' }, { id: 'c1', sql: 'SELECT 1', key: '../k' }, { id: 'c1', sql: 'SELECT 1', key: 5 }]) expect(() => DbRequest.query(bad), JSON.stringify(bad)).toThrow(DbInputError);
  });
  it('시간 제한은 1~60 정수만 받는다', () => {
    expect(TimeoutSeconds.parse(30).ms()).toBe(30_000);
    for (const bad of [0, -1, 61, 1.5, '10', NaN]) expect(() => TimeoutSeconds.parse(bad), String(bad)).toThrow(DbInputError);
  });
  it('행 보기 요청은 연결·테이블·쪽·정렬을 값 객체로 바꾼다', () => {
    const r = DbRequest.rows({ id: 'c1', table: 'users', page: 2, sort: { column: 'name', dir: 'asc' } });
    expect(r.table.value).toBe('users');
    expect(r.page.value).toBe(2);
    expect(r.sort?.dir).toBe('asc');
    expect(() => DbRequest.rows({ id: 'c1', table: '', page: 0 })).toThrow(DbInputError);
    expect(() => DbRequest.rows({ id: 'c1', table: 'users', page: -1 })).toThrow(DbInputError);
  });
  it('경로는 더하기 요청에서만 받고 규칙에 맞아야 한다', () => {
    expect(DbRequest.addPath({ path: '/data/a.db' }).value).toBe('/data/a.db');
    expect(() => DbRequest.addPath({ path: '\\\\evil\\share\\a.db' })).toThrow(DbInputError);
    expect(() => DbRequest.addPath('/data/a.db')).toThrow(DbInputError);
  });
  it('CSV 저장 요청은 글과 안전한 파일 이름만 받는다', () => {
    expect(DbRequest.exportCsv({ csv: 'a\r\n', name: 'users' })).toEqual({ csv: 'a\r\n', fileName: 'users.csv' });
    expect(() => DbRequest.exportCsv({ csv: 5, name: 'x' })).toThrow(DbInputError);
    expect(() => DbRequest.exportCsv({ csv: 'x'.repeat(DB_LIMITS.maxCsvBytes + 1), name: 'x' })).toThrow(/too large/);
    expect(DbRequest.exportCsv({ csv: 'a', name: '../../etc/passwd' }).fileName).not.toContain('/');
  });
});

describe('서버 실패 가르기', () => {
  it('로그인 실패 · 서버에 닿지 않음 · 읽기 전용 위반 · 시간 초과를 가른다', () => {
    expect(serverFailure('password authentication failed for user "app"').kind).toBe('auth');
    expect(serverFailure("Access denied for user 'app'@'10.0.0.1' (using password: YES)").kind).toBe('auth');
    expect(serverFailure('connect ECONNREFUSED 127.0.0.1:5432').kind).toBe('no-server');
    expect(serverFailure('getaddrinfo ENOTFOUND db.nowhere').kind).toBe('no-server');
    expect(serverFailure('Connection terminated due to connection timeout').kind).toBe('no-server');
    expect(serverFailure('self-signed certificate in certificate chain').kind).toBe('no-server');
    expect(serverFailure('cannot execute DELETE in a read-only transaction').kind).toBe('write-mode');
    expect(serverFailure('Cannot execute statement in a READ ONLY transaction.').kind).toBe('write-mode');
    expect(serverFailure('canceling statement due to statement timeout').kind).toBe('timeout');
    expect(serverFailure('relation "nope" does not exist').kind).toBe('sql-error');
  });
  it('실패 글에 섞인 연결 문자열 비밀번호는 가린다', () => {
    expect(serverFailure('bad postgres://u:hunter2@h/db').message).not.toContain('hunter2');
  });
});

describe('서버 연결 요청(DTO)', () => {
  const ok = { name: 'Prod', kind: 'postgres', host: 'db', port: 5432, user: 'app', password: 'pw', database: 'shop', ssl: 'require', savePassword: true };
  it('입력을 검사해 대상·이름·비밀번호·저장 여부로 바꾼다', () => {
    const r = DbRequest.addServer(ok);
    expect(r.target.address()).toBe('app@db:5432/shop');
    expect(r.label.value).toBe('Prod');
    expect(r.password.reveal()).toBe('pw');
    expect(r.savePassword).toBe(true);
    expect(DbRequest.addServer({ ...ok, savePassword: 'yes' }).savePassword).toBe(false);
  });
  it('비밀번호가 글이 아니면 거절하고, 거절 글에 비밀번호를 넣지 않는다', () => {
    expect(() => DbRequest.addServer({ ...ok, password: 5 })).toThrow(DbInputError);
    try {
      DbRequest.addServer({ ...ok, host: 'x://y', password: 'TopSecret9' });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('TopSecret9');
    }
  });
  it('잠금 풀기 요청은 연결 id · 비밀번호 · 저장 여부만 받는다', () => {
    const r = DbRequest.unlock({ id: 'abc', password: 'pw', savePassword: true });
    expect([r.id.value, r.password.reveal(), r.savePassword]).toEqual(['abc', 'pw', true]);
    expect(() => DbRequest.unlock({ id: '../x', password: 'pw' })).toThrow(DbInputError);
  });
  it('쿼리 요청은 연결 종류에 맞는 문법으로 검사한다', () => {
    expect(DbRequest.query({ id: 'a', sql: 'SHOW TABLES', writeMode: false, confirm: false }, 'mysql').statement.kind).toBe('read');
    expect(() => DbRequest.query({ id: 'a', sql: 'SHOW TABLES', writeMode: false, confirm: false })).toThrow(DbInputError);
  });
});

describe('서버 연결 고치기·접속 시험 요청(DTO)', () => {
  const ok = { name: 'Prod', kind: 'postgres', host: 'db', port: 5432, user: 'app', password: '', database: 'shop', ssl: 'require', savePassword: true };
  it('고치기 요청: keepPassword 면 저장한 비밀번호를 그대로 쓰고(null), 아니면 새 비밀번호를 받는다', () => {
    const keep = DbRequest.editServer({ ...ok, id: 'c1', keepPassword: true });
    expect([keep.id.value, keep.password, keep.label.value]).toEqual(['c1', null, 'Prod']);
    const fresh = DbRequest.editServer({ ...ok, id: 'c1', password: 'pw2', keepPassword: false });
    expect(fresh.password?.reveal()).toBe('pw2');
    expect(() => DbRequest.editServer({ ...ok, id: '../x', keepPassword: true })).toThrow(DbInputError);
  });
  it('접속 시험 요청: 고치는 중인 연결 id 가 있으면 비밀번호를 비워 저장한 것을 쓸 수 있다', () => {
    const t = DbRequest.testServer({ ...ok, id: 'c1', keepPassword: true });
    expect([t.id?.value, t.password]).toEqual(['c1', null]);
    const n = DbRequest.testServer({ ...ok, password: 'pw' });
    expect([n.id, n.password?.reveal()]).toEqual([null, 'pw']);
    expect(() => DbRequest.testServer({ ...ok, keepPassword: true })).toThrow(DbInputError);
  });
  it('인증서 오류 안내는 연결을 고쳐 다른 SSL 을 고르라고 한다', () => {
    expect(serverFailure('self-signed certificate in certificate chain').help).toMatch(/Edit/);
  });
});
