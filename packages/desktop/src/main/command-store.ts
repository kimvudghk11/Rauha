import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CommandBookDto, type CommandBookJson } from '../shared/command-dto.js';

/** 명령 모음(끈 기본 명령 + 내 명령)을 JSON 파일 하나에 둔다. 없거나 깨진 파일은 기본 상태로 연다. */
export class CommandStore {
  constructor(private readonly file: string) {}

  async load(): Promise<CommandBookJson> {
    try {
      return CommandBookDto.fromEntity(CommandBookDto.from(JSON.parse(await readFile(this.file, 'utf8'))).toEntity()).toJSON();
    } catch {
      return CommandBookDto.fromEntity(CommandBookDto.from({}).toEntity()).toJSON();
    }
  }

  /** 화면에서 온 값을 다듬어(깨진 항목 제외) 저장하고, 저장된 모양을 돌려준다. */
  async save(input: unknown): Promise<CommandBookJson> {
    const json = CommandBookDto.fromEntity(CommandBookDto.from(input).toEntity()).toJSON();
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(json, null, 2), 'utf8');
    return json;
  }
}
