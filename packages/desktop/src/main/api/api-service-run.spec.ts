import { describe, expect, it } from 'vitest';
import { ApiCollections } from '../../shared/api-collections.js';
import { ApiEnvironment, ApiEnvironments } from '../../shared/api-env.js';
import { ApiRequest } from '../../shared/api-request.js';
import { ApiHistory } from '../../shared/api-response.js';
import type { SendOutcome } from './api-sender.js';
import { ApiService } from './api-service.js';
import type { ApiStorePort } from './api-store.js';

const mem = <T>(value: T): ApiStorePort<T> & { value: T } => {
  const s = { value, load: async () => s.value, save: async (v: T) => void (s.value = v) };
  return s;
};
const res = (status: number, body: string): SendOutcome => ({ ok: true, response: { status, statusText: '', ms: 4, size: body.length, headers: [['content-type', 'application/json']], body, truncated: false, contentType: 'application/json', redirects: [], binary: false } });

function setup(handler: (p: { url: string; headers: readonly (readonly [string, string])[] }) => SendOutcome) {
  let n = 0;
  const login = ApiRequest.create({ id: 'login', name: 'Login', method: 'POST', url: '{{base_url}}/login', after: { captures: [{ name: 'token', from: 'json', path: 'accessToken', enabled: true }], checks: [{ target: 'status', path: '', op: 'eq', value: '200', enabled: true }] } });
  const me = ApiRequest.create({ id: 'me', name: 'Me', url: '{{base_url}}/me', auth: { kind: 'bearer', token: '{{token}}' } });
  const orders = ApiRequest.create({ id: 'orders', name: 'Orders', url: '{{base_url}}/orders' });
  const collections = mem(ApiCollections.empty().addFolder('f1', 'Auth flow', null).addRequest(login, 'f1').addRequest(me, 'f1').addRequest(orders, 'f1'));
  const envs = mem(ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'e1', name: 'Local', vars: [{ name: 'base_url', value: 'http://localhost:3000', secret: false }] })));
  const sent: string[] = [];
  const service = new ApiService({
    collections,
    envs,
    history: mem(ApiHistory.empty()),
    send: (async (p: { url: string; headers: readonly (readonly [string, string])[] }) => (sent.push(p.url), handler(p))) as never,
    newId: () => `id${++n}`,
    now: () => new Date('2026-11-14T00:00:00Z'),
    saveFile: async () => null,
  });
  return { service, sent };
}

describe('API 서비스 — 폴더 일괄 실행', () => {
  it('폴더의 요청을 순서대로 보내고, 앞 요청에서 저장한 토큰을 다음 요청이 쓴다', async () => {
    const { service } = setup((p) => (p.url.endsWith('/login') ? res(200, '{"accessToken":"tok-run-1"}') : p.url.endsWith('/me') ? res(p.headers.some(([k, v]) => k === 'Authorization' && v === 'Bearer tok-run-1') ? 200 : 401, '{}') : res(500, '{}')));
    const r = await service.runFolder({ folderId: 'f1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.steps.map((s) => [s.name, s.status])).toEqual([
      ['Login', 200],
      ['Me', 200],
      ['Orders', 500],
    ]);
    expect(r.report.steps[0]?.saved).toEqual(['token']);
    expect(r.summary).toEqual({ total: 3, passed: 2, failed: 1, skipped: 0, ms: 12 });
    expect(r.markdown).toContain('# Run: Auth flow');
    expect(JSON.stringify(r)).not.toContain('tok-run-1');
  });

  it('실패하면 멈추기를 켜면 남은 요청은 보내지 않고 건너뜀으로 둔다', async () => {
    const { service, sent } = setup(() => res(500, '{}'));
    const r = await service.runFolder({ folderId: 'f1', stopOnFail: true });
    expect(sent).toHaveLength(1);
    expect(r.ok && r.report.steps.map((s) => s.skipped)).toEqual([false, true, true]);
  });

  it('없는 폴더·빈 폴더는 이유를 알린다', async () => {
    const { service } = setup(() => res(200, '{}'));
    expect(await service.runFolder({ folderId: 'nope' })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });

  it('실행 중에 취소하면 남은 요청은 보내지 않는다', async () => {
    let service!: ApiService;
    const made = setup(() => (service.cancelRun(), res(200, '{"accessToken":"t"}')));
    service = made.service;
    const r = await service.runFolder({ folderId: 'f1' });
    expect(made.sent).toHaveLength(1);
    expect(r.ok && r.report.steps.filter((s) => s.skipped)).toHaveLength(2);
  });
});
