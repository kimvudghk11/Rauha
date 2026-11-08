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
  if (t === '') throw new ChecklistError('체크리스트 항목이 비어 있어요.');
  if (t.length > CHECKLIST_TEXT_LIMIT) throw new ChecklistError(`체크리스트 항목은 ${CHECKLIST_TEXT_LIMIT}자까지예요.`);
  return t;
}

export class Checklist {
  private constructor(readonly items: readonly ChecklistItem[]) {}

  static empty(): Checklist {
    return new Checklist([]);
  }

  /** 저장 파일·화면 요청에서 다시 만든다. */
  static restore(items: readonly ChecklistItem[]): Checklist {
    if (items.length > CHECKLIST_MAX) throw new ChecklistError(`체크리스트는 ${CHECKLIST_MAX}개까지예요.`);
    const seen = new Set<string>();
    const clean = items.map((i) => {
      if (i.id === '') throw new ChecklistError('체크리스트 항목 번호가 없어요.');
      if (seen.has(i.id)) throw new ChecklistError('체크리스트 항목 번호가 겹쳐요.');
      seen.add(i.id);
      return { id: i.id, text: cleanText(i.text), done: i.done };
    });
    return new Checklist(clean);
  }

  add(text: string, id: string): Checklist {
    if (this.items.length >= CHECKLIST_MAX) throw new ChecklistError(`체크리스트는 ${CHECKLIST_MAX}개까지예요.`);
    return Checklist.restore([...this.items, { id, text, done: false }]);
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
    if (found === undefined) throw new ChecklistError('그 항목을 찾지 못했어요.');
    return found;
  }

  private change(id: string, fn: (i: ChecklistItem) => ChecklistItem): Checklist {
    const found = this.require(id);
    return new Checklist(this.items.map((i) => (i === found ? fn(i) : i)));
  }
}
