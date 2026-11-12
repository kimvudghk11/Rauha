import { describe, expect, it } from 'vitest';
import { DbInputError } from './db-names.js';
import { ConnectionLabel, DbPassword, SavedPassword, ServerTarget, defaultPort } from './db-server.js';

const base = { kind: 'postgres', host: 'db.example.com', user: 'app', database: 'shop', ssl: 'off' };

describe('서버 연결 대상(값 객체)', () => {
  it('포트를 비우면 MySQL 은 3306, PostgreSQL 은 5432 를 쓴다', () => {
    expect(ServerTarget.parse({ ...base, kind: 'mysql' }).port).toBe(3306);
    expect(ServerTarget.parse({ ...base, port: '' }).port).toBe(5432);
    expect(defaultPort('mysql')).toBe(3306);
    expect(ServerTarget.parse({ ...base, port: '6543' }).port).toBe(6543);
  });

  it('호스트에는 이름만 쓴다: URL·사용자@·경로·공백·빈 값은 거절한다', () => {
    for (const host of ['postgres://db', 'u@db', 'db/x', 'db x', '', '   ', '-db']) {
      expect(() => ServerTarget.parse({ ...base, host }), host).toThrow(DbInputError);
    }
    expect(ServerTarget.parse({ ...base, host: ' 10.0.0.5 ' }).host).toBe('10.0.0.5');
    expect(ServerTarget.parse({ ...base, host: '::1' }).host).toBe('::1');
  });

  it('포트는 1~65535 정수만, 종류는 mysql·postgres 만 받는다', () => {
    for (const port of [0, 70000, 1.5, 'abc', -1]) expect(() => ServerTarget.parse({ ...base, port }), String(port)).toThrow(DbInputError);
    expect(() => ServerTarget.parse({ ...base, kind: 'oracle' })).toThrow(DbInputError);
    expect(() => ServerTarget.parse({ ...base, kind: 'sqlite' })).toThrow(DbInputError);
  });

  it('사용자와 데이터베이스 이름은 비울 수 없고 제어 문자를 받지 않는다', () => {
    expect(() => ServerTarget.parse({ ...base, user: '' })).toThrow(DbInputError);
    expect(() => ServerTarget.parse({ ...base, database: ' ' })).toThrow(DbInputError);
    expect(() => ServerTarget.parse({ ...base, user: 'a\nb' })).toThrow(DbInputError);
  });

  it('SSL 은 off · require · verify 중 하나이고, 모르는 값이면 거절한다(빈 값은 off)', () => {
    expect(ServerTarget.parse({ ...base, ssl: undefined }).ssl).toBe('off');
    expect(ServerTarget.parse({ ...base, ssl: 'verify' }).ssl).toBe('verify');
    expect(() => ServerTarget.parse({ ...base, ssl: 'yes' })).toThrow(DbInputError);
  });

  it('보이는 주소에는 비밀번호가 없고, 같은 서버인지는 대소문자 무시한 호스트·포트·사용자·DB 로 본다', () => {
    const a = ServerTarget.parse({ ...base, host: 'DB.example.com' });
    expect(a.address()).toBe('app@DB.example.com:5432/shop');
    expect(a.sameServer(ServerTarget.parse(base))).toBe(true);
    expect(a.sameServer(ServerTarget.parse({ ...base, database: 'other' }))).toBe(false);
    expect(a.sameServer(ServerTarget.parse({ ...base, kind: 'mysql', port: 5432 }))).toBe(false);
  });
});

describe('연결 이름', () => {
  it('비우면 "DB on 호스트"로 짓고, 80자를 넘으면 거절한다', () => {
    const t = ServerTarget.parse(base);
    expect(ConnectionLabel.parse('', t).value).toBe('shop on db.example.com');
    expect(ConnectionLabel.parse('  Prod  ', t).value).toBe('Prod');
    expect(() => ConnectionLabel.parse('x'.repeat(81), t)).toThrow(DbInputError);
  });
});

describe('비밀번호', () => {
  it('비밀번호 값은 JSON·글로 바꿔도 드러나지 않는다', () => {
    const p = DbPassword.parse('s3cret!');
    expect(p.reveal()).toBe('s3cret!');
    expect(JSON.stringify({ p })).not.toContain('s3cret');
    expect(String(p)).not.toContain('s3cret');
  });
  it('비밀번호는 빈 값도 되지만 글이 아니거나 너무 길면 거절한다', () => {
    expect(DbPassword.parse('').reveal()).toBe('');
    expect(() => DbPassword.parse(undefined)).toThrow(DbInputError);
    expect(() => DbPassword.parse('x'.repeat(1025))).toThrow(DbInputError);
  });

  it('저장 요청이 있고 암호화할 수 있을 때만 암호문으로 저장하고, 아니면 저장하지 않는다', () => {
    const p = DbPassword.parse('pw');
    const seal = (plain: string) => Buffer.from(`enc:${plain}`).toString('base64');
    expect(SavedPassword.keep(p, seal, true).isSaved()).toBe(true);
    expect(SavedPassword.keep(p, seal, true).sealedText()).toBe(seal('pw'));
    expect(SavedPassword.keep(p, null, true).isSaved()).toBe(false);
    expect(SavedPassword.keep(p, seal, false).isSaved()).toBe(false);
  });
  it('암호화가 실패하면(키체인 거절 등) 저장하지 않는다', () => {
    const boom = () => {
      throw new Error('keychain denied');
    };
    expect(SavedPassword.keep(DbPassword.parse('pw'), boom, true).isSaved()).toBe(false);
  });
  it('저장된 암호문은 base64 글만 되살린다', () => {
    expect(SavedPassword.restore(undefined).isSaved()).toBe(false);
    expect(SavedPassword.restore('QUJD').sealedText()).toBe('QUJD');
    expect(() => SavedPassword.restore('not base64!')).toThrow(DbInputError);
    expect(() => SavedPassword.restore(5)).toThrow(DbInputError);
  });
});
