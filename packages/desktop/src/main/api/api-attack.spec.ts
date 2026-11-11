import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiEnvironment, ApiEnvironments } from '../../shared/api-env.js';
import type { PreparedRequest } from '../../shared/api-request.js';
import { RESPONSE_LIMITS } from '../../shared/api-response.js';
import { sendPrepared } from './api-sender.js';
import { EnvironmentsStore } from './api-store.js';

const FAKE = ['sec', 'ret', '-value', '987654'].join('');
const prepared = (url: string, extra: Partial<PreparedRequest> = {}): PreparedRequest => ({ method: 'GET', url, headers: [], body: null, secrets: [], ...extra });
const neverFetch = (() => {
  throw new Error('fetch must not be called');
}) as unknown as typeof fetch;

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/to-metadata') return (res.statusCode = 302, res.setHeader('location', 'http://169.254.169.254/latest/meta-data/'), res.end());
    if (url === '/to-metadata-v6') return (res.statusCode = 302, res.setHeader('location', 'http://[::ffff:a9fe:a9fe]/'), res.end());
    if (url === '/to-rebind') return (res.statusCode = 302, res.setHeader('location', 'http://rebind.test/x'), res.end());
    if (url === '/bomb') {
      res.setHeader('content-type', 'text/plain');
      res.setHeader('content-encoding', 'gzip');
      return res.end(gzipSync(Buffer.alloc(60 * 1024 * 1024, 97)));
    }
    if (url === '/trickle') {
      res.setHeader('content-type', 'text/plain');
      res.write('a');
      const timer = setInterval(() => res.write('a'), 50);
      res.on('close', () => clearInterval(timer));
      return;
    }
    res.end('ok');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('보내기: 메타데이터 주소로 가는 길 막기', () => {
  it('이름이 메타데이터 IP 로 풀리면(DNS 속임) fetch 를 부르지 않고 막는다', async () => {
    const out = await sendPrepared(prepared('http://rebind.test/x'), { signal: new AbortController().signal, fetchFn: neverFetch, resolve: async () => ['93.184.216.34', '169.254.169.254'] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('blocked');
  });
  it('IPv6 로 풀려도 막는다(::ffff:a9fe:a9fe, fe80::1)', async () => {
    for (const address of ['::ffff:a9fe:a9fe', 'fe80::1']) {
      const out = await sendPrepared(prepared('http://rebind.test/'), { signal: new AbortController().signal, fetchFn: neverFetch, resolve: async () => [address] });
      expect(out.ok).toBe(false);
    }
  });
  it('이름이 로컬 주소(127.0.0.1)로 풀리는 것은 개발 서버라 허용한다', async () => {
    let called = false;
    const fake = (async () => {
      called = true;
      return new Response('ok');
    }) as unknown as typeof fetch;
    const out = await sendPrepared(prepared('http://dev.test/x'), { signal: new AbortController().signal, fetchFn: fake, resolve: async () => ['127.0.0.1'] });
    expect(out.ok).toBe(true);
    expect(called).toBe(true);
  });
  it('이름을 풀지 못하면 막지 않고 보내기 오류를 그대로 쓴다', async () => {
    const fake = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof fetch;
    const out = await sendPrepared(prepared('http://nope.test/'), { signal: new AbortController().signal, fetchFn: fake, resolve: async () => Promise.reject(new Error('nxdomain')) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('network');
  });
  it('리다이렉트가 메타데이터 주소(IPv4·IPv6)로 가면 따라가지 않는다', async () => {
    for (const path of ['/to-metadata', '/to-metadata-v6']) {
      const out = await sendPrepared(prepared(`${base}${path}`), { signal: new AbortController().signal });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.kind).toBe('blocked');
        expect(out.error).toMatch(/redirect/i);
      }
    }
  });
  it('리다이렉트가 메타데이터로 풀리는 이름으로 가도 막는다', async () => {
    const out = await sendPrepared(prepared(`${base}/to-rebind`), { signal: new AbortController().signal, resolve: async (h) => (h === 'rebind.test' ? ['169.254.169.254'] : ['127.0.0.1']) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('blocked');
  });
});

describe('보내기: 크기·시간 제한', () => {
  it('압축을 풀면 60MB 가 되는 응답(압축 폭탄)도 5MB 에서 멈추고 잘렸다고 알린다', async () => {
    const t = Date.now();
    const out = await sendPrepared(prepared(`${base}/bomb`), { signal: new AbortController().signal });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.response.size).toBeLessThanOrEqual(RESPONSE_LIMITS.read);
      expect(out.response.truncated).toBe(true);
    }
    expect(Date.now() - t).toBeLessThan(10_000);
  });
  it('조금씩 계속 보내는 응답도 전체 시간 제한이 지나면 끊는다', async () => {
    const out = await sendPrepared(prepared(`${base}/trickle`), { signal: new AbortController().signal, timeoutMs: 400 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('timeout');
  });
});

describe.skipIf(process.platform === 'win32')('비밀 저장 파일 권한(맥·리눅스)', () => {
  it('환경 파일은 소유자만 읽고 쓴다(0600)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rauha-env-'));
    try {
      const file = join(dir, 'api-environments.json');
      const store = new EnvironmentsStore(file);
      await store.save(ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'e', name: 'E', vars: [{ name: 'tok', value: FAKE, secret: true }] })));
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      // 두 번째 저장(덮어쓰기)도 같은 권한을 지킨다
      await store.save(ApiEnvironments.empty());
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
