import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../shared/settings.js';
import { JsonFile } from './data/json-file.js';

/**
 * 설정을 JSON 파일 하나에 둔다(이 PC에만). 없거나 깨진 파일은 기본값으로 연다(앱이 못 열리지 않게).
 * 깨진 파일은 덮어쓰기 전에 옆에 복사해 두고, 저장은 임시 파일 후 이름 바꾸기로 한다.
 */
export class SettingsStore {
  private readonly json: JsonFile;

  constructor(file: string) {
    this.json = new JsonFile(file);
  }

  async load(): Promise<Settings> {
    const read = await this.json.read();
    if (read.kind === 'ok') return parseSettings(read.value);
    if (read.kind === 'broken') await this.json.keepCopy(new Date().toISOString());
    return DEFAULT_SETTINGS;
  }

  async save(settings: Settings): Promise<void> {
    await this.json.write(settings);
  }
}
