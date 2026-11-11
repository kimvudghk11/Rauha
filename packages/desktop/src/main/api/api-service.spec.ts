import { describe, expect, it } from 'vitest';
import { ApiCollections } from '../../shared/api-collections.js';
import { ApiEnvironment, ApiEnvironments } from '../../shared/api-env.js';
import { ApiHistory } from '../../shared/api-response.js';
import type { SendOutcome } from './api-sender.js';
import { ApiService } from './api-service.js';
import type { ApiStorePort } from './api-store.js';

const FAKE = ['tok', 'en', '-abc', '123456'].join('');
const mem = <T>(value: T): ApiStorePort<T> & { value: T } => {
  const s = { value, load: async () => s.value, save: async (v: T) => void (s.value = v) };
  return s;
};

function setup(send: (p: unknown, signal: AbortSignal) => Promise<SendOutcome> = async () => ({ ok: true, response: { status: 200, statusText: 'OK', ms: 3, size: 2, headers: [['content-type', 'text/plain']], body: 'ok', truncated: false, contentType: 'text/plain', redirects: [], binary: false } })) {
  let n = 0;
  const collections = mem(ApiCollections.empty());
  const envs = mem(ApiEnvironments.empty());
  const history = mem(ApiHistory.empty());
  const service = new ApiService({ collections, envs, history, send: send as never, newId: () => `id${++n}`, now: () => new Date('2026-01-01T00:00:00Z'), saveFile: async () => null });
  return { service, collections, envs, history };
}

const req = (o: Record<string, unknown> = {}) => ({ id: 'r1', name: 'Login', method: 'POST', url: 'http://localhost:3000/login', ...o });

