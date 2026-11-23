import { describe, expect, it } from 'vitest';
import { serverFailure, withVpnHint, type DbResult } from './db-api.js';

const unreachable: DbResult<null> = { ok: false, failure: serverFailure('connect ETIMEDOUT 172.31.5.10:5432') };

describe('DB 서버에 못 닿을 때 VPN 안내', () => {
  it('VPN 을 넣어 뒀는데 꺼져 있으면 AWS 탭에서 켜라고 한다', () => {
    const r = withVpnHint(unreachable, { connected: null, profiles: 1 });
    expect(r.ok ? null : r.failure.help).toMatch(/VPN is off.*AWS tab/);
  });

  it('VPN 이 켜져 있으면 그 이름과 함께 주소·허용 여부를 보라고 한다', () => {
    const r = withVpnHint(unreachable, { connected: '회사 개발', profiles: 1 });
    expect(r.ok ? null : r.failure.help).toMatch(/"회사 개발" is connected/);
  });

  it('VPN 을 안 쓰는 사람에게는 원래 안내를 그대로 둔다', () => {
    expect(withVpnHint(unreachable, { connected: null, profiles: 0 })).toBe(unreachable);
    expect(withVpnHint(unreachable, null)).toBe(unreachable);
  });

  it('다른 실패(로그인 실패 등)와 성공은 건드리지 않는다', () => {
    const auth: DbResult<null> = { ok: false, failure: serverFailure('password authentication failed for user "x"') };
    expect(withVpnHint(auth, { connected: null, profiles: 1 })).toBe(auth);
    const ok: DbResult<number> = { ok: true, data: 1 };
    expect(withVpnHint(ok, { connected: null, profiles: 1 })).toBe(ok);
  });
});
