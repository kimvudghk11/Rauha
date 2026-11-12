import { describe, expect, it } from 'vitest';
import { serverFailure } from './db-api.js';
import { AddressFailover } from './db-failover.js';
import { ServerTarget } from './db-server.js';

const two = ServerTarget.parse({ kind: 'postgres', addresses: [{ host: '10.0.0.5', label: 'Private' }, { host: '3.35.12.4', label: 'Public' }], user: 'app', database: 'shop' }).addresses;
const one = ServerTarget.parse({ kind: 'mysql', host: 'db.local', user: 'app', database: 'shop' }).addresses;

describe('장애 넘김: 어떤 오류에 다음 주소로 가나', () => {
  it('닿지 않음(거절·시간 초과·이름 없음·네트워크 없음·끊김)은 다음 주소로 넘어간다', () => {
    for (const m of ['connect ECONNREFUSED 10.0.0.5:5432', 'connect ETIMEDOUT', 'getaddrinfo ENOTFOUND db.internal', 'connect EHOSTUNREACH', 'Connection terminated due to connection timeout', 'Could not reach the server within 4 seconds.']) {
      expect(AddressFailover.shouldTryNext(m), m).toBe(true);
    }
  });
  it('TLS 실패와 pg_hba(이 주소에서 오는 접속을 막음)도 주소마다 다를 수 있어 다음으로 넘어간다', () => {
    expect(AddressFailover.shouldTryNext('Hostname/IP does not match certificate')).toBe(true);
    expect(AddressFailover.shouldTryNext('no pg_hba.conf entry for host "1.2.3.4", user "app", database "shop", SSL off')).toBe(true);
  });
  it('비밀번호 틀림·DB 없음·SQL 오류는 같은 DB 라 다음 주소도 같으니 바로 실패한다', () => {
    for (const m of ['password authentication failed for user "app"', "Access denied for user 'app'@'1.2.3.4' (using password: YES)", 'database "shop" does not exist', 'syntax error at or near "x"']) {
      expect(AddressFailover.shouldTryNext(m), m).toBe(false);
    }
  });
});

describe('장애 넘김: 순서와 결과', () => {
  it('1번부터 차례로 시도하고, 붙은 주소를 몇 번째·이름표·주소로 알려 준다', () => {
    const f = AddressFailover.start(two);
    expect(f.next()).toBe(0);
    f.failed(0, 'connect ETIMEDOUT');
    expect(f.next()).toBe(1);
    expect(f.connected(1)).toEqual({ index: 1, total: 2, label: 'Public', endpoint: '3.35.12.4:5432' });
    expect(f.next()).toBeNull();
  });
  it('인증 실패면 남은 주소가 있어도 멈추고, 어느 주소에서 실패했는지 붙인다(분류는 그대로 인증 실패)', () => {
    const f = AddressFailover.start(two);
    f.failed(0, 'connect ECONNREFUSED 10.0.0.5:5432');
    f.failed(1, 'password authentication failed for user "app"');
    expect(f.next()).toBeNull();
    expect(f.failureMessage()).toContain('#2 Public 3.35.12.4:5432');
    expect(serverFailure(f.failureMessage()).kind).toBe('auth');
  });
  it('1번에서 인증 실패면 2번은 시도하지 않는다', () => {
    const f = AddressFailover.start(two);
    f.failed(0, 'password authentication failed');
    expect(f.next()).toBeNull();
  });
  it('모두 닿지 않으면 주소마다 왜 실패했는지 한 줄씩 모아 "닿지 않음"으로 알린다', () => {
    const f = AddressFailover.start(two);
    f.failed(0, 'connect ETIMEDOUT');
    f.failed(1, 'connect ECONNREFUSED 3.35.12.4:5432');
    expect(f.next()).toBeNull();
    const m = f.failureMessage();
    expect(m.split('\n')).toEqual(['Tried 2 addresses and none answered.', '#1 Private 10.0.0.5:5432: connect ETIMEDOUT', '#2 Public 3.35.12.4:5432: connect ECONNREFUSED 3.35.12.4:5432']);
    expect(serverFailure(m).kind).toBe('no-server');
  });
  it('주소가 하나면 오류 글을 그대로 둔다(예전과 같다)', () => {
    const f = AddressFailover.start(one);
    f.failed(0, 'connect ECONNREFUSED 127.0.0.1:3306');
    expect(f.next()).toBeNull();
    expect(f.failureMessage()).toBe('connect ECONNREFUSED 127.0.0.1:3306');
    expect(f.connected(0)).toEqual({ index: 0, total: 1, label: null, endpoint: 'db.local:3306' });
  });
});
