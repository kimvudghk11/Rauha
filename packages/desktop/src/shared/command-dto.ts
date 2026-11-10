import { Command, CommandBook, CommandError } from './command-book.js';

/** 저장 파일·화면에서 오가는 명령 모음. 기본 명령 본문은 코드에 있어서 끈 것(id)과 내 명령만 담는다. */
export interface CommandBookJson {
  readonly custom: readonly { readonly id: string; readonly name: string; readonly description: string; readonly template: string }[];
  readonly disabled: readonly string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 바깥 입력 ↔ CommandBook. 깨진 항목은 건너뛰고 나머지로 연다(저장 파일 하나 때문에 명령이 다 사라지지 않게). */
export class CommandBookDto {
  private constructor(readonly json: CommandBookJson) {}

  static from(input: unknown): CommandBookDto {
    const o = isObject(input) ? input : {};
    const custom: CommandBookJson['custom'][number][] = [];
    for (const item of Array.isArray(o['custom']) ? o['custom'] : []) {
      if (!isObject(item) || str(item['id']) === '') continue;
      custom.push({ id: str(item['id']), name: str(item['name']), description: str(item['description']), template: str(item['template']) });
    }
    const disabled = Array.isArray(o['disabled']) ? o['disabled'].filter((d): d is string => typeof d === 'string') : [];
    return new CommandBookDto({ custom, disabled });
  }

  static fromEntity(book: CommandBook): CommandBookDto {
    return new CommandBookDto({
      custom: book.customCommands.map((c) => ({ id: c.id, name: c.name, description: c.description, template: c.action.kind === 'prompt' ? c.action.template : '' })),
      disabled: book.disabledIds,
    });
  }

  toEntity(): CommandBook {
    const commands: Command[] = [];
    for (const c of this.json.custom) {
      try {
        commands.push(Command.create({ id: c.id, name: c.name, description: c.description, detail: '', group: 'My commands', action: { kind: 'prompt', template: c.template }, builtin: false }));
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
      }
    }
    return CommandBook.restore(commands, this.json.disabled);
  }

  toJSON(): CommandBookJson {
    return this.json;
  }
}
