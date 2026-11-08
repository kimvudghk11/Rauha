import { Columns } from './todo-columns.js';

/**
 * 옛 할 일 파일(version 1: 할 일·진행·완료 세 칸 고정, 항목마다 status 문자열)을
 * 새 구조(version 2: 칸 목록 + 항목마다 columnId)로 바꾸는 순수 함수들.
 * 옛 상태 이름(todo·doing·done)이 기본 칸의 번호와 같아서 columnId로 그대로 옮기면 된다.
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const LEGACY_STATUSES: readonly unknown[] = ['todo', 'doing', 'done'];

export function isLegacyTodoFile(raw: unknown): boolean {
  if (!isObject(raw) || !Array.isArray(raw['items'])) return false;
  return raw['version'] === undefined || raw['version'] === 1;
}

/** 새 구조의 "원본 모양" 값을 돌려준다(검사는 읽는 쪽 DTO가 한다). 입력은 바꾸지 않는다. */
export function migrateLegacyTodos(raw: unknown): unknown {
  const items = isObject(raw) && Array.isArray(raw['items']) ? (raw['items'] as unknown[]) : [];
  return {
    version: 2,
    columns: Columns.defaults().items.map((c) => ({ ...c })),
    items: items.map((item) => {
      if (!isObject(item)) return item;
      const { status, ...rest } = item;
      return LEGACY_STATUSES.includes(status) ? { ...rest, columnId: status, checklist: [], labels: [] } : { ...rest, checklist: [], labels: [] };
    }),
  };
}
