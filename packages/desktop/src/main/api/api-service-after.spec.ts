import { describe, expect, it } from 'vitest';
import { ApiCollections } from '../../shared/api-collections.js';
import { ApiEnvironment, ApiEnvironments } from '../../shared/api-env.js';
import { ApiHistory } from '../../shared/api-response.js';
import type { CookieHooks, SendOutcome } from './api-sender.js';
import { ApiService } from './api-service.js';
import type { ApiStorePort } from './api-store.js';

const mem = <T>(value: T): ApiStorePort<T> & { value: T } => {
  const s = { value, load: async () => s.value, save: async (v: T) => void (s.value = v) };
  return s;
};
const ok = (body: string, extra: Partial<{ status: number; headers: [string, string][] }> = {}): SendOutcome => ({
  ok: true,
  response: { status: extra.status ?? 200, statusText: 'OK', ms: 5, size: body.length, headers: extra.headers ?? [['content-type', 'application/json']], body, truncated: false, contentType: 'application/json', redirects: [], binary: false },
  bytes: new TextEncoder().encode(body),
});

function setup(send: (p: unknown, signal: AbortSignal, cookies?: CookieHooks) => Promise<SendOutcome>, vars: { name: string; value: string; secret: boolean }[] = []) {
  let n = 0;
  const envs = mem(ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'e1', name: 'Local', vars })));
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const service = new ApiService({
    collections: mem(ApiCollections.empty()),
    envs,
    history: mem(ApiHistory.empty()),
    send: send as never,
    newId: () => `id${++n}`,
    now: () => new Date('2026-01-01T00:00:00Z'),
    saveFile: async () => null,
    saveBytes: async (name, bytes) => (saved.push({ name, bytes }), `/tmp/${name}`),
  });
  return { service, envs, saved };
}

const login = {
  id: 'r1',
  name: 'Login',
  method: 'POST',
  url: 'http://localhost:3000/login',
  after: {
    captures: [
      { name: 'token', from: 'json', path: '$.accessToken' },
      { name: 'userId', from: 'json', path: 'user.id' },
      { name: 'missing', from: 'json', path: 'nope' },
    ],
    checks: [
      { target: 'status', op: 'eq', value: '200' },
      { target: 'json', path: 'user.id', op: 'eq', value: '8' },
    ],
  },
};

describe('API 서비스 — 응답 뒤 규칙', () => {
  it('응답에서 꺼낸 값을 고른 환경에 저장하고, 토큰 같은 이름은 비밀로 둔다', async () => {
    const { service, envs } = setup(async () => ok('{"accessToken":"tok-xyz-123","user":{"id":7}}'));
    const r = await service.send({ key: 'r1', request: login });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const env = envs.value.find('e1');
    expect(env?.variableMap().get('token')).toBe('tok-xyz-123');
    expect(env?.props.vars.find((v) => v.name === 'token')?.secret).toBe(true);
    expect(env?.props.vars.find((v) => v.name === 'userId')).toMatchObject({ value: '7', secret: false });
    // 화면으로 가는 규칙 결과·환경 목록·복사용 응답에는 비밀 값이 없다
    expect(JSON.stringify([r.after, r.envs, r.masked])).not.toContain('tok-xyz-123');
    expect(r.after?.captured).toEqual([
      { name: 'token', value: '••••', found: true },
      { name: 'userId', value: '7', found: true },
      { name: 'missing', value: '', found: false },
    ]);
    expect(r.after?.checks.map((c) => c.pass)).toEqual([true, false]);
    expect(r.envs?.items[0]?.vars.find((v) => v.name === 'token')).toMatchObject({ secret: true, has: true, value: '' });
  });

  it('이미 있는 변수는 값만 바꾸고 비밀 여부는 지킨다', async () => {
    const { service, envs } = setup(async () => ok('{"accessToken":"new","user":{"id":9}}'), [{ name: 'userId', value: '1', secret: true }]);
    await service.send({ key: 'r1', request: login });
    expect(envs.value.find('e1')?.props.vars.find((v) => v.name === 'userId')).toMatchObject({ value: '9', secret: true });
  });

  it('환경을 고르지 않았으면 저장하지 않고 알려 준다', async () => {
    const { service, envs } = setup(async () => ok('{"accessToken":"t"}'));
    envs.value = envs.value.select(null);
    const r = await service.send({ key: 'r1', request: login });
    expect(r.ok && r.after?.note).toMatch(/Pick an environment/);
    expect(envs.value.find('e1')?.variableMap().has('token')).toBe(false);
  });

  it('저장한 변수를 다음 요청에서 바로 쓸 수 있다(로그인 → 내 정보)', async () => {
    const sent: string[] = [];
    const { service } = setup(async (p) => {
      sent.push(JSON.stringify(p));
      return ok('{"accessToken":"tok-chain-1","user":{"id":1}}');
    });
    await service.send({ key: 'r1', request: login });
    await service.send({ key: 'r2', request: { id: 'r2', name: 'Me', method: 'GET', url: 'http://localhost:3000/me', auth: { kind: 'bearer', token: '{{token}}' } } });
    expect(sent[1]).toContain('Bearer tok-chain-1');
  });
});

describe('API 서비스 — 쿠키와 응답 저장', () => {
  it('보내기에 쿠키 저장소를 넘기고, 목록과 비우기를 준다', async () => {
    const { service } = setup(async (_p, _s, cookies) => {
      cookies?.store('http://localhost:3000/login', ['sid=abcdef; Path=/']);
      return ok('{}');
    });
    await service.send({ key: 'r1', request: { id: 'r1', url: 'http://localhost:3000/login' } });
    expect(service.cookies()).toMatchObject({ count: 1, items: [{ domain: 'localhost', name: 'sid', value: 'abcd…' }] });
    expect(service.clearCookies()).toMatchObject({ count: 0 });
  });

  it('마지막 응답 본문 전체를 파일로 저장한다(다른 기록 id 는 거절)', async () => {
    const { service, saved } = setup(async () => ok('{"big":true}'));
    const r = await service.send({ key: 'r1', request: { id: 'r1', url: 'http://localhost:3000/data.json' } });
    if (!r.ok) throw new Error('send failed');
    const s = await service.saveBody(r.historyId);
    expect(s).toEqual({ ok: true, saved: '/tmp/data.json' });
    expect(new TextDecoder().decode(saved[0]?.bytes)).toBe('{"big":true}');
    expect(await service.saveBody('other')).toMatchObject({ ok: false });
  });
});
