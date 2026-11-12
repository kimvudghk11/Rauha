import { describe, expect, it } from 'vitest';
import { ConnectionsDto, DbConnections, MAX_CONNECTIONS } from './db-connections.js';
import { DbFilePath, DbInputError } from './db-names.js';
import { ConnectionLabel, DbPassword, SavedPassword, ServerTarget } from './db-server.js';

const p = (v: string) => DbFilePath.parse(v);

describe('저장한 DB 파일 목록', () => {
  it('파일을 더하면 id 와 보이는 이름이 생기고 최근에 쓴 순서로 나온다', () => {
    const c = DbConnections.empty();
    c.add(p('/data/a.db'), 'id1', 100);
    c.add(p('/data/b.sqlite'), 'id2', 200);
    expect(c.list().map((x) => x.name)).toEqual(['b.sqlite', 'a.db']);
    c.touch('id1', 300);
    expect(c.list().map((x) => x.name)).toEqual(['a.db', 'b.sqlite']);
  });
  it('같은 파일(대소문자·구분 기호만 다른 윈도우 경로 포함)을 또 더하면 새로 만들지 않고 기존 것을 최근으로 올린다', () => {
    const c = DbConnections.empty();
    const first = c.add(p('C:\\Data\\App.db'), 'id1', 100);
    const again = c.add(p('c:/data/app.DB'), 'id2', 200);
    expect(again.id).toBe(first.id);
    expect(c.list()).toHaveLength(1);
    expect(c.find('id1')?.lastUsed).toBe(200);
  });
  it('지우면 목록에서 빠지고 모르는 id 는 아무 일도 없다', () => {
    const c = DbConnections.empty();
    c.add(p('/a.db'), 'id1', 1);
    c.remove('nope');
    expect(c.list()).toHaveLength(1);
    c.remove('id1');
    expect(c.list()).toHaveLength(0);
    expect(c.find('id1')).toBeUndefined();
  });
  it(`${MAX_CONNECTIONS}개를 넘기면 거절한다(말없이 지우지 않는다)`, () => {
    const c = DbConnections.empty();
    for (let i = 0; i < MAX_CONNECTIONS; i += 1) c.add(p(`/d/f${i}.db`), `i${i}`, i);
    expect(() => c.add(p('/d/extra.db'), 'x', 99)).toThrow(DbInputError);
  });
});

describe('목록 JSON(DTO)', () => {
  it('저장했다가 읽으면 같은 목록이다', () => {
    const c = DbConnections.empty();
    c.add(p('/data/a.db'), 'id1', 100);
    const back = ConnectionsDto.from(ConnectionsDto.fromEntity(c).toJSON()).toEntity();
    expect(back.list()).toEqual(c.list());
  });
  it('깨진 항목(경로 규칙 위반·id 중복·글이 아닌 값)은 건너뛰고 개수를 센다', () => {
    const dto = ConnectionsDto.from({ version: 1, items: [{ id: 'ok1', path: '/a.db', lastUsed: 1 }, { id: 'bad', path: '\\\\server\\x.db', lastUsed: 1 }, { id: 'ok1', path: '/b.db', lastUsed: 1 }, 7, { id: 'x y', path: '/c.db' }] });
    expect(dto.toEntity().list().map((x) => x.id)).toEqual(['ok1']);
    expect(dto.skipped).toBe(4);
  });
  it('모르는 모양이면 빈 목록이다', () => {
    expect(ConnectionsDto.from(null).toEntity().list()).toEqual([]);
    expect(ConnectionsDto.from('x').toEntity().list()).toEqual([]);
    expect(ConnectionsDto.from({ items: 'no' }).toEntity().list()).toEqual([]);
  });
  it('예전(version 1) SQLite 목록은 그대로 읽혀 SQLite 파일로 보인다', () => {
    const list = ConnectionsDto.from({ version: 1, items: [{ id: 'old1', path: 'C:\\data\\app.db', lastUsed: 5 }] }).toEntity().list();
    expect(list).toEqual([{ id: 'old1', kind: 'sqlite', name: 'app.db', path: 'C:\\data\\app.db', lastUsed: 5, savedPassword: null }]);
  });
});

const target = (o: Record<string, unknown> = {}) => ServerTarget.parse({ kind: 'mysql', host: 'db.local', user: 'app', database: 'shop', ...o });
const sealed = (text: string) => SavedPassword.restore(Buffer.from(text).toString('base64'));

