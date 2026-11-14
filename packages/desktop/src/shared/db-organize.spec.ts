import { describe, expect, it } from 'vitest';
import type { DbConnectionView } from './db-connections.js';
import { ConnectionTag, groupConnections, guessEnv } from './db-organize.js';

const conn = (o: Partial<DbConnectionView>): DbConnectionView => ({ id: o.name ?? 'x', kind: 'postgres', name: 'x', path: 'u@host:5432/db', lastUsed: 0, savedPassword: false, server: null, via: null, group: '', env: null, ...o });

describe('ConnectionTag — 연결의 그룹·환경', () => {
  it('그룹 이름은 앞뒤 공백을 빼고, 비우면 그룹 없음', () => {
    expect(ConnectionTag.of('  회사 A  ', 'prod').toJSON()).toEqual({ group: '회사 A', env: 'prod' });
    expect(ConnectionTag.of('', null).toJSON()).toEqual({ group: '', env: null });
  });
  it('너무 긴 그룹·줄바꿈·모르는 환경은 거절한다', () => {
    expect(() => ConnectionTag.of('x'.repeat(41), null)).toThrow(/40/);
    expect(() => ConnectionTag.of('a\nb', null)).toThrow(/line break/);
    expect(() => ConnectionTag.of('', 'production')).toThrow(/local, dev, staging or prod/);
  });
  it('저장 파일의 깨진 값은 그룹 없음·환경 없음으로 읽는다', () => {
    expect(ConnectionTag.restore({ group: 5, env: 'weird' }).toJSON()).toEqual({ group: '', env: null });
  });
});

describe('guessEnv — 환경을 정하지 않은 연결의 추정', () => {
  it('이름·주소로 prod·staging·dev·local 을 짐작하고 모르면 null', () => {
    expect(guessEnv(conn({ name: 'shop-prod', path: 'u@db.shop.com:5432/shop' }))).toBe('prod');
    expect(guessEnv(conn({ name: '운영 DB' }))).toBe('prod');
    expect(guessEnv(conn({ name: 'api', path: 'u@stg-db.internal:3306/api' }))).toBe('staging');
    expect(guessEnv(conn({ name: 'dev api' }))).toBe('dev');
    expect(guessEnv(conn({ name: 'mine', path: 'root@localhost:3306/app' }))).toBe('local');
    expect(guessEnv(conn({ kind: 'sqlite', name: 'app.db', path: 'C:/x/app.db' }))).toBe('local');
    expect(guessEnv(conn({ name: 'reports', path: 'u@10.0.0.5:5432/r' }))).toBeNull();
  });
});

describe('groupConnections — 사이드바 목록', () => {
  const list = [
    conn({ id: '1', name: 'orders', group: '회사 A', env: 'prod' }),
    conn({ id: '2', name: 'auth', group: '회사 A', env: 'dev' }),
    conn({ id: '3', name: 'blog', group: '' }),
    conn({ id: '4', name: 'analytics', group: '개인', path: 'u@localhost:5432/a' }),
  ];
  it('그룹 이름순, 그룹 없는 연결은 맨 끝 "Ungrouped", 그룹 안은 이름순(최근 순서로 흔들리지 않는다)', () => {
    expect(groupConnections(list, '').map((g) => [g.name, g.items.map((c) => c.name)])).toEqual([
      ['개인', ['analytics']],
      ['회사 A', ['auth', 'orders']],
      ['Ungrouped', ['blog']],
    ]);
  });
  it('그룹이 하나도 없으면 그룹 머리 없이 한 묶음', () => {
    expect(groupConnections([conn({ name: 'b' }), conn({ name: 'a' })], '')).toEqual([{ name: '', items: [expect.objectContaining({ name: 'a' }), expect.objectContaining({ name: 'b' })] }]);
  });
  it('검색은 이름·주소·그룹·환경(추정 포함)으로 거른다', () => {
    expect(groupConnections(list, 'prod').flatMap((g) => g.items.map((c) => c.name))).toEqual(['orders']);
    expect(groupConnections(list, '회사').flatMap((g) => g.items.map((c) => c.name))).toEqual(['auth', 'orders']);
    expect(groupConnections(list, 'local').flatMap((g) => g.items.map((c) => c.name))).toEqual(['analytics']);
    expect(groupConnections(list, 'zzz')).toEqual([]);
  });
});
