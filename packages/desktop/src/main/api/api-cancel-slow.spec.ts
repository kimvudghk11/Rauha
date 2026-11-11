import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sendPrepared } from './api-sender.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server === undefined ? done() : (server.closeAllConnections(), server.close(() => done())))));

describe('느린 응답 취소', () => {
  it('느린 로컬 서버에 보낸 요청을 취소하면 1초 안에 취소됨으로 끝난다', async () => {
    server = createServer((_req, res) => void setTimeout(() => res.end('late'), 6000));
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();
    const started = Date.now();
    const pending = sendPrepared({ method: 'GET', url: `http://127.0.0.1:${port}/slow`, headers: [], body: null, secrets: [] } as never, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
