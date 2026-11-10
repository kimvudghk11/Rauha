import { COLUMN_COLORS, type ColumnColor } from '../shared/todo-columns.js';
import type { TodoResult } from '../shared/todo-dto.js';
import type { Label, Todo, TodoFilter, TodoList, TodoPriority } from '../shared/todo-list.js';
import { el } from './dom.js';

/** 할 일 화면 조각들이 함께 쓰는 것: 이름표, 요청 보내기, 팝업 메뉴, 확인 창 */

export const PRIORITY_LABEL: Readonly<Record<TodoPriority, string>> = { high: '높음', normal: '보통', low: '낮음' };
export const COLOR_LABEL: Readonly<Record<ColumnColor, string>> = { gray: '회색', blue: '파랑', green: '초록', yellow: '노랑', red: '빨강', purple: '보라' };

export const NO_FILTER: TodoFilter = { column: 'all', priority: 'all', repo: null, team: null, label: null, text: '', overdueOnly: false };

/** 화면 조각이 보드를 읽고 요청을 보내는 창구 */
export interface TodoCtx {
  board(): TodoList;
  filter(): TodoFilter;
  today(): string;
  /** 레포 이름들(알려진 것 + 카드에 적힌 것) */
  repos(): readonly string[];
  /** main에 요청 하나를 보낸다. 실패하면 안내 줄에 이유를 띄우고 그 결과를 돌려준다. */
  act(op: unknown): Promise<TodoResult>;
  /** 카드 창(가운데 모달)을 연다 */
  open(id: string): void;
  openJob(jobId: string): void;
  /** 칸의 "+ 새로 만들기" 입력을 연다(top이면 칸 맨 위에 넣는 입력) */
  quickAdd(columnId: string, top?: boolean): void;
}

export function chipOf(text: string, cls = ''): HTMLElement {
  return el('span', `chip ${cls}`.trim(), text);
}

export function labelChip(label: Label): HTMLElement {
  return chipOf(label.name, label.color === 'gray' ? '' : label.color);
}

export function dot(color: ColumnColor): HTMLElement {
  return el('span', `dot ${color}`);
}

/** 마감 표시: 기한 지남(빨강) · 오늘까지(노랑) · 그 밖에는 날짜만 */
export function dueText(board: TodoList, todo: Todo, today: string): { text: string; cls: string } | null {
  if (todo.due === null) return null;
  if (board.isOverdue(todo, today)) return { text: `기한 지남 · ${todo.due.slice(5)}`, cls: 'red' };
  if (!board.isDone(todo) && todo.due === today) return { text: '오늘까지', cls: 'yellow' };
  return { text: `~ ${todo.due.slice(5)}`, cls: '' };
}

/** 진행 막대(체크리스트 등). percent는 0~100 */
export function meter(percent: number): HTMLElement {
  const bar = el('span', 'meter');
  const fill = el('i');
  fill.style.width = `${percent}%`;
  bar.append(fill);
  return bar;
}

export function ymd(iso: string): string {
  return iso.slice(0, 10);
}

export function select<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void, cls?: string): HTMLSelectElement {
  const s = el('select', cls);
  for (const [v, label] of options) {
    const o = el('option', undefined, label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// ── 팝업 메뉴 ──

export type MenuItem =
  | { readonly label: string; readonly pick: () => void; readonly danger?: boolean; readonly checked?: boolean; readonly dot?: ColumnColor; readonly disabled?: boolean }
  | { readonly heading: string }
  | 'sep';

let closeMenu: (() => void) | null = null;

/** 기준 요소 아래에 메뉴를 연다. 바깥을 누르거나 Esc를 누르면 닫힌다. 한 번에 하나만 열린다. */
export function showMenu(anchor: HTMLElement | { readonly x: number; readonly y: number }, items: readonly MenuItem[]): HTMLElement {
  closeMenu?.();
  const menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'sep') {
      menu.append(el('div', 'sep'));
    } else if ('heading' in item) {
      menu.append(el('div', 'lbl', item.heading));
    } else {
      const b = el('button', item.danger === true ? 'danger' : undefined);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.disabled = item.disabled === true;
      if (item.dot !== undefined) b.append(dot(item.dot));
      b.append(el('span', 'grow', item.label));
      if (item.checked === true) b.append(el('span', undefined, '✓'));
      b.addEventListener('click', () => {
        close();
        item.pick();
      });
      menu.append(b);
    }
  }
  const onDown = (e: Event): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // 메뉴만 닫는다(뒤에 열린 카드 창까지 같이 닫히지 않게)
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  function close(): void {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (closeMenu === close) closeMenu = null;
  }
  closeMenu = close;
  document.body.append(menu);
  const a = 'x' in anchor ? { left: anchor.x, top: anchor.y, bottom: anchor.y } : anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(a.left, window.innerWidth - w - 4))}px`;
  menu.style.top = `${a.bottom + h + 8 > window.innerHeight ? Math.max(4, a.top - h - 2) : a.bottom + 2}px`;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  menu.querySelector('button')?.focus();
  return menu;
}

/** 색 고르기 메뉴 항목들 */
export function colorItems(current: ColumnColor, pick: (c: ColumnColor) => void): MenuItem[] {
  return COLUMN_COLORS.map((c) => ({ label: COLOR_LABEL[c], dot: c, checked: c === current, pick: () => pick(c) }));
}

// ── 확인 창 ──

export interface ConfirmChoice {
  readonly label: string;
  readonly cls: string;
  readonly pick: () => void;
}

/** 가운데 확인 창. 취소는 늘 마지막에 붙는다. */
export function confirmDialog(title: string, body: string, choices: readonly ConfirmChoice[], extra?: HTMLElement): void {
  const veil = el('div', 'veil');
  const box = el('div', 'dialog');
  const close = (): void => {
    veil.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const buttons = el('div', 'btns end');
  for (const c of choices) buttons.append(button(c.label, c.cls, () => (close(), c.pick())));
  buttons.append(button('취소', 'btn', close));
  box.append(el('b', undefined, title), el('div', 'dim', body), ...(extra === undefined ? [] : [extra]), buttons);
  veil.append(box);
  veil.addEventListener('pointerdown', (e) => {
    if (e.target === veil) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  box.querySelector('button')?.focus();
}
