import { TEAM_CHOICES, type TodoSort } from '../shared/todo-list.js';
import { el } from './dom.js';
import { PRIORITY_LABEL, chipOf, dot, dueText, labelChip, ymd, type TodoCtx } from './todo-parts.js';

export interface TableView {
  readonly root: HTMLElement;
  render(sort: TodoSort): void;
}

const HEADS = ['제목', '칸', '우선순위', '마감', '라벨', '레포·팀', '체크리스트', '만든 날'] as const;

/** 목록 보기: 보드와 같은 데이터를 표로 보여 준다. 줄을 누르면 카드 상세가 열린다. */
export function buildTable(ctx: TodoCtx): TableView {
  const root = el('div', 'ttable');

  function render(sort: TodoSort): void {
    const board = ctx.board();
    const today = ctx.today();
    const rows = board.view(ctx.filter(), sort, today);
    root.replaceChildren();
    if (rows.length === 0) {
      root.append(el('div', 'tempty', board.items.length === 0 ? '카드가 없어요' : '걸러진 카드가 없어요. 검색·필터를 바꿔 보세요.'));
      return;
    }
    const table = el('table', 'tbl');
    const head = el('tr');
    for (const h of HEADS) head.append(el('th', undefined, h));
    const thead = el('thead');
    thead.append(head);
    table.append(thead);
    const body = el('tbody');
    for (const todo of rows) {
      const tr = el('tr', `trow${board.isDone(todo) ? ' done' : ''}`);
      tr.dataset['id'] = todo.id;
      tr.tabIndex = 0;
      tr.addEventListener('click', () => ctx.open(todo.id));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ctx.open(todo.id);
      });
      const col = board.columns.get(todo.columnId);
      const progress = todo.checklist.progress();
      const due = dueText(board, todo, today);
      const cell = (...nodes: (Node | string)[]): HTMLElement => {
        const td = el('td');
        td.append(...nodes);
        return td;
      };
      const labels = el('div', 'tchips');
      for (const l of todo.labels) labels.append(labelChip(l));
      const team = TEAM_CHOICES.find((t) => t.id === todo.team);
      const where = [todo.repo, team?.label].filter((x): x is string => x !== null && x !== undefined).join(' · ');
      const colCell = el('div', 'bar');
      if (col !== null) colCell.append(dot(col.color), el('span', undefined, col.name));
      tr.append(
        cell(el('b', 'tt', todo.title)),
        cell(colCell),
        cell(todo.priority === 'normal' ? '' : chipOf(PRIORITY_LABEL[todo.priority], todo.priority === 'high' ? 'red' : '')),
        cell(due === null ? '' : chipOf(due.text, due.cls)),
        cell(labels),
        cell(where),
        cell(progress.total === 0 ? '' : `${progress.done}/${progress.total}`),
        cell(ymd(todo.createdAt)),
      );
      body.append(tr);
    }
    table.append(body);
    root.append(table);
  }

  return { root, render };
}
