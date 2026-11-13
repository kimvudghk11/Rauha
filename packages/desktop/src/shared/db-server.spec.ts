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

  it('IP 주소 뒤에 :포트 를 붙여 넣으면 호스트와 포트로 나눈다(IPv6 로 잘못 읽지 않는다)', () => {
    const t = ServerTarget.parse({ ...base, kind: 'mysql', host: '3.39.2.12:3307' });
    expect([t.host, t.port]).toEqual(['3.39.2.12', 3307]);
    const named = ServerTarget.parse({ ...base, host: 'db.example.com:6543' });
    expect([named.host, named.port]).toEqual(['db.example.com', 6543]);
    expect(ServerTarget.parse({ ...base, kind: 'mysql', host: '3.39.2.12' }).addresses.primary().endpoint()).toBe('3.39.2.12:3306');
    expect(ServerTarget.parse({ ...base, host: '[::1]:6000' }).port).toBe(6000);
  });

  it('호스트에 붙인 포트와 포트 칸이 다르면 어느 쪽인지 묻는다', () => {
    expect(() => ServerTarget.parse({ ...base, host: '3.39.2.12:3307', port: '3306' })).toThrow(/port/i);
    expect(ServerTarget.parse({ ...base, host: '3.39.2.12:3307', port: '3307' }).port).toBe(3307);
  });

  it('IPv4 는 칸마다 0~255 여야 한다', () => {
    expect(() => ServerTarget.parse({ ...base, host: '3.39.2.312' })).toThrow(/255/);
    expect(() => ServerTarget.parse({ ...base, host: '3.39.2' })).not.toThrow();
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

describe('Amazon RDS 인증서', () => {
  it('호스트가 *.rds.amazonaws.com(.cn) 이고 "SSL + 인증서 확인"이면 Amazon RDS CA 를 함께 믿는다', () => {
    expect(ServerTarget.parse({ ...base, host: 'mydb.abc123.ap-northeast-2.rds.amazonaws.com', ssl: 'verify' }).extraCa()).toBe('aws-rds');
    expect(ServerTarget.parse({ ...base, host: 'MyDB.cluster-ro-abc.us-east-1.RDS.amazonaws.com', ssl: 'verify' }).extraCa()).toBe('aws-rds');
    expect(ServerTarget.parse({ ...base, host: 'mydb.abc.cn-north-1.rds.amazonaws.com.cn', ssl: 'verify' }).extraCa()).toBe('aws-rds');
  });
  it('RDS 가 아닌 호스트·이름만 비슷한 호스트·인증서를 보지 않는 SSL 에는 더하지 않는다', () => {
    expect(ServerTarget.parse({ ...base, ssl: 'verify' }).extraCa()).toBeNull();
    expect(ServerTarget.parse({ ...base, host: 'rds.amazonaws.com.evil.com', ssl: 'verify' }).extraCa()).toBeNull();
    expect(ServerTarget.parse({ ...base, host: 'evilrds.amazonaws.com', ssl: 'verify' }).extraCa()).toBeNull();
    expect(ServerTarget.parse({ ...base, host: 'mydb.abc.us-east-1.rds.amazonaws.com', ssl: 'require' }).extraCa()).toBeNull();
    expect(ServerTarget.parse({ ...base, host: 'mydb.abc.us-east-1.rds.amazonaws.com', ssl: 'off' }).extraCa()).toBeNull();
  });
  it('RDS 호스트인지 따로 알 수 있다(폼에서 SSL 을 권할 때)', () => {
    expect(ServerTarget.isAwsRdsHost('a.b.ap-northeast-2.rds.amazonaws.com')).toBe(true);
    expect(ServerTarget.isAwsRdsHost('localhost')).toBe(false);
  });
});

describe('폼에 다시 채울 값', () => {
  it('연결 고치기·복제용 값에는 비밀번호가 없다', () => {
    const t = ServerTarget.parse({ ...base, port: 6543, ssl: 'verify' });
    expect(t.toJSON()).toEqual({ kind: 'postgres', addresses: [{ host: 'db.example.com', port: 6543, label: null }], user: 'app', database: 'shop', ssl: 'verify' });
  });
});

const multi = { ...base, host: undefined, addresses: [{ host: '10.0.0.5', label: 'Private' }, { host: '3.35.12.4', port: '6543', label: 'Public' }] };

describe('주소 여러 개(값 객체)', () => {
  it('주소는 적은 순서를 지키고, 포트를 비우면 종류의 기본 포트, 이름표는 비워도 된다', () => {
    const t = ServerTarget.parse(multi);
    expect(t.addresses.list().map((a) => [a.host, a.port, a.label])).toEqual([['10.0.0.5', 5432, 'Private'], ['3.35.12.4', 6543, 'Public']]);
    expect(t.host).toBe('10.0.0.5');
    expect(t.port).toBe(5432);
    expect(ServerTarget.parse({ ...multi, addresses: [{ host: 'a.local', label: '  ' }] }).addresses.list()[0]?.label).toBeNull();
  });

  it('같은 호스트·포트를 두 번 적으면(대소문자 무시) 거절하고, 포트가 다르면 다른 주소다', () => {
    expect(() => ServerTarget.parse({ ...multi, addresses: [{ host: 'DB.local' }, { host: 'db.local' }] })).toThrow(/same as #1/);
    expect(ServerTarget.parse({ ...multi, addresses: [{ host: 'db.local' }, { host: 'db.local', port: 6000 }] }).addresses.size).toBe(2);
  });

  it('주소는 1~6개, 빈 목록·잘못된 호스트·긴 이름표는 몇 번째인지 알려 주며 거절한다', () => {
    expect(() => ServerTarget.parse({ ...multi, addresses: [] })).toThrow(DbInputError);
    expect(() => ServerTarget.parse({ ...multi, addresses: Array.from({ length: 7 }, (_, i) => ({ host: `h${i}.local` })) })).toThrow(/up to 6/);
    expect(() => ServerTarget.parse({ ...multi, addresses: [{ host: 'ok.local' }, { host: 'http://x' }] })).toThrow(/#2/);
    expect(() => ServerTarget.parse({ ...multi, addresses: [{ host: 'ok.local', label: 'x'.repeat(25) }] })).toThrow(DbInputError);
  });

  it('예전 저장 형식(host·port 하나)도 주소 하나로 읽고, 저장은 새 형식(addresses)으로 한다', () => {
    const old = ServerTarget.parse({ ...base, port: 6543 });
    expect(old.addresses.size).toBe(1);
    expect(old.toJSON()).not.toHaveProperty('host');
    expect(ServerTarget.parse(old.toJSON()).addresses.list()[0]?.endpoint()).toBe('db.example.com:6543');
  });

  it('보이는 주소는 첫 주소에 나머지 개수를 붙이고, 주소가 하나라도 겹치면 같은 서버로 본다', () => {
    const t = ServerTarget.parse(multi);
    expect(t.address()).toBe('app@10.0.0.5:5432/shop (+1 more)');
    expect(t.sameServer(ServerTarget.parse({ ...base, host: '3.35.12.4', port: 6543 }))).toBe(true);
    expect(t.sameServer(ServerTarget.parse({ ...base, host: '3.35.12.4' }))).toBe(false);
  });

  it('주소 하나로 좁힌 대상(via)은 그 주소만 갖고, RDS 판정도 그 주소로 한다(SSL 은 연결 하나에)', () => {
    const t = ServerTarget.parse({ ...multi, ssl: 'verify', addresses: [{ host: '10.0.0.5' }, { host: 'mydb.abc.ap-northeast-2.rds.amazonaws.com' }] });
    expect(t.via(0).extraCa()).toBeNull();
    expect(t.via(1).extraCa()).toBe('aws-rds');
    expect(t.via(1).host).toBe('mydb.abc.ap-northeast-2.rds.amazonaws.com');
    expect(t.via(1).ssl).toBe('verify');
  });

  it('접속 시간 제한: 주소가 하나면 10초, 여럿이면 다음으로 빨리 넘어가게 주소마다 4초', () => {
    expect(ServerTarget.parse(base).addresses.connectTimeoutMs()).toBe(10_000);
    expect(ServerTarget.parse(multi).addresses.connectTimeoutMs()).toBe(4_000);
  });
});
