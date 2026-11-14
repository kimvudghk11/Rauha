import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CookieJar } from '../../shared/api-cookies.js';
import type { PreparedRequest } from '../../shared/api-request.js';
import { sendPrepared, type CookieHooks } from './api-sender.js';

let server: Server;
let base = '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? '';
      const json = (o: unknown): void => (res.setHeader('content-type', 'application/json'), void res.end(JSON.stringify(o)));
      if (url === '/upload') return json({ ct: req.headers['content-type'], text: body.toString('latin1') });
      if (url === '/login') return (res.statusCode = 302, res.setHeader('set-cookie', ['sid=s1; Path=/']), res.setHeader('location', '/me'), res.end());
      if (url === '/me') return json({ cookie: req.headers.cookie ?? null, ua: req.headers['user-agent'] });
      if (url === '/png') return (res.setHeader('content-type', 'image/png'), res.end(PNG));
      if (url === '/svg') return (res.setHeader('content-type', 'image/svg+xml'), res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const prep = (path: string, o: Partial<PreparedRequest> = {}): PreparedRequest => ({ method: 'GET', url: `${base}${path}`, headers: [], body: null, secrets: [], ...o });
const jarHooks = (): CookieHooks & { jar: () => CookieJar } => {
  let jar = CookieJar.empty();
  return { header: (u) => jar.header(u, Date.now()), store: (u, c) => void (jar = jar.store(u, c, Date.now())), jar: () => jar };
};

describe('보내기 — multipart', () => {
  it('글 필드와 파일 필드를 multipart/form-data 로 보내고, 파일은 readFile 로 읽는다', async () => {
    const r = await sendPrepared(prep('/upload', { method: 'POST', multipart: [{ name: 'title', value: '제목' }, { name: 'doc', file: 'C:/x/report.txt' }] }), {
      signal: new AbortController().signal,
      readFile: async (path) => ({ bytes: new TextEncoder().encode(`file:${path}`), name: 'report.txt' }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = JSON.parse(r.response.body) as { ct: string; text: string };
    expect(got.ct).toMatch(/^multipart\/form-data; boundary=/);
    expect(got.text).toContain('name="doc"; filename="report.txt"');
    expect(got.text).toContain('file:C:/x/report.txt');
    expect(got.text).toContain('name="title"');
  });
  it('파일을 못 읽으면 보내지 않고 이유를 알린다', async () => {
    const r = await sendPrepared(prep('/upload', { method: 'POST', multipart: [{ name: 'doc', file: 'C:/nope.bin' }] }), {
      signal: new AbortController().signal,
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Could not read the file for doc.*nope\.bin/);
  });
});

describe('보내기 — 쿠키', () => {
  it('리다이렉트 중에 받은 쿠키도 기억해 다음 요청에 붙인다', async () => {
    const hooks = jarHooks();
    const r = await sendPrepared(prep('/login'), { signal: new AbortController().signal, cookies: hooks });
    expect(r.ok && JSON.parse(r.response.body).cookie).toBe('sid=s1');
    expect(hooks.jar().size(Date.now())).toBe(1);
  });
  it('사용자가 직접 Cookie 헤더를 적으면 저장소 쿠키를 덧붙이지 않는다', async () => {
    const hooks = jarHooks();
    hooks.store(`${base}/`, ['sid=s1']);
    const r = await sendPrepared(prep('/me', { headers: [['Cookie', 'mine=1']] }), { signal: new AbortController().signal, cookies: hooks });
    expect(r.ok && JSON.parse(r.response.body).cookie).toBe('mine=1');
  });
});

describe('보내기 — 기본 값과 미리보기', () => {
  it('User-Agent 를 적지 않으면 rauha 로 보낸다', async () => {
    const r = await sendPrepared(prep('/me'), { signal: new AbortController().signal, userAgent: 'rauha/9.9.9' });
    expect(r.ok && JSON.parse(r.response.body).ua).toBe('rauha/9.9.9');
    const mine = await sendPrepared(prep('/me', { headers: [['User-Agent', 'curl/8']] }), { signal: new AbortController().signal, userAgent: 'rauha/9.9.9' });
    expect(mine.ok && JSON.parse(mine.response.body).ua).toBe('curl/8');
  });
  it('PNG 같은 이미지는 미리보기 data URL 을 싣고, SVG 는 싣지 않는다(스크립트가 들 수 있다)', async () => {
    const png = await sendPrepared(prep('/png'), { signal: new AbortController().signal });
    expect(png.ok && png.response.preview).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    const svg = await sendPrepared(prep('/svg'), { signal: new AbortController().signal });
    expect(svg.ok && (svg.response.preview ?? null)).toBeNull();
  });
  it('받은 바이트를 그대로 돌려줘 파일로 저장할 수 있다', async () => {
    const r = await sendPrepared(prep('/png'), { signal: new AbortController().signal });
    expect(r.ok && r.bytes !== undefined && Buffer.from(r.bytes).equals(PNG)).toBe(true);
  });
  it('IP 주소 호스트는 이름 풀기를 하지 않는다', async () => {
    const asked: string[] = [];
    await sendPrepared(prep('/me'), { signal: new AbortController().signal, resolve: async (h) => (asked.push(h), ['127.0.0.1']) });
    expect(asked).toEqual([]);
  });
});
