import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstaller, macBundleOf, MIN_INSTALLER_BYTES } from './installer.js';
import type { InstallPlan } from '../../shared/update-install.js';

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

function setup(over: { bytes?: number; length?: string | null; ok?: boolean; platform?: string } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'rauha-inst-'));
  dirs.push(tempDir);
  const bytes = over.bytes ?? MIN_INSTALLER_BYTES + 1024;
  const spawned: InstallPlan[] = [];
  const quit = vi.fn();
  const installer = createInstaller({
    platform: over.platform ?? 'darwin',
    execPath: '/Applications/Rauha.app/Contents/MacOS/Rauha',
    pid: 7,
    tempDir,
    fetch: async () => ({ ok: over.ok ?? true, status: over.ok === false ? 404 : 200, headers: { get: () => (over.length === undefined ? String(bytes) : over.length) }, body: bodyOf(bytes) }),
    spawn: (p) => void spawned.push(p),
    quit,
  });
  return { tempDir, installer, spawned, quit };
}

describe('앱 안 설치', () => {
  it('허용된 주소의 설치 파일을 받아 설치 계획대로 따로 띄운 뒤 앱을 끈다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup();
    const progress: Array<number | null> = [];
    const installing = vi.fn();
    await t.installer.run(URL_OK, GOOD, (p) => progress.push(p), installing);
    expect(progress.at(-1)).toBe(100);
    expect(installing).toHaveBeenCalledOnce();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]?.command).toBe('sh');
    expect(t.spawned[0]?.args.slice(3)).toEqual([join(t.tempDir, 'rauha-update', 'rauha-0.1.4-mac-arm64.dmg'), resolve('/Applications/Rauha.app'), '7']);
    vi.advanceTimersByTime(500);
    expect(t.quit).toHaveBeenCalledOnce();
  });

  it('허용되지 않은 주소는 받지 않는다', async () => {
    const t = setup();
    await expect(t.installer.run('https://evil.example/x.dmg', GOOD, () => undefined, () => undefined)).rejects.toThrow();
    expect(readdirSync(t.tempDir)).toEqual([]);
    expect(t.spawned).toHaveLength(0);
  });

  it('너무 작은 파일이나 길이가 안 맞는 파일은 지우고 설치하지 않는다', async () => {
    const small = setup({ bytes: 1024 });
    await expect(small.installer.run(URL_OK, GOOD, () => undefined, () => undefined)).rejects.toThrow();
    expect(readdirSync(join(small.tempDir, 'rauha-update'))).toEqual([]);
    expect(small.spawned).toHaveLength(0);
    const cut = setup({ length: String(MIN_INSTALLER_BYTES * 2) });
    await expect(cut.installer.run(URL_OK, GOOD, () => undefined, () => undefined)).rejects.toThrow();
    expect(cut.spawned).toHaveLength(0);
    expect(cut.quit).not.toHaveBeenCalled();
  });

  it('서버가 오류를 주면 던진다', async () => {
    const t = setup({ ok: false });
    await expect(t.installer.run(URL_OK, GOOD, () => undefined, () => undefined)).rejects.toThrow(/404/);
  });

  it('맥 앱 폴더는 실행 파일 위로 세 단계다', () => {
    expect(macBundleOf('/Applications/Rauha.app/Contents/MacOS/Rauha')).toContain('Rauha.app');
  });

  it('내려받은 파일의 SHA-256이 릴리스가 알려 준 값과 다르면 지우고 설치하지 않는다', async () => {
    const t = setup();
    await expect(t.installer.run(URL_OK, 'b'.repeat(64), () => undefined, () => undefined)).rejects.toThrow(/checksum/);
    expect(readdirSync(join(t.tempDir, 'rauha-update'))).toEqual([]);
    expect(t.spawned).toHaveLength(0);
    expect(t.quit).not.toHaveBeenCalled();
  });

  it('SHA-256 값이 없거나 모양이 틀리면 받지도 않는다', async () => {
    const t = setup();
    await expect(t.installer.run(URL_OK, '', () => undefined, () => undefined)).rejects.toThrow(/checksum/);
    expect(readdirSync(t.tempDir)).toEqual([]);
  });
});
