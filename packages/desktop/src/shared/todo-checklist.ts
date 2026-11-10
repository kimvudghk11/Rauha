import { reorder } from './todo-order.js';
/** 카드 안 체크리스트. 값은 불변이고, 바꾸는 메서드는 새 체크리스트를 돌려준다. */

export const CHECKLIST_MAX = 50;
export const CHECKLIST_TEXT_LIMIT = 120;

export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface ChecklistProgress {
  readonly done: number;
  readonly total: number;
  /** 0~100 정수(내림). 항목이 없으면 0 */
  readonly percent: number;
}

export class ChecklistError extends Error {}

function cleanText(text: string): string {
  const t = text.trim();
  if (t === '') throw new ChecklistError('The checklist item is empty.');
  if (t.length > CHECKLIST_TEXT_LIMIT) throw new ChecklistError(`A checklist item can be up to ${CHECKLIST_TEXT_LIMIT} characters.`);
  return t;
}

export class Checklist {
  private constructor(readonly items: readonly ChecklistItem[]) {}

  static empty(): Checklist {
    return new Checklist([]);
  }

  /** 저장 파일·화면 요청에서 다시 만든다. */
  static restore(items: readonly ChecklistItem[]): Checklist {
    if (items.length > CHECKLIST_MAX) throw new ChecklistError(`A checklist can have up to ${CHECKLIST_MAX} items.`);
    const seen = new Set<string>();
    const clean = items.map((i) => {
      if (i.id === '') throw new ChecklistError('A checklist item has no id.');
      if (seen.has(i.id)) throw new ChecklistError('Two checklist items share an id.');
      seen.add(i.id);
      return { id: i.id, text: cleanText(i.text), done: i.done };
    });
    return new Checklist(clean);
  }

  add(text: string, id: string): Checklist {
    if (this.items.length >= CHECKLIST_MAX) throw new ChecklistError(`A checklist can have up to ${CHECKLIST_MAX} items.`);
    return Checklist.restore([...this.items, { id, text, done: false }]);
  }

  /** afterId 항목 바로 뒤에 새 항목을 끼운다(null이면 맨 앞). Enter로 이어 쓸 때 쓴다. */
  addAfter(afterId: string | null, text: string, id: string): Checklist {
    if (this.items.length >= CHECKLIST_MAX) throw new ChecklistError(`A checklist can have up to ${CHECKLIST_MAX} items.`);
    if (afterId !== null) this.require(afterId);
    const at = afterId === null ? 0 : this.items.findIndex((i) => i.id === afterId) + 1;
    return Checklist.restore([...this.items.slice(0, at), { id, text, done: false }, ...this.items.slice(at)]);
  }

  /** id 항목을 beforeId 항목 앞(null이면 맨 끝)으로 옮긴다. */
  move(id: string, beforeId: string | null): Checklist {
    this.require(id);
    return new Checklist(reorder(this.items, id, beforeId));
  }

  toggle(id: string): Checklist {
    return this.change(id, (i) => ({ ...i, done: !i.done }));
  }

  rename(id: string, text: string): Checklist {
    return this.change(id, (i) => ({ ...i, text: cleanText(text) }));
  }

  remove(id: string): Checklist {
    this.require(id);
    return new Checklist(this.items.filter((i) => i.id !== id));
  }

  progress(): ChecklistProgress {
    const total = this.items.length;
    const done = this.items.filter((i) => i.done).length;
    return { done, total, percent: total === 0 ? 0 : Math.floor((done * 100) / total) };
  }

  private require(id: string): ChecklistItem {
    const found = this.items.find((i) => i.id === id);
    if (found === undefined) throw new ChecklistError('That item was not found.');
    return found;
  }

  private change(id: string, fn: (i: ChecklistItem) => ChecklistItem): Checklist {
    const found = this.require(id);
    return new Checklist(this.items.map((i) => (i === found ? fn(i) : i)));
  }
}
