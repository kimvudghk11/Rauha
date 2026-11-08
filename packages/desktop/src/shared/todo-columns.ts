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
}

export function isColumnColor(v: unknown): v is ColumnColor {
  return typeof v === 'string' && (COLUMN_COLORS as readonly string[]).includes(v);
}

function cleanName(name: string): string {
  const n = name.trim();
  if (n === '') throw new TodoColumnError('칸 이름을 적어 주세요.');
  if (n.length > COLUMN_NAME_LIMIT) throw new TodoColumnError(`칸 이름은 ${COLUMN_NAME_LIMIT}자까지예요.`);
  return n;
}

function checkedColor(color: ColumnColor): ColumnColor {
  if (!isColumnColor(color)) throw new TodoColumnError('고를 수 없는 색이에요.');
  return color;
}

/** 보드의 칸 모음. 값은 불변이고, 바꾸는 메서드는 새 모음을 돌려준다. */
export class Columns {
  private constructor(readonly items: readonly Column[]) {}

  static defaults(): Columns {
    return new Columns([
      { id: 'todo', name: '할 일', color: 'gray', done: false, work: false, collapsed: false },
      { id: 'doing', name: '진행 중', color: 'blue', done: false, work: true, collapsed: false },
      { id: 'done', name: '완료', color: 'green', done: true, work: false, collapsed: false },
    ]);
  }

  static restore(items: readonly Column[]): Columns {
    if (items.length === 0) throw new TodoColumnError('칸이 한 칸은 있어야 해요.');
    if (items.length > COLUMN_MAX) throw new TodoColumnError(`칸은 ${COLUMN_MAX}개까지예요.`);
    const seen = new Set<string>();
    let works = 0;
    const clean = items.map((k) => {
      if (k.id === '') throw new TodoColumnError('칸 번호가 없어요.');
      if (seen.has(k.id)) throw new TodoColumnError('칸 번호가 겹쳐요.');
      seen.add(k.id);
      if (k.work) works += 1;
      return { id: k.id, name: cleanName(k.name), color: checkedColor(k.color), done: k.done, work: k.work, collapsed: k.collapsed };
    });
    if (works > 1) throw new TodoColumnError('팀이 일하는 칸은 하나만 둘 수 있어요.');
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

  firstDone(): Column | null {
    return this.items.find((k) => k.done) ?? null;
  }

  /** 새 카드가 들어가는 칸: 완료 칸이 아닌 첫 칸(모두 완료 칸이면 첫 칸) */
  entry(): Column {
    return this.items.find((k) => !k.done) ?? this.items[0]!;
  }

  add(name: string, color: ColumnColor, id: string): Columns {
    if (this.items.length >= COLUMN_MAX) throw new TodoColumnError(`칸은 ${COLUMN_MAX}개까지예요.`);
    return Columns.restore([...this.items, { id, name, color, done: false, work: false, collapsed: false }]);
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
    if (at === -1) throw new TodoColumnError('그 칸을 찾지 못했어요.');
    if (this.items.length === 1) throw new TodoColumnError('마지막 한 칸은 지울 수 없어요.');
    return this.items[at === 0 ? 1 : at - 1]!.id;
  }

  remove(id: string): Columns {
    this.landingFor(id);
    return new Columns(this.items.filter((k) => k.id !== id));
  }

  private require(id: string): Column {
    const found = this.get(id);
    if (found === null) throw new TodoColumnError('그 칸을 찾지 못했어요.');
    return found;
  }

  private change(id: string, fn: (k: Column) => Column): Columns {
    const found = this.require(id);
    return new Columns(this.items.map((k) => (k === found ? fn(k) : k)));
  }
}
