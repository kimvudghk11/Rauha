import { reorder } from './todo-order.js';

/** 칸과 라벨이 함께 쓰는 색 이름. 실제 색은 ui.css가 정한다. */
export const COLUMN_COLORS = ['gray', 'blue', 'green', 'yellow', 'red', 'purple'] as const;
export type ColumnColor = (typeof COLUMN_COLORS)[number];

export const COLUMN_MAX = 12;
export const COLUMN_NAME_LIMIT = 30;

export class TodoColumnError extends Error {}

export interface Column {
  readonly id: string;
  readonly name: string;
  readonly color: ColumnColor;
  /** "완료로 취급": 여기 있는 카드는 끝난 것으로 본다(기한 지남 표시 없음, 끝낸 시각이 남는다) */
  readonly done: boolean;
  /** 팀에 맡기면 카드가 가는 칸(하나만) */
  readonly work: boolean;
  readonly collapsed: boolean;
  /** 보드에서 숨김(카드는 그대로 남는다). 맨 오른쪽 "숨긴 칸"에서 다시 꺼낸다. 보이는 칸은 늘 하나 이상 */
  readonly hidden: boolean;
}

/** 저장 파일에는 hidden이 없을 수 있다(옛 파일) */
export type ColumnInput = Omit<Column, 'hidden'> & { readonly hidden?: boolean };

export function isColumnColor(v: unknown): v is ColumnColor {
  return typeof v === 'string' && (COLUMN_COLORS as readonly string[]).includes(v);
}

function cleanName(name: string): string {
  const n = name.trim();
  if (n === '') throw new TodoColumnError('Please enter a column name.');
  if (n.length > COLUMN_NAME_LIMIT) throw new TodoColumnError(`A column name can be up to ${COLUMN_NAME_LIMIT} characters.`);
  return n;
}

function checkedColor(color: ColumnColor): ColumnColor {
  if (!isColumnColor(color)) throw new TodoColumnError('That color is not available.');
  return color;
}

/** 보드의 칸 모음. 값은 불변이고, 바꾸는 메서드는 새 모음을 돌려준다. */
export class Columns {
  private constructor(readonly items: readonly Column[]) {}

  static defaults(): Columns {
    return new Columns([
      { id: 'todo', name: '할 일', color: 'gray', done: false, work: false, collapsed: false, hidden: false },
      { id: 'doing', name: '진행 중', color: 'blue', done: false, work: true, collapsed: false, hidden: false },
      { id: 'done', name: '완료', color: 'green', done: true, work: false, collapsed: false, hidden: false },
    ]);
  }

  static restore(items: readonly ColumnInput[]): Columns {
    if (items.length === 0) throw new TodoColumnError('There must be at least one column.');
    if (items.length > COLUMN_MAX) throw new TodoColumnError(`Up to ${COLUMN_MAX} columns.`);
    const seen = new Set<string>();
    let works = 0;
    const clean = items.map((k) => {
      if (k.id === '') throw new TodoColumnError('A column has no id.');
      if (seen.has(k.id)) throw new TodoColumnError('Two columns share an id.');
      seen.add(k.id);
      if (k.work) works += 1;
      return { id: k.id, name: cleanName(k.name), color: checkedColor(k.color), done: k.done, work: k.work, collapsed: k.collapsed, hidden: k.hidden === true };
    });
    if (works > 1) throw new TodoColumnError('Only one column can be the team column.');
    // 파일에서 모두 숨겨져 있으면 첫 칸을 다시 보이게 한다(칸이 사라져 보이는 것을 막는다)
    if (clean.every((k) => k.hidden)) clean[0] = { ...clean[0]!, hidden: false };
    return new Columns(clean);
  }

  get(id: string): Column | null {
    return this.items.find((k) => k.id === id) ?? null;
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  isDone(id: string): boolean {
    return this.get(id)?.done === true;
  }

  work(): Column | null {
    return this.items.find((k) => k.work) ?? null;
  }

  /** 보드에 보이는 칸들(숨긴 칸 빼고) */
  visible(): readonly Column[] {
    return this.items.filter((k) => !k.hidden);
  }

  firstDone(): Column | null {
    return this.items.find((k) => k.done) ?? null;
  }

  /** 새 카드가 들어가는 칸: 보이는 칸 중 완료 칸이 아닌 첫 칸(없으면 완료 아닌 첫 칸, 그것도 없으면 첫 칸) */
  entry(): Column {
    return this.items.find((k) => !k.done && !k.hidden) ?? this.items.find((k) => !k.done) ?? this.items[0]!;
  }

  add(name: string, color: ColumnColor, id: string): Columns {
    if (this.items.length >= COLUMN_MAX) throw new TodoColumnError(`Up to ${COLUMN_MAX} columns.`);
    return Columns.restore([...this.items, { id, name, color, done: false, work: false, collapsed: false, hidden: false }]);
  }

  rename(id: string, name: string): Columns {
    return this.change(id, (k) => ({ ...k, name: cleanName(name) }));
  }

  recolor(id: string, color: ColumnColor): Columns {
    return this.change(id, (k) => ({ ...k, color: checkedColor(color) }));
  }

  setDone(id: string, done: boolean): Columns {
    return this.change(id, (k) => ({ ...k, done }));
  }

  /** work를 켜면 다른 칸의 것은 꺼진다 */
  setWork(id: string, work: boolean): Columns {
    this.require(id);
    return new Columns(this.items.map((k) => (k.id === id ? { ...k, work } : work ? { ...k, work: false } : k)));
  }

  /** 숨기거나 다시 보이게 한다. 보이는 칸이 하나도 안 남게는 못 숨긴다. */
  hide(id: string, hidden: boolean): Columns {
    const found = this.require(id);
    if (hidden && !found.hidden && this.visible().length <= 1) throw new TodoColumnError('At least one column must stay visible.');
    return this.change(id, (k) => ({ ...k, hidden }));
  }

  collapse(id: string, collapsed: boolean): Columns {
    return this.change(id, (k) => ({ ...k, collapsed }));
  }

  /** beforeId 칸 앞(null이면 맨 끝)으로 옮긴다 */
  move(id: string, beforeId: string | null): Columns {
    this.require(id);
    if (beforeId !== null) this.require(beforeId);
    return new Columns(reorder(this.items, id, beforeId));
  }

  /** 칸을 지울 때 카드가 가는 칸: 앞 칸, 첫 칸이면 다음 칸 */
  landingFor(id: string): string {
    const at = this.items.findIndex((k) => k.id === id);
    if (at === -1) throw new TodoColumnError('That column was not found.');
    if (this.items.length === 1) throw new TodoColumnError('The last column cannot be deleted.');
    return this.items[at === 0 ? 1 : at - 1]!.id;
  }

  remove(id: string): Columns {
    this.landingFor(id);
    return new Columns(this.items.filter((k) => k.id !== id));
  }

  private require(id: string): Column {
    const found = this.get(id);
    if (found === null) throw new TodoColumnError('That column was not found.');
    return found;
  }

  private change(id: string, fn: (k: Column) => Column): Columns {
    const found = this.require(id);
    return new Columns(this.items.map((k) => (k === found ? fn(k) : k)));
  }
}
