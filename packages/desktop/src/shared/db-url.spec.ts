import { describe, expect, it } from 'vitest';
import { ConnectionUrl } from './db-url.js';

describe('연결 문자열 붙여 넣기', () => {
  it('postgres:// 주소에서 종류·호스트·포트·사용자·비밀번호·DB·SSL 을 꺼낸다', () => {
    const u = ConnectionUrl.parse('postgresql://app:p%40ss@db.example.com:6543/shop?sslmode=require');
    expect(u).toEqual({ kind: 'postgres', addresses: [{ host: 'db.example.com', port: '6543', label: '' }], user: 'app', password: 'p@ss', database: 'shop', ssl: 'require' });
  });
  it('libpq 처럼 호스트를 쉼표로 여럿 적으면 주소 여러 개로 채운다', () => {
    const u = ConnectionUrl.parse('postgres://app@10.0.0.5,3.35.12.4:6543/shop');
    expect(u?.addresses).toEqual([{ host: '10.0.0.5', port: '', label: '' }, { host: '3.35.12.4', port: '6543', label: '' }]);
    expect(u?.password).toBe('');
  });
  it('mysql:// 와 ssl-mode·IPv6 를 읽는다', () => {
    expect(ConnectionUrl.parse('mysql://root:pw@[::1]:3307/app?ssl-mode=VERIFY_IDENTITY')).toEqual({ kind: 'mysql', addresses: [{ host: '::1', port: '3307', label: '' }], user: 'root', password: 'pw', database: 'app', ssl: 'verify' });
    expect(ConnectionUrl.parse('mariadb://u@h/d?ssl=true')?.ssl).toBe('require');
    expect(ConnectionUrl.parse('postgres://u@h/d?sslmode=verify-full')?.ssl).toBe('verify');
    expect(ConnectionUrl.parse('postgres://u@h/d?sslmode=disable')?.ssl).toBe('off');
  });
  it('연결 문자열이 아니면(호스트 이름·다른 DB) null', () => {
    for (const t of ['db.example.com', 'sqlite:///x.db', 'mongodb://h/d', 'http://x', '']) expect(ConnectionUrl.parse(t), t).toBeNull();
  });
  it('SSL 이 적혀 있지 않으면 null(폼의 선택을 그대로 둔다)', () => {
    expect(ConnectionUrl.parse('postgres://u@h/d')?.ssl).toBeNull();
  });
});
