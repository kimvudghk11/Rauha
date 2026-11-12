import type { DbResultSet } from '../shared/db-api.js';
import type { DbCell } from '../shared/db-csv.js';
import { cellClass, cellText } from '../shared/db-view-text.js';
import { el } from './dom.js';

/** 한 번에 그리는 행 수. 5천 행을 한꺼번에 그리면 화면이 멈추니 나눠서 보여 준다. */
const CHUNK = 300;
/** 열 너비 조절 한계(px) */
const COL_MIN = 48;
const COL_MAX = 1200;

/** 고른 칸 */
export interface PickedCell {
  readonly row: number;
  readonly col: number;
  readonly column: string;
  readonly cell: DbCell;
  readonly values: readonly DbCell[];
}

export interface TableOptions {
  /** 지금 정렬(열 머리에 ▲▼ 표시) */
  readonly sort?: { readonly column: string; readonly dir: 'asc' | 'desc' } | null;
  /** 열 머리를 눌렀을 때. 없으면 머리는 눌리지 않는다 */
  readonly onSort?: (column: string) => void;
  /** 행 번호 첫 값(행 보기의 쪽에 맞춰). 없으면 1 */
  readonly firstRowNumber?: number;
  /** 칸을 눌러 골랐을 때(상세 보기·복사) */
  readonly onPick?: (picked: PickedCell) => void;
  /** 칸을 두 번 눌렀을 때(상세 보기 열기) */
  readonly onOpen?: (picked: PickedCell) => void;
}

/**
 * 결과 표(TablePlus·DataGrip 처럼 촘촘하게). 열 머리 고정, 왼쪽에 행 번호, 칸은 한 줄로 줄이고(길면 …) 눌러서 고르면 상세 보기로 전체 글을 본다.
 * 열 머리 오른쪽 끝을 끌면 그 열 너비가 바뀐다(두 번 누르면 원래대로).
 */
export function resultTable(r: DbResultSet, o: TableOptions = {}): HTMLElement {
  const wrap = el('div', 'db-scroll');
  if (r.columns.length === 0) return wrap;
  const table = el('table', 'tbl db-table');
  const head = el('thead');
  const hr = el('tr');
  hr.append(el('th', 'db-th db-rownum', '#'));
  const widths = new Map<number, number>();
  const ths: HTMLTableCellElement[] = [];
  r.columns.forEach((c, col) => {
    const th = el('th', o.onSort === undefined ? 'db-th' : 'db-th sortable');
    const mark = o.sort?.column === c ? (o.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    th.append(el('span', 'db-th-name', c + mark));
    th.title = o.onSort === undefined ? c : `${c} — click to sort`;
    if (o.sort?.column === c) th.setAttribute('aria-sort', o.sort.dir === 'asc' ? 'ascending' : 'descending');
    if (o.onSort !== undefined) {
      const onSort = o.onSort;
      th.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('db-resize')) return;
        onSort(c);
      });
    }
    const grip = el('span', 'db-resize');
    grip.title = 'Drag to resize · double-click to reset';
    grip.addEventListener('click', (e) => e.stopPropagation());
    grip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      widths.delete(col);
      applyWidth(col, null);
    });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      grip.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        const w = Math.round(Math.min(COL_MAX, Math.max(COL_MIN, startW + ev.clientX - startX)));
        widths.set(col, w);
        setWidth(th, w);
      };
      const up = (): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        applyWidth(col, widths.get(col) ?? null);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    th.append(grip);
    ths.push(th);
    hr.append(th);
  });
  head.append(hr);
  const body = el('tbody');
  table.append(head, body);
  wrap.append(table);

  /** 열 하나의 너비를 머리와 그려 둔 칸 모두에 입힌다(null 이면 원래대로) */
  function applyWidth(col: number, w: number | null): void {
    setWidth(ths[col]!, w);
    for (const tr of body.rows) {
      const td = tr.cells[col + 1];
      if (td !== undefined) setWidth(td, w);
    }
  }

  if (r.rows.length === 0) {
    wrap.append(el('div', 'hint db-none', 'No rows.'));
    return wrap;
  }
  const first = o.firstRowNumber ?? 1;
  let picked: HTMLElement | null = null;
  const pickAt = (td: HTMLTableCellElement): PickedCell | null => {
    const tr = td.parentElement as HTMLTableRowElement | null;
    const row = Number(tr?.dataset['row']);
    const col = td.cellIndex - 1;
    const values = r.rows[row];
    if (values === undefined || col < 0 || col >= r.columns.length) return null;
    return { row, col, column: r.columns[col]!, cell: values[col] ?? null, values };
  };
  body.addEventListener('click', (e) => {
    const td = (e.target as HTMLElement).closest('td');
    if (td === null || o.onPick === undefined) return;
    const p = pickAt(td);
    if (p === null) return;
    picked?.classList.remove('picked');
    picked = td;
    td.classList.add('picked');
    o.onPick(p);
  });
  body.addEventListener('dblclick', (e) => {
    const td = (e.target as HTMLElement).closest('td');
    const p = td === null ? null : pickAt(td);
    if (p !== null) o.onOpen?.(p);
  });

  let shown = 0;
  const more = el('button', 'btn sm db-more');
  more.type = 'button';
  const paint = (): void => {
    const end = Math.min(r.rows.length, shown + CHUNK);
    for (let i = shown; i < end; i += 1) {
      const tr = el('tr');
      tr.dataset['row'] = String(i);
      tr.append(el('td', 'db-cell db-rownum', String(first + i)));
      r.rows[i]!.forEach((cell, col) => {
        const td = el('td', `db-cell ${cellClass(cell)}`);
        const text = cellText(cell);
        td.textContent = text.length > 300 ? `${text.slice(0, 300)}…` : text;
        if (text.length > 24 || typeof cell === 'object') td.title = typeof cell === 'object' && cell !== null ? `${text} ${cell.preview}` : text.slice(0, 2000);
        const w = widths.get(col);
        if (w !== undefined) setWidth(td, w);
        tr.append(td);
      });
      body.append(tr);
    }
    shown = end;
    const left = r.rows.length - shown;
    more.hidden = left <= 0;
    more.textContent = `Show ${Math.min(CHUNK, left).toLocaleString('en-US')} more rows (${left.toLocaleString('en-US')} left)`;
  };
  more.addEventListener('click', paint);
  paint();
  wrap.append(more);
  return wrap;
}

function setWidth(node: HTMLElement, w: number | null): void {
  const v = w === null ? '' : `${w}px`;
  node.style.width = v;
  node.style.minWidth = v;
  node.style.maxWidth = v;
}
