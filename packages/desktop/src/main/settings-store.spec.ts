import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, updateSettings } from '../shared/settings.js';
import { SettingsStore } from './settings-store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-settings-'));
  dirs.push(d);
  return join(d, 'sub', 'settings.json');
};

describe('SettingsStore', () => {
  it('파일이 없으면 기본 설정이다', async () => {
    expect(await new SettingsStore(file()).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('저장한 설정을 다시 읽는다', async () => {
    const store = new SettingsStore(file());
    const next = updateSettings(DEFAULT_SETTINGS, { workFolder: 'C:/work', folderApproved: true, layout: 'B' });
    await store.save(next);
    expect(await store.load()).toEqual(next);
  });

  it('깨진 파일이어도 기본 설정으로 열린다', async () => {
    const path = file();
    const store = new SettingsStore(path);
    await store.save(DEFAULT_SETTINGS);
    writeFileSync(path, '{ 깨짐');
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SettingsStore 파일 손상·동시 쓰기', () => {
  it('저장을 한꺼번에 여러 번 해도 파일이 깨지지 않는다', async () => {
    const path = file();
    const store = new SettingsStore(path);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(updateSettings(DEFAULT_SETTINGS, { workFolder: `C:/work${i}` }))));
    expect((await store.load()).workFolder).toBe('C:/work19');
  });

  it('깨진 파일을 기본값으로 열 때 옆에 복사본을 남긴다(설정이 말없이 사라지지 않게)', async () => {
    const path = file();
    const store = new SettingsStore(path);
    await store.save(DEFAULT_SETTINGS);
    writeFileSync(path, '{ 깨짐');
    await store.load();
    const { readdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    expect(readdirSync(dirname(path)).some((n) => n.includes('.broken-'))).toBe(true);
  });
});
