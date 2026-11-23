import type { NotebookJson } from './rauha-notebook.js';

/** rauha 노트(기억·항상 룰) IPC */
export const NOTEBOOK_IPC = {
  get: 'notebook:get',
  forget: 'notebook:forget',
  /** main → 화면: 채팅에서 기억·룰이 더해졌다 */
  changed: 'notebook:changed',
} as const;

/** 규칙 탭에서 보고 지우는 API(window.rauha.notebook). 더하는 건 채팅의 Claude 가 한다 */
export interface NotebookApi {
  get(): Promise<NotebookJson>;
  forget(id: string): Promise<NotebookJson>;
  onChange(listener: (book: NotebookJson) => void): void;
}
