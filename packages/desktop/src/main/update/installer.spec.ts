import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstaller, macBundleOf, MIN_INSTALLER_BYTES, STALL_MS } from './installer.js';
import { InstallFailure, type InstallPlan } from '../../shared/update-install.js';
import type { InstallHooks } from './update-service.js';

const URL_OK = 'https://github.com/kimvudghk11/rauha/releases/download/v0.1.4/rauha-0.1.4-mac-arm64.dmg';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});

function bodyOf(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= bytes) return c.close();
      const n = Math.min(chunk.length, bytes - sent);
      c.enqueue(chunk.subarray(0, n));
      sent += n;
    },
  });
}

const shaOfZeros = (n: number): string => {
  const h = createHash('sha256');
  const chunk = Buffer.alloc(1024 * 1024);
  for (let left = n; left > 0; left -= chunk.length) h.update(chunk.subarray(0, Math.min(chunk.length, left)));
  return h.digest('hex');
};
const GOOD = shaOfZeros(MIN_INSTALLER_BYTES + 1024);
const REQUEST = { url: URL_OK, sha256: GOOD, from: '0.1.4', to: '0.1.5' };

interface Over {
  bytes?: number;
  length?: string | null;
  ok?: boolean;
  platform?: string;
  execPath?: string;
  canWrite?: (dir: string) => boolean;
  /** 본문 대신 주는 스트림(멈춤·취소 시험용) */
  body?: ReadableStream<Uint8Array>;
  fetchThrows?: boolean;
  stallMs?: number;
}

function setup(over: Over = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'rauha-inst-'));
  dirs.push(tempDir);
  const bytes = over.bytes ?? MIN_INSTALLER_BYTES + 1024;
  const spawned: InstallPlan[] = [];
  const begun: unknown[] = [];
  const quit = vi.fn();
  const installer = createInstaller({
    platform: over.platform ?? 'darwin',
    execPath: over.execPath ?? '/Applications/Rauha.app/Contents/MacOS/Rauha',
    pid: 7,
    tempDir,
    home: '/Users/kim',
    canWrite: over.canWrite ?? (() => true),
    logPath: join(tempDir, 'logs', 'update-swap.log'),
    resultPath: join(tempDir, 'update-swap.result'),
    attempts: { begin: async (r) => void begun.push(r) },
    now: () => new Date('2026-11-09T00:00:00.000Z'),
    ...(over.stallMs === undefined ? {} : { stallMs: over.stallMs }),
    fetch: async (_url, signal) => {
      if (over.fetchThrows) throw new Error('offline');
      void signal;
      return { ok: over.ok ?? true, status: over.ok === false ? 404 : 200, headers: { get: () => (over.length === undefined ? String(bytes) : over.length) }, body: over.body ?? bodyOf(bytes) };
    },
    spawn: (p) => void spawned.push(p),
    quit,
  });
  return { tempDir, installer, spawned, begun, quit };
}

function hooks(over: Partial<InstallHooks> = {}) {
  const events: string[] = [];
  const progress: Array<number | null> = [];
  const h: InstallHooks = {
    signal: new AbortController().signal,
    onProgress: (p) => progress.push(p.percent),
    onStage: (s) => events.push(s),
    onInstalling: (i) => events.push(`installing:${i.target ?? ''}`),
    ...over,
  };
  return { h, events, progress };
}

const failure = async (p: Promise<unknown>): Promise<InstallFailure> => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(InstallFailure);
  return e as InstallFailure;
};

