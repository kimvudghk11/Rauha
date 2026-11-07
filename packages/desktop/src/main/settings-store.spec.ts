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
