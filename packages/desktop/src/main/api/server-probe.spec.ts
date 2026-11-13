import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { probeServer } from './server-probe.js';

describe('서버 사전 확인(TCP)', () => {
  it('듣고 있는 포트면 null 이다', async () => {
    const server = createServer((s) => s.end());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      expect(await probeServer(`http://127.0.0.1:${port}/users`)).toBeNull();
    } finally {
      server.close();
    }
  });

  it('아무도 듣지 않는 포트면 "Connection refused" 이유를 돌려준다', async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));
    expect(await probeServer(`http://127.0.0.1:${port}`)).toMatch(/^Connection refused/);
  });
});