describe('앱 안 설치', () => {
  it('허용된 주소의 설치 파일을 받아 단계를 알리고, 설치 계획대로 따로 띄운 뒤 앱을 끈다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup();
    const { h, events, progress } = hooks();
    await t.installer.run(REQUEST, h);
    expect(progress.at(-1)).toBe(100);
    expect(events).toEqual(['verifying', 'preparing', 'installing:/Applications/Rauha.app']);
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]?.command).toBe('sh');
    expect(t.spawned[0]?.args.slice(3)).toEqual([join(t.tempDir, 'rauha-update', 'rauha-0.1.4-mac-arm64.dmg'), '/Applications/Rauha.app', '7', join(t.tempDir, 'logs', 'update-swap.log'), join(t.tempDir, 'update-swap.result')]);
    expect(t.begun).toEqual([{ from: '0.1.4', to: '0.1.5', target: '/Applications/Rauha.app', at: '2026-11-09T00:00:00.000Z', log: join(t.tempDir, 'logs', 'update-swap.log') }]);
    vi.advanceTimersByTime(500);
    expect(t.quit).toHaveBeenCalledOnce();
  });

  it('받은 바이트와 전체 바이트를 진행에 실어 보낸다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup();
    const seen: Array<{ received: number; total: number | null }> = [];
    await t.installer.run(REQUEST, hooks({ onProgress: (p) => seen.push({ received: p.received, total: p.total }) }).h);
    expect(seen.at(-1)).toEqual({ received: MIN_INSTALLER_BYTES + 1024, total: MIN_INSTALLER_BYTES + 1024 });
  });

  it('Downloads 같은 임시 위치에서 열린 맥 앱은 Applications에 설치하고 위치를 알린다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup({ execPath: '/private/var/folders/ab/T/AppTranslocation/X/d/Rauha.app/Contents/MacOS/Rauha' });
    const { h } = hooks();
    const notes: Array<string | null> = [];
    h.onInstalling = (i) => notes.push(i.note);
    await t.installer.run(REQUEST, h);
    expect(t.spawned[0]?.args[4]).toBe('/Applications/Rauha.app');
    expect(notes[0]).toContain('임시 위치');
  });

  it('/Applications에 쓸 수 없으면 사용자 Applications에 설치한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup({ execPath: '/Users/kim/Downloads/Rauha.app/Contents/MacOS/Rauha', canWrite: (d) => d === '/Users/kim/Applications' });
    await t.installer.run(REQUEST, hooks().h);
    expect(t.spawned[0]?.args[4]).toBe('/Users/kim/Applications/Rauha.app');
  });

  it('쓸 수 있는 설치 위치가 없으면 받은 파일을 지우고 설치하지 않는다', async () => {
    const t = setup({ canWrite: () => false });
    expect((await failure(t.installer.run(REQUEST, hooks().h))).code).toBe('target-unwritable');
    expect(readdirSync(join(t.tempDir, 'rauha-update'))).toEqual([]);
    expect(t.spawned).toHaveLength(0);
    expect(t.quit).not.toHaveBeenCalled();
  });

  it('Windows는 위치 정하기 없이 결과 파일을 남기는 설치 줄을 띄운다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup({ platform: 'win32', execPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Rauha\\Rauha.exe' });
    const { h, events } = hooks();
    await t.installer.run({ ...REQUEST, url: 'https://github.com/kimvudghk11/rauha/releases/download/v0.1.4/rauha-Setup-0.1.4-x64.exe' }, h);
    expect(events.at(-1)).toBe('installing:');
    expect(t.spawned[0]?.command).toBe('cmd.exe');
    expect(t.begun[0]).toMatchObject({ target: null });
  });

  it('허용되지 않은 주소는 받지 않는다', async () => {
    const t = setup();
    expect((await failure(t.installer.run({ ...REQUEST, url: 'https://evil.example/x.dmg' }, hooks().h))).code).toBe('bad-address');
    expect(readdirSync(t.tempDir)).toEqual([]);
    expect(t.spawned).toHaveLength(0);
  });

  it('너무 작은 파일이나 길이가 안 맞는 파일은 지우고 설치하지 않는다', async () => {
    const small = setup({ bytes: 1024 });
    expect((await failure(small.installer.run(REQUEST, hooks().h))).code).toBe('incomplete');
    expect(readdirSync(join(small.tempDir, 'rauha-update'))).toEqual([]);
    expect(small.spawned).toHaveLength(0);
    const cut = setup({ length: String(MIN_INSTALLER_BYTES * 2) });
    expect((await failure(cut.installer.run(REQUEST, hooks().h))).code).toBe('incomplete');
    expect(cut.spawned).toHaveLength(0);
    expect(cut.quit).not.toHaveBeenCalled();
  });

  it('서버가 오류를 주면 상태 번호와 함께 던진다', async () => {
    const t = setup({ ok: false });
    const e = await failure(t.installer.run(REQUEST, hooks().h));
    expect(e.code).toBe('http');
    expect(e.message).toMatch(/404/);
  });

  it('서버에 닿지 못하면 네트워크 실패다', async () => {
    const t = setup({ fetchThrows: true });
    expect((await failure(t.installer.run(REQUEST, hooks().h))).code).toBe('network');
  });

  it('맥 앱 폴더는 실행 파일 위로 세 단계다', () => {
    expect(macBundleOf('/Applications/Rauha.app/Contents/MacOS/Rauha')).toContain('Rauha.app');
  });

  it('내려받은 파일의 SHA-256이 릴리스가 알려 준 값과 다르면 지우고 설치하지 않는다', async () => {
    const t = setup();
    expect((await failure(t.installer.run({ ...REQUEST, sha256: 'b'.repeat(64) }, hooks().h))).code).toBe('checksum');
    expect(readdirSync(join(t.tempDir, 'rauha-update'))).toEqual([]);
    expect(t.spawned).toHaveLength(0);
    expect(t.quit).not.toHaveBeenCalled();
  });

  it('SHA-256 값이 없거나 모양이 틀리면 받지도 않는다', async () => {
    const t = setup();
    expect((await failure(t.installer.run({ ...REQUEST, sha256: '' }, hooks().h))).code).toBe('missing-checksum');
    expect(readdirSync(t.tempDir)).toEqual([]);
  });

  it('내려받는 도중 취소하면 받던 파일을 지우고 취소로 끝난다', async () => {
    const abort = new AbortController();
    // 첫 덩어리만 주고 멈춰 있는 스트림
    const stuck = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1024));
      },
    });
    const t = setup({ body: stuck });
    const run = t.installer.run(REQUEST, hooks({ signal: abort.signal, onProgress: () => abort.abort() }).h);
    expect((await failure(run)).code).toBe('cancelled');
    expect(readdirSync(join(t.tempDir, 'rauha-update'))).toEqual([]);
    expect(t.spawned).toHaveLength(0);
  });


  it('데이터가 한동안 안 오면 멈춘 것으로 보고 받던 파일을 지운다', async () => {
    const stuck = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1024));
      },
    });
    const t = setup({ body: stuck, stallMs: 80 });
    expect((await failure(t.installer.run(REQUEST, hooks().h))).code).toBe('stalled');
    expect(readdirSync(join(t.tempDir, 'rauha-update'))).toEqual([]);
  });

  it('멈춤 시간 기본값은 30초다', () => {
    expect(STALL_MS).toBe(30_000);
  });
});