describe('서버 연결 목록', () => {
  it('서버 연결을 더하면 종류·이름·비밀번호 없는 주소가 보인다', () => {
    const c = DbConnections.empty();
    const v = c.addServer(target(), ConnectionLabel.parse('Shop', target()), sealed('x'), 's1', 10);
    expect(v).toEqual({ id: 's1', kind: 'mysql', name: 'Shop', path: 'app@db.local:3306/shop', lastUsed: 10, savedPassword: true });
    c.add(p('/a.db'), 'f1', 20);
    expect(c.list().map((x) => x.kind)).toEqual(['sqlite', 'mysql']);
  });
  it('같은 서버를 또 더하면 새로 만들지 않고 이름·저장한 비밀번호를 새것으로 바꾼다', () => {
    const c = DbConnections.empty();
    c.addServer(target(), ConnectionLabel.parse('A', target()), sealed('x'), 's1', 10);
    const again = c.addServer(target({ host: 'DB.LOCAL' }), ConnectionLabel.parse('B', target()), SavedPassword.none(), 's2', 30);
    expect(again.id).toBe('s1');
    expect(again.name).toBe('B');
    expect(again.savedPassword).toBe(false);
    expect(c.list()).toHaveLength(1);
  });
  it('저장한 비밀번호를 바꾸거나 잊을 수 있고, 파일 연결에는 아무 일도 없다', () => {
    const c = DbConnections.empty();
    c.addServer(target(), ConnectionLabel.parse('', target()), SavedPassword.none(), 's1', 1);
    c.add(p('/a.db'), 'f1', 2);
    c.rememberPassword('s1', sealed('y'));
    c.rememberPassword('f1', sealed('y'));
    expect(c.find('s1')?.savedPassword).toBe(true);
    expect(c.find('f1')?.savedPassword).toBeNull();
    c.forgetPassword('s1');
    expect(c.find('s1')?.savedPassword).toBe(false);
  });
  it('id 로 어디에 연결할지 찾는다(파일 경로 또는 서버 대상과 저장한 비밀번호)', () => {
    const c = DbConnections.empty();
    c.addServer(target(), ConnectionLabel.parse('', target()), sealed('x'), 's1', 1);
    c.add(p('/a.db'), 'f1', 2);
    const s = c.locate('s1');
    expect(s?.kind).toBe('server');
    if (s?.kind === 'server') expect(s.password.isSaved()).toBe(true);
    const f = c.locate('f1');
    expect(f?.kind === 'file' ? f.path.value : null).toBe('/a.db');
    expect(c.locate('nope')).toBeUndefined();
  });
  it('연결 종류로 SQL 문법을 고른다(파일·모르는 id 는 SQLite)', () => {
    const c = DbConnections.empty();
    c.addServer(target({ kind: 'postgres' }), ConnectionLabel.parse('', target()), SavedPassword.none(), 's1', 1);
    c.add(p('/a.db'), 'f1', 2);
    expect([c.dialectOf('s1'), c.dialectOf('f1'), c.dialectOf('x')]).toEqual(['postgres', 'sqlite', 'sqlite']);
  });
  it('파일과 서버를 합쳐 상한까지만 저장한다', () => {
    const c = DbConnections.empty();
    for (let i = 0; i < MAX_CONNECTIONS; i += 1) c.add(p(`/d/f${i}.db`), `i${i}`, i);
    expect(() => c.addServer(target(), ConnectionLabel.parse('', target()), SavedPassword.none(), 's1', 1)).toThrow(DbInputError);
  });
});

describe('서버 연결 JSON(DTO)', () => {
  it('저장했다가 읽으면 같은 목록이다(SSL·포트·암호문 포함)', () => {
    const c = DbConnections.empty();
    c.add(p('/a.db'), 'f1', 1);
    const t = target({ kind: 'postgres', port: 6543, ssl: 'require' });
    c.addServer(t, ConnectionLabel.parse('PG', t), sealed('x'), 's1', 2);
    const json = ConnectionsDto.fromEntity(c).toJSON();
    const back = ConnectionsDto.from(JSON.parse(JSON.stringify(json))).toEntity();
    expect(back.list()).toEqual(c.list());
    const loc = back.locate('s1');
    expect(loc?.kind === 'server' ? [loc.target.ssl, loc.target.port, loc.password.sealedText()] : null).toEqual(['require', 6543, Buffer.from('x').toString('base64')]);
  });
  it('저장 JSON 에는 평문 비밀번호가 없다(암호문만, 저장 안 하면 그것도 없다)', () => {
    const c = DbConnections.empty();
    const pw = DbPassword.parse('Pl@inTextPw');
    const seal = (plain: string) => Buffer.from(plain.split('').reverse().join('')).toString('base64');
    c.addServer(target(), ConnectionLabel.parse('', target()), SavedPassword.keep(pw, seal, true), 's1', 1);
    c.addServer(target({ database: 'b' }), ConnectionLabel.parse('', target()), SavedPassword.keep(pw, null, true), 's2', 2);
    const text = JSON.stringify(ConnectionsDto.fromEntity(c).toJSON());
    expect(text).not.toContain('Pl@inTextPw');
    expect(text).not.toMatch(/"password"/);
    expect(text.match(/sealedPassword/g)).toHaveLength(1);
  });
  it('깨진 서버 항목(모르는 종류·잘못된 호스트·base64 아닌 암호문)은 건너뛰고 센다', () => {
    const ok = { id: 's1', kind: 'mysql', name: 'A', host: 'db', port: 3306, user: 'u', database: 'd', ssl: 'off', lastUsed: 1 };
    const dto = ConnectionsDto.from({ version: 2, items: [ok, { ...ok, id: 's2', kind: 'oracle' }, { ...ok, id: 's3', host: 'x://y' }, { ...ok, id: 's4', database: 'e', sealedPassword: '!!' }, { ...ok, id: 's5' }] });
    expect(dto.toEntity().list().map((x) => x.id)).toEqual(['s1']);
    expect(dto.skipped).toBe(4);
  });
});
