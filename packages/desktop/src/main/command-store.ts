import { CommandBookDto, type CommandBookJson } from '../shared/command-dto.js';
import { JsonFile } from './data/json-file.js';

/** 명령 모음(끈 기본 명령 + 내 명령)을 JSON 파일 하나에 둔다. 없거나 깨진 파일은 기본 상태로 연다(깨진 파일은 복사해 둔다). */
export class CommandStore {
  private readonly json: JsonFile;

  constructor(file: string) {
    this.json = new JsonFile(file);
  }

  async load(): Promise<CommandBookJson> {
    const read = await this.json.read();
    if (read.kind === 'broken') await this.json.keepCopy(new Date().toISOString());
    try {
      return CommandBookDto.fromEntity(CommandBookDto.from(read.kind === 'ok' ? read.value : {}).toEntity()).toJSON();
    } catch {
      return CommandBookDto.fromEntity(CommandBookDto.from({}).toEntity()).toJSON();
    }
  }

  /** 화면에서 온 값을 다듬어(깨진 항목 제외) 저장하고, 저장된 모양을 돌려준다. */
  async save(input: unknown): Promise<CommandBookJson> {
    const json = CommandBookDto.fromEntity(CommandBookDto.from(input).toEntity()).toJSON();
    await this.json.write(json);
    return json;
  }
}