describe('API 서비스', () => {
  it('요청을 저장하면 값으로 적힌 토큰은 환경의 비밀 변수가 되고 요청에는 {{이름}}만 남는다', async () => {
    const { service, envs } = setup();
    const added = await service.applyCollection({ kind: 'add-request', parentId: null, request: req({ auth: { kind: 'bearer', token: FAKE } }) });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(JSON.stringify(added.collections)).not.toContain(FAKE);
    expect(JSON.stringify(added.envs)).not.toContain(FAKE);
    expect(added.envs?.items[0]?.vars[0]).toMatchObject({ secret: true, has: true, value: '' });
    expect([...envs.value.selectedVariables().values()]).toContain(FAKE);
    expect(JSON.stringify(await service.getCollections())).not.toContain(FAKE);
    expect(JSON.stringify(await service.getEnvs())).not.toContain(FAKE);
  });

  it('보낼 때 환경 값이 채워지고, 기록에는 변수 이름과 가려진 응답만 남는다', async () => {
    let sent: { headers: [string, string][]; url: string } | null = null;
    const { service, envs, history } = setup(async (p) => {
      sent = p as never;
      return { ok: true, response: { status: 200, statusText: 'OK', ms: 1, size: 20, headers: [['set-cookie', 'sid=abc999; Path=/']], body: `you sent ${FAKE}`, truncated: false, contentType: 'text/plain', redirects: [], binary: false } };
    });
    envs.value = ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'e', name: 'Local', vars: [{ name: 'base', value: 'http://localhost:3000', secret: false }, { name: 'tok', value: FAKE, secret: true }] }));
    const r = await service.send({ key: 'r1', request: req({ url: '{{base}}/me', auth: { kind: 'bearer', token: '{{tok}}' } }) });
    expect(r.ok).toBe(true);
    expect(sent!.url).toBe('http://localhost:3000/me');
    expect(sent!.headers).toContainEqual(['Authorization', `Bearer ${FAKE}`]);
    const stored = JSON.stringify(history.value.entries);
    expect(stored).not.toContain(FAKE);
    expect(stored).not.toContain('abc999');
    expect(stored).toContain('{{tok}}');
    if (r.ok) expect(JSON.stringify(r.masked)).not.toContain(FAKE);
  });

  it('없는 변수는 보내지 않고 이름을 알린다', async () => {
    const { service } = setup();
    const r = await service.send({ key: 'k', request: req({ url: '{{base}}/x' }) });
    expect(r).toMatchObject({ ok: false, kind: 'missing', missing: ['base'] });
  });

  it('같은 요청을 두 번 눌러도 한 번만 보낸다', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((ok) => (release = ok));
    const { service } = setup(async () => {
      calls++;
      await gate;
      return { ok: false, kind: 'network', error: 'x', ms: 1 };
    });
    const first = service.send({ key: 'k', request: req() });
    const second = await service.send({ key: 'k', request: req() });
    expect(second).toMatchObject({ ok: false, kind: 'busy' });
    release();
    await first;
    expect(calls).toBe(1);
    expect(await service.send({ key: 'k', request: req() })).toMatchObject({ kind: 'network' });
    expect(calls).toBe(2);
  });

  it('취소하면 신호가 가고, 취소한 요청은 기록에 남기지 않는다', async () => {
    const { service, history } = setup((_p, signal) => new Promise((ok) => signal.addEventListener('abort', () => ok({ ok: false, kind: 'cancelled', error: 'Cancelled.', ms: 1 }))));
    const p = service.send({ key: 'k', request: req() });
    await new Promise((r) => setTimeout(r, 10));
    expect(service.cancel('k')).toBe(true);
    expect(await p).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(history.value.entries).toHaveLength(0);
    expect(service.cancel('k')).toBe(false);
  });

  it('file: 주소는 보내기 전에 막는다', async () => {
    let called = false;
    const { service } = setup(async () => ((called = true), { ok: false, kind: 'network', error: '', ms: 0 }));
    expect(await service.send({ key: 'k', request: req({ url: 'file:///etc/passwd' }) })).toMatchObject({ kind: 'blocked' });
    expect(called).toBe(false);
  });

  it('잘못된 모양의 요청은 invalid로 돌려준다', async () => {
    const { service } = setup();
    expect(await service.send({ key: 'k', request: { id: 'a', url: 5 } })).toMatchObject({ kind: 'invalid' });
    expect(await service.send(null)).toMatchObject({ kind: 'invalid' });
  });

  it('cURL을 가져오면 토큰이 환경으로 옮겨지고 컬렉션에는 요청이 생긴다', async () => {
    const { service, envs } = setup();
    const r = await service.importText({ format: 'curl', text: `curl -H 'Authorization: Bearer ${FAKE}' http://localhost:3000/me`, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r)).not.toContain(FAKE);
    expect(r.focusId).not.toBeNull();
    expect([...envs.value.selectedVariables().values()]).toContain(FAKE);
  });

  it('OpenAPI를 가져오면 base_url이 환경 변수가 되고 폴더가 생긴다', async () => {
    const { service, envs, collections } = setup();
    const doc = { openapi: '3.0.0', info: { title: 'Pets' }, servers: [{ url: 'http://localhost:9000' }], paths: { '/pets': { get: { summary: 'List' } } } };
    const r = await service.importText({ format: 'openapi', text: JSON.stringify(doc), parentId: null });
    expect(r.ok).toBe(true);
    expect(envs.value.selectedVariables().get('base_url')).toBe('http://localhost:9000');
    expect(collections.value.requests().map((x) => x.name)).toEqual(['List']);
  });

  it('.http로 내보내면 비밀은 {{이름}}이고, 폴더를 내보내면 안의 요청이 모두 들어간다', async () => {
    const { service, collections } = setup();
    let c = ApiCollections.empty().addFolder('f', 'Users', null);
    const { ApiRequest } = await import('../../shared/api-request.js');
    c = c.addRequest(ApiRequest.create({ id: 'a', name: 'A', url: 'http://x/a', auth: { kind: 'bearer', token: FAKE } }), 'f').addRequest(ApiRequest.create({ id: 'b', name: 'B', url: 'http://x/b' }), 'f');
    collections.value = c;
    const r = await service.exportItem({ format: 'http', id: 'f' }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain(FAKE);
    expect(r.text).toContain('### A');
    expect(r.text).toContain('### B');
    expect(r.fileName).toBe('Users.http');
    expect(await service.exportItem({ format: 'curl', id: 'f' }, false)).toMatchObject({ ok: false });
  });

  it('환경 저장: 비밀 값은 null로 보내면 그대로 유지되고 화면 응답에는 값이 없다', async () => {
    const { service, envs } = setup();
    const added = await service.applyEnv({ kind: 'add', name: 'Local' });
    expect(added.ok).toBe(true);
    const id = envs.value.items[0]!.id;
    await service.applyEnv({ kind: 'save', id, name: 'Local', vars: [{ name: 'tok', value: FAKE, secret: true }] });
    const kept = await service.applyEnv({ kind: 'save', id, name: 'Local', vars: [{ name: 'tok', value: null, secret: true }, { name: 'base', value: 'http://x', secret: false }] });
    expect(JSON.stringify(kept)).not.toContain(FAKE);
    expect(envs.value.selectedVariables().get('tok')).toBe(FAKE);
    expect(await service.applyEnv({ kind: 'save', id, name: 'Local', vars: [{ name: '__proto__', value: 'x', secret: false }] })).toMatchObject({ ok: false });
  });
});
