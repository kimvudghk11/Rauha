import type { TodoItem } from '../../domain/todo-ask.js';

/** 할 일 뽑기 보고 → 항목. 모양이 틀린 항목은 버린다(나머지는 쓴다). 근거 확인은 TodoAsk.keep 이 한다. */
export class TodoItemsDto {
  private constructor() {}

  static read(output: unknown): TodoItem[] {
    const o = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {};
    const list = Array.isArray(o['items']) ? o['items'] : [];
    return list.flatMap((x): TodoItem[] => {
      if (typeof x !== 'object' || x === null) return [];
      const i = x as Record<string, unknown>;
      if (typeof i['title'] !== 'string' || typeof i['quote'] !== 'string') return [];
      return [{ title: i['title'], note: typeof i['note'] === 'string' ? i['note'] : '', due: typeof i['due'] === 'string' ? i['due'] : null, quote: i['quote'] }];
    });
  }
}
