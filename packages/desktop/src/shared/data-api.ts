import type { RecordBookJson, RecordResult } from './record-dto.js';
import type { TodoListJson, TodoResult } from './todo-dto.js';

/** 할 일·기록 탭이 main과 이야기하는 채널 */
export const DATA_IPC = {
  todoGet: 'todo:get',
  todoApply: 'todo:apply',
  /** main → 화면: 작업이 끝나서 할 일이 저절로 바뀌었다 */
  todoChanged: 'todo:changed',
  recordsGet: 'records:get',
  recordsApply: 'records:apply',
  /** main → 화면: 끝난 작업이 기록에 들어왔다 */
  recordsChanged: 'records:changed',
} as const;

/** 할 일 탭 API(window.rauha.todo). 요청은 main이 다시 검사한다. */
export interface TodoApi {
  get(): Promise<TodoListJson>;
  /** 더하기·고치기·옮기기·지우기·팀에 맡기기 */
  apply(op: unknown): Promise<TodoResult>;
  onChange(listener: (list: TodoListJson) => void): void;
}

/** 기록 탭 API(window.rauha.records) */
export interface RecordsApi {
  get(): Promise<RecordBookJson>;
  /** 태그 고치기·메모·지우기 */
  apply(op: unknown): Promise<RecordResult>;
  onChange(listener: (book: RecordBookJson) => void): void;
}
