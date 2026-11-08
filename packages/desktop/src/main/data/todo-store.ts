import { TodoListDto, type TodoListJson } from '../../shared/todo-dto.js';
import { TodoList } from '../../shared/todo-list.js';
import { isLegacyTodoFile } from '../../shared/todo-migrate.js';
import { JsonFile } from './json-file.js';

/** 할 일 모음을 앱 데이터 폴더의 JSON 파일 하나에 둔다. */
export interface TodoStorePort {
  load(): Promise<TodoList>;
  save(list: TodoList): Promise<void>;
}

export class TodoStore implements TodoStorePort {
  private readonly json: JsonFile;
  constructor(file: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.json = new JsonFile(file);
  }

  /** 없으면 빈 모음. 깨졌거나 일부 항목이 깨졌으면 원본을 옆에 복사해 두고 읽을 수 있는 만큼 연다. */
  async load(): Promise<TodoList> {
    const read = await this.json.read();
    if (read.kind === 'missing') return TodoList.empty();
    if (read.kind === 'broken') {
      await this.json.keepCopy(this.now());
      return TodoList.empty();
    }
    const dto = TodoListDto.from(read.value);
    if (dto.skipped > 0) await this.json.keepCopy(this.now());
    if (isLegacyTodoFile(read.value)) {
      // 세 칸 고정 파일은 새 구조로 바꿔 쓰기 전에 원본을 todos.json.bak-<시각>으로 남긴다. 복사가 안 되면 바꿔 쓰지 않는다(다음에 다시 시도).
      const copy = await this.json.keepCopy(this.now(), 'bak');
      if (copy !== null) await this.json.write(dto.toJSON());
    }
    return dto.toEntity();
  }

  async save(list: TodoList): Promise<void> {
    await this.json.write(TodoListDto.fromEntity(list).toJSON() satisfies TodoListJson);
  }
}
