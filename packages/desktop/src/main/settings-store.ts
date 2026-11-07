import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../shared/settings.js';

/** 설정을 JSON 파일 하나에 둔다(이 PC에만). 없거나 깨진 파일은 기본값으로 연다(앱이 못 열리지 않게). */
export class SettingsStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      return parseSettings(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: Settings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings, null, 2), 'utf8');
  }
}
