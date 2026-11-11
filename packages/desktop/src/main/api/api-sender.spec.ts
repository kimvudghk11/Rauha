import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESPONSE_LIMITS } from '../../shared/api-response.js';
import type { PreparedRequest } from '../../shared/api-request.js';
import { sendPrepared } from './api-sender.js';

const FAKE = ['tok', 'en', '-abc', '123456'].join('');
let server: Server;
let other: Server;
let base = '';
let otherBase = '';
const seen: { url: string; auth: string | undefined; method: string; body: string }[] = [];

const listen = (s: Server): Promise<string> => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

beforeAll(async () => {
  other = createServer((req, res) => {
    seen.push({ url: `other${req.url}`, auth: req.headers.authorization, method: req.method ?? '', body: '' });
    res.end('other');
  });
  otherBase = await listen(other);
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, method: req.method ?? '', body });
      const url = req.url ?? '';
      if (url === '/json') return (res.setHeader('content-type', 'application/json'), res.setHeader('set-cookie', ['a=1; Path=/', 'b=2']), res.end('{"ok":true}'));
      if (url === '/echo') return (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify({ method: req.method, body, ct: req.headers['content-type'] })));
      if (url === '/401') return (res.statusCode = 401, res.end('no'));
      if (url === '/redir') return (res.statusCode = 302, res.setHeader('location', '/json'), res.end());
      if (url === '/redir-post') return (res.statusCode = 302, res.setHeader('location', '/echo'), res.end());
      if (url === '/loop') return (res.statusCode = 302, res.setHeader('location', '/loop'), res.end());
      if (url === '/to-file') return (res.statusCode = 302, res.setHeader('location', 'file:///etc/passwd'), res.end());
      if (url === '/to-other') return (res.statusCode = 302, res.setHeader('location', `${otherBase}/landed`), res.end());
      if (url === '/slow') return void setTimeout(() => res.end('late'), 3000);
      if (url === '/big') return (res.setHeader('content-type', 'text/plain'), res.end(Buffer.alloc(RESPONSE_LIMITS.read + 1000, 97)));
      if (url === '/png') return (res.setHeader('content-type', 'image/png'), res.end(Buffer.from([137, 80, 78, 71, 0, 1, 2])));
      res.statusCode = 404;
      res.end('nope');
    });
  });
  base = await listen(server);
});

afterAll(() => {
  server.closeAllConnections();
  other.closeAllConnections();
  server.close();
  other.close();
});

const prep = (path: string, o: Partial<PreparedRequest> = {}): PreparedRequest => ({ method: 'GET', url: `${base}${path}`, headers: [], body: null, secrets: [], ...o });
const send = (r: PreparedRequest, o: { timeoutMs?: number; signal?: AbortSignal } = {}) => sendPrepared(r, { signal: o.signal ?? new AbortController().signal, ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}) });

describe('요청 보내기(진짜 로컬 서버)', () => {
  it('GET JSON: 상태·시간·크기·헤더·본문을 돌려주고 Set-Cookie는 줄마다 따로 온다', async () => {
    const r = await send(prep('/json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response).toMatchObject({ status: 200, body: '{"ok":true}', size: 11, truncated: false, binary: false });
    expect(r.response.ms).toBeGreaterThanOrEqual(0);
    expect(r.response.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v)).toEqual(['a=1; Path=/', 'b=2']);
  });
  it('POST JSON 본문과 헤더가 서버에 닿는다', async () => {
    const r = await send(prep('/echo', { method: 'POST', headers: [['Content-Type', 'application/json']], body: '{"a":1}' }));
    expect(r.ok && JSON.parse(r.response.body)).toEqual({ method: 'POST', body: '{"a":1}', ct: 'application/json' });
  });
  it('401 같은 오류 상태도 응답으로 돌려준다', async () => {
    const r = await send(prep('/401'));
    expect(r.ok && r.response.status).toBe(401);
  });
  it('302는 따라가고 따라간 주소를 알려 준다', async () => {
    const r = await send(prep('/redir'));
    expect(r.ok && r.response.status).toBe(200);
    expect(r.ok && r.response.redirects).toEqual([`${base}/json`]);
  });
  it('POST가 302로 가면 GET으로 바꾸고 본문을 떼어 낸다', async () => {
    const r = await send(prep('/redir-post', { method: 'POST', headers: [['Content-Type', 'application/json']], body: '{"x":1}' }));
    expect(r.ok && JSON.parse(r.response.body)).toMatchObject({ method: 'GET', body: '' });
  });
  it('리다이렉트가 끝없이 돌면 10번에서 멈추고 이유를 알린다', async () => {
    const r = await send(prep('/loop'));
    expect(!r.ok && r.error).toContain('Too many redirects');
  });
  it('file:// 로 넘어가는 리다이렉트는 막는다', async () => {
    const r = await send(prep('/to-file'));
    expect(!r.ok && r.kind).toBe('blocked');
    expect(!r.ok && r.error).toContain('file:');
  });
  it('다른 사이트로 리다이렉트되면 Authorization을 떼고 간다', async () => {
    seen.length = 0;
    const r = await send(prep('/to-other', { headers: [['Authorization', `Bearer ${FAKE}`]] }));
    expect(r.ok && r.response.body).toBe('other');
    expect(seen.find((s) => s.url === 'other/landed')?.auth).toBeUndefined();
    expect(seen.find((s) => s.url === '/to-other')?.auth).toBe(`Bearer ${FAKE}`);
  });
  it('file:·ftp: 주소는 아예 보내지 않는다', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://x/y']) {
      const r = await send(prep('', { url }));
      expect(!r.ok && r.kind).toBe('blocked');
    }
  });
  it('시간 제한이 지나면 timeout으로 멈춘다', async () => {
    const r = await send(prep('/slow'), { timeoutMs: 200 });
    expect(!r.ok && r.kind).toBe('timeout');
  });
  it('취소하면 cancelled로 멈춘다', async () => {
    const c = new AbortController();
    const p = send(prep('/slow'), { signal: c.signal });
    setTimeout(() => c.abort(), 100);
    const r = await p;
    expect(!r.ok && r.kind).toBe('cancelled');
  });
  it('본문이 5MB를 넘으면 잘라서 truncated로 알린다', async () => {
    const r = await send(prep('/big'));
    expect(r.ok && r.response.truncated).toBe(true);
    expect(r.ok && r.response.size).toBe(RESPONSE_LIMITS.read);
  });
  it('이미지 같은 본문은 binary로 알리고 글자는 싣지 않는다', async () => {
    const r = await send(prep('/png'));
    expect(r.ok && r.response).toMatchObject({ binary: true, body: '', size: 7 });
  });
  it('막힌 포트(1번 등)는 이유를 알려 준다', async () => {
    const r = await send(prep('', { url: 'http://127.0.0.1:1/x' }));
    expect(!r.ok && r.error).toContain('port is blocked');
  });
  it('연결할 곳이 없으면 이유를 알려 준다', async () => {
    const dead = createServer();
    const url = await listen(dead);
    dead.close();
    const r = await send(prep('', { url: `${url}/x` }));
    expect(!r.ok && r.kind).toBe('network');
    expect(!r.ok && r.error).toContain('refused');
  });
});
