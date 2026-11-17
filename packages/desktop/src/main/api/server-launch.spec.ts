import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeServer } from './server-probe.js';
import { launchServer } from './server-launch.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

function project(script: string): string {
  const d = mkdtempSync(join(tmpdir(), 'rauha-launch-'));
  dirs.push(d);
  writeFileSync(join(d, 'server.js'), script);
  return d;
}

describe('서버 띄우기', () => {
  it('허락받은 명령으로 띄우고 주소가 응답하면 돌려주며, stop 하면 프로세스가 꺼져 주소가 닫힌다', async () => {
    const port = await freePort();
    const root = project(`require('http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1');`);
    const url = `http://127.0.0.1:${port}`;
    const started = await launchServer(root, { kind: 'local', command: 'node server.js', stop: null }, url, (u) => probeServer(u), 20_000);
    expect(typeof started).not.toBe('string');
    expect(await probeServer(url)).toBeNull();
    await (started as { stop(): Promise<void> }).stop();
    let closed = false;
    for (let i = 0; i < 20 && !closed; i++) {
      closed = (await probeServer(url)) !== null;
      if (!closed) await new Promise((r) => setTimeout(r, 250));
    }
    expect(closed).toBe(true);
  }, 30_000);

  it('명령이 먼저 끝나면 그 이유와 마지막 출력을 알려 준다', async () => {
    const root = project(`console.error('Cannot find module @nestjs/core'); process.exit(3);`);
    const r = await launchServer(root, { kind: 'local', command: 'node server.js', stop: null }, 'http://127.0.0.1:1', (u) => probeServer(u), 20_000);
    expect(r).toMatch(/먼저 끝났어요/);
    expect(r).toContain('Cannot find module');
  }, 30_000);
});
