import type { DbResultSet } from '../shared/db-api.js';
import { cellClass, cellText } from '../shared/db-view-text.js';
import { el } from './dom.js';

/** 한 번에 그리는 행 수. 5천 행을 한꺼번에 그리면 화면이 멈추니 나눠서 보여 준다. */
const CHUNK = 300;

export interface TableOptions {
  /** 지금 정렬(열 머리에 ▲▼ 표시) */
  readonly sort?: { readonly column: string; readonly dir: 'asc' | 'desc' } | null;
  /** 열 머리를 눌렀을 때. 없으면 머리는 눌리지 않는다 */
  readonly onSort?: (column: string) => void;
}

/** 결과 표. 열 머리 고정, 칸은 한 줄로 줄이고(길면 …) 전체 글은 title 로 보인다. */
export function resultTable(r: DbResultSet, o: TableOptions = {}): HTMLElement {
  const wrap = el('div', 'db-scroll');
  if (r.columns.length === 0) return wrap;
  const table = el('table', 'tbl db-table');
  const head = el('thead');
  const hr = el('tr');
  for (const c of r.columns) {
    const th = el('th', o.onSort === undefined ? 'db-th' : 'db-th sortable');
    const mark = o.sort?.column === c ? (o.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    th.textContent = c + mark;
    th.title = o.onSort === undefined ? c : `Sort by ${c}`;
    if (o.sort?.column === c) th.setAttribute('aria-sort', o.sort.dir === 'asc' ? 'ascending' : 'descending');
    if (o.onSort !== undefined) {
      const onSort = o.onSort;
      th.addEventListener('click', () => onSort(c));
    }
    hr.append(th);
  }
  head.append(hr);
  const body = el('tbody');
  table.append(head, body);
  wrap.append(table);
  if (r.rows.length === 0) {
    wrap.append(el('div', 'hint db-none', 'No rows.'));
    return wrap;
  }
  let shown = 0;
  const more = el('button', 'btn sm db-more');
  more.type = 'button';
  const paint = (): void => {
    const end = Math.min(r.rows.length, shown + CHUNK);
    for (let i = shown; i < end; i += 1) {
      const tr = el('tr');
      for (const cell of r.rows[i]!) {
        const td = el('td', `db-cell ${cellClass(cell)}`);
        const text = cellText(cell);
        td.textContent = text;
        if (text.length > 24 || typeof cell === 'object') td.title = typeof cell === 'object' && cell !== null ? `${text} ${cell.preview}` : text;
        tr.append(td);
      }
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
