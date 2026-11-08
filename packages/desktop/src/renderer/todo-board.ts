import type { Column } from '../shared/todo-columns.js';
import { beforeIdAt } from '../shared/todo-order.js';
import { TEAM_CHOICES, type Todo } from '../shared/todo-list.js';
import { el } from './dom.js';
import { PRIORITY_LABEL, button, chipOf, colorItems, confirmDialog, dot, dueText, labelChip, meter, showMenu, type MenuItem, type TodoCtx } from './todo-parts.js';

/** 끌고 있는 것. 한 번에 하나이고, 끌기가 끝나면 비운다. (HTML5 끌어서 놓기: 데이터는 여기에 두고 dataTransfer에는 표시만 한다) */
let drag: { readonly kind: 'card' | 'column'; readonly id: string } | null = null;

export interface BoardView {
  readonly root: HTMLElement;
  render(): void;
  /** 좁은 창이면 칸을 탭으로 고른다 */
  setNarrow(narrow: boolean): void;
  /** 칸 아래 "+ 카드 추가" 입력을 연다 */
  openAdder(columnId: string): void;
}

/** 칸반 보드: 칸 + 카드, 끌어서 놓기, 칸 메뉴, "+ 카드 추가". 규칙은 TodoList가 지키고 여기서는 요청을 보낸다. */
export function buildBoard(ctx: TodoCtx): BoardView {
  const root = el('div', 'tboard');
  let narrow = false;
  let activeTab: string | null = null;
  let adding: string | null = null;
  let addDraft = '';
  let renaming: string | null = null;
  let addingColumn = false;
  let columnDraft = '';
  const line = el('div', 'tdrop');

  const clearDrop = (): void => {
    line.remove();
    line.dataset['before'] = '';
    line.dataset['col'] = '';
    for (const n of root.querySelectorAll('.drop-on')) n.classList.remove('drop-on');
  };

  // ── 카드 ──

  function cardMenu(todo: Todo, anchor: HTMLElement): void {
    const board = ctx.board();
    const items: MenuItem[] = [{ label: '열기', pick: () => ctx.open(todo.id) }];
    if (board.canDelegate(todo)) items.push({ label: '팀에 맡기기', pick: () => void ctx.act({ kind: 'delegate', id: todo.id }).then((r) => r.ok && r.jobId !== null && ctx.openJob(r.jobId)) });
    if (todo.jobId !== null) items.push({ label: '진행 보기', pick: () => ctx.openJob(todo.jobId!) });
    items.push('sep', { heading: '이동' });
    for (const c of board.columns.items) {
      if (c.id !== todo.columnId) items.push({ label: c.name, dot: c.color, pick: () => void ctx.act({ kind: 'move', id: todo.id, columnId: c.id, beforeId: null }) });
    }
    const mine = board.cardsIn(todo.columnId);
    const at = mine.findIndex((t) => t.id === todo.id);
    items.push({ label: '칸 안에서 위로', disabled: at <= 0, pick: () => void ctx.act({ kind: 'move', id: todo.id, columnId: todo.columnId, beforeId: mine[at - 1]!.id }) });
    items.push({ label: '칸 안에서 아래로', disabled: at === mine.length - 1, pick: () => void ctx.act({ kind: 'move', id: todo.id, columnId: todo.columnId, beforeId: mine[at + 2]?.id ?? null }) });
    items.push('sep', { label: '지우기', danger: true, pick: () => confirmDialog('카드를 지울까요?', `"${todo.title}" 카드가 지워져요. 되돌릴 수 없어요.`, [{ label: '지우기', cls: 'btn danger', pick: () => void ctx.act({ kind: 'remove', id: todo.id }) }]) });
    showMenu(anchor, items);
  }

  function card(todo: Todo): HTMLElement {
    const board = ctx.board();
    const box = el('div', `item tcard p-${todo.priority}${board.isDone(todo) ? ' done' : ''}`);
    box.dataset['id'] = todo.id;
    box.draggable = true;
    box.tabIndex = 0;
    box.setAttribute('role', 'button');
    box.addEventListener('click', () => ctx.open(todo.id));
    box.addEventListener('keydown', (e) => {
      if (e.target === box && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        ctx.open(todo.id);
      }
    });
    box.addEventListener('dragstart', (e) => {
      drag = { kind: 'card', id: todo.id };
      e.dataTransfer?.setData('text/plain', todo.title);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      // 그림자가 먼저 만들어진 뒤에 흐리게 한다
      setTimeout(() => box.classList.add('dragging'), 0);
    });
    box.addEventListener('dragend', () => {
      drag = null;
      box.classList.remove('dragging');
      clearDrop();
    });

    const top = el('div', 'ttop');
    top.append(el('b', 'tt', todo.title));
    const more = button('⋯', 'btn icon sm ghost', () => cardMenu(todo, more));
    more.title = '카드 메뉴';
    more.setAttribute('aria-label', '카드 메뉴');
    more.addEventListener('click', (e) => e.stopPropagation());
    top.append(more);

    if (todo.labels.length > 0) {
      const labels = el('div', 'tchips');
      for (const l of todo.labels) labels.append(labelChip(l));
      box.append(labels);
    }
    box.append(top);

    const chips = el('div', 'tchips');
    if (todo.priority !== 'normal') chips.append(chipOf(`우선순위 ${PRIORITY_LABEL[todo.priority]}`, todo.priority === 'high' ? 'red' : ''));
    const due = dueText(board, todo, ctx.today());
    if (due !== null) chips.append(chipOf(due.text, due.cls));
    if (todo.repo !== null) chips.append(chipOf(todo.repo, 'blue'));
    const team = TEAM_CHOICES.find((t) => t.id === todo.team);
    if (team !== undefined) chips.append(chipOf(team.label, 'purple'));
    if (todo.jobId !== null) chips.append(chipOf(board.columns.work()?.id === todo.columnId ? '팀이 일하는 중' : '팀이 한 일', 'green'));
    const progress = todo.checklist.progress();
    if (progress.total > 0) chips.append(chipOf(`✓ ${progress.done}/${progress.total}`, progress.done === progress.total ? 'green' : ''));
    if (chips.childElementCount > 0) box.append(chips);
    if (progress.total > 0) box.append(meter(progress.percent));
    if (todo.note !== '') box.append(el('div', 'tnote', todo.note));
    return box;
  }

  // ── 칸 ──

  function columnMenu(col: Column, anchor: HTMLElement): void {
    const board = ctx.board();
    const at = board.columns.items.findIndex((c) => c.id === col.id);
    const edit = (patch: object): void => void ctx.act({ kind: 'column-edit', id: col.id, patch });
    const items: MenuItem[] = [
      { label: '이름 바꾸기', pick: () => ((renaming = col.id), render()) },
      { heading: '색' },
      ...colorItems(col.color, (c) => edit({ color: c })),
      'sep',
      { label: '완료로 취급', checked: col.done, pick: () => edit({ done: !col.done }) },
      { label: '팀이 일하는 칸', checked: col.work, pick: () => edit({ work: !col.work }) },
      { label: col.collapsed ? '펼치기' : '접기', pick: () => edit({ collapsed: !col.collapsed }) },
      'sep',
      { label: '앞으로 이동', disabled: at === 0, pick: () => void ctx.act({ kind: 'column-move', id: col.id, beforeId: board.columns.items[at - 1]!.id }) },
      { label: '뒤로 이동', disabled: at === board.columns.items.length - 1, pick: () => void ctx.act({ kind: 'column-move', id: col.id, beforeId: board.columns.items[at + 2]?.id ?? null }) },
      'sep',
      { label: '칸 지우기', danger: true, disabled: board.columns.items.length <= 1, pick: () => removeColumn(col) },
    ];
    showMenu(anchor, items);
  }

  function removeColumn(col: Column): void {
    const board = ctx.board();
    const count = board.cardsIn(col.id).length;
    const landing = board.columns.get(board.columns.landingFor(col.id))!;
    const remove = (cards: 'merge' | 'delete') => () => void ctx.act({ kind: 'column-remove', id: col.id, cards });
    if (count === 0) {
      confirmDialog(`"${col.name}" 칸을 지울까요?`, '카드가 없는 칸이에요.', [{ label: '지우기', cls: 'btn danger', pick: remove('merge') }]);
      return;
    }
    confirmDialog(`"${col.name}" 칸을 지울까요?`, `카드 ${count}장이 있어요. "${landing.name}" 칸으로 옮기거나, 카드까지 함께 지울 수 있어요. 함께 지우면 되돌릴 수 없어요.`, [
      { label: `"${landing.name}"으로 옮기고 지우기`, cls: 'btn primary', pick: remove('merge') },
      { label: `카드 ${count}장도 함께 지우기`, cls: 'btn danger', pick: remove('delete') },
    ]);
  }

  function header(col: Column, shown: number, total: number): HTMLElement {
    const head = el('div', 'tch');
    head.dataset['col'] = col.id;
    head.draggable = renaming !== col.id && !narrow;
    head.addEventListener('dragstart', (e) => {
      if (e.target !== head) return;
      drag = { kind: 'column', id: col.id };
      e.dataTransfer?.setData('text/plain', col.name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => head.closest('.tcol')?.classList.add('dragging'), 0);
    });
    head.addEventListener('dragend', () => {
      drag = null;
      head.closest('.tcol')?.classList.remove('dragging');
      clearDrop();
    });

    head.append(dot(col.color));
    if (renaming === col.id) {
      const input = el('input', 'sm grow');
      input.value = col.name;
      input.maxLength = 30;
      input.setAttribute('aria-label', '칸 이름');
      let done = false;
      const finish = (save: boolean): void => {
        if (done) return;
        done = true;
        renaming = null;
        if (save && input.value.trim() !== '' && input.value.trim() !== col.name) void ctx.act({ kind: 'column-edit', id: col.id, patch: { name: input.value } });
        else render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      head.append(input);
      queueMicrotask(() => (input.focus(), input.select()));
    } else {
      const name = el('b', 'tname', col.name);
      name.title = '두 번 누르면 이름을 바꿔요';
      name.addEventListener('dblclick', () => ((renaming = col.id), render()));
      head.append(name);
    }
    head.append(chipOf(shown === total ? String(total) : `${shown}/${total}`));
    const fold = button(col.collapsed ? '▸' : '▾', 'btn icon sm ghost', () => void ctx.act({ kind: 'column-edit', id: col.id, patch: { collapsed: !col.collapsed } }));
    fold.title = col.collapsed ? '펼치기' : '접기';
    fold.setAttribute('aria-label', fold.title);
    const more = button('⋯', 'btn icon sm ghost', () => columnMenu(col, more));
    more.title = '칸 메뉴';
    more.setAttribute('aria-label', '칸 메뉴');
    head.append(fold, more);
    return head;
  }

  function adder(col: Column): HTMLElement {
    if (adding !== col.id) {
      const open = button('+ 카드 추가', 'btn ghost sm block', () => ctx.quickAdd(col.id));
      open.classList.add('tadd');
      return open;
    }
    const wrap = el('div', 'tadding');
    const input = el('input', 'sm');
    input.placeholder = '제목을 치고 Enter';
    input.maxLength = 120;
    input.value = addDraft;
    input.setAttribute('aria-label', '새 카드 제목');
    input.addEventListener('input', () => (addDraft = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        adding = null;
        addDraft = '';
        render();
      }
      if (e.key === 'Enter' && input.value.trim() !== '') {
        e.preventDefault();
        const title = input.value;
        input.value = '';
        addDraft = '';
        void ctx.act({ kind: 'add', title, columnId: col.id }).then((r) => {
          if (!r.ok) {
            addDraft = title;
            render();
          }
        });
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim() === '' && adding === col.id) {
        adding = null;
        addDraft = '';
        queueMicrotask(render);
      }
    });
    wrap.append(input);
    queueMicrotask(() => input.focus());
    return wrap;
  }

  function column(col: Column, cards: readonly Todo[], total: number): HTMLElement {
    const box = el('div', `tcol${col.collapsed ? ' collapsed' : ''}`);
    box.dataset['col'] = col.id;
    box.append(header(col, cards.length, total));
    if (col.collapsed) return box;
    const list = el('div', 'tcards');
    if (cards.length === 0) list.append(el('div', 'tnone', total === 0 ? '카드가 없어요' : '걸러져서 안 보여요'));
    for (const c of cards) list.append(card(c));
    box.append(list, adder(col));
    return box;
  }

  // ── 끌어서 놓기 ──

  root.addEventListener('dragover', (e) => {
    if (drag === null) return;
    const target = e.target as HTMLElement;
    const colEl = target.closest<HTMLElement>('.tcol');
    if (drag.kind === 'card') {
      const tab = target.closest<HTMLElement>('.tab[data-col]');
      if (tab !== null) {
        e.preventDefault();
        clearDrop();
        tab.classList.add('drop-on');
        return;
      }
      if (colEl === null) return;
      e.preventDefault();
      clearDrop();
      colEl.classList.add('drop-on');
      const list = colEl.querySelector<HTMLElement>('.tcards');
      if (list === null) return;
      const cards = [...list.querySelectorAll<HTMLElement>('.tcard')];
      const before = beforeIdAt(cards.map((c) => ({ id: c.dataset['id']!, start: c.getBoundingClientRect().top, size: c.offsetHeight })), e.clientY, drag.id);
      const ref = before === null ? null : (cards.find((c) => c.dataset['id'] === before) ?? null);
      list.insertBefore(line, ref);
      line.dataset['before'] = before ?? '';
      line.dataset['col'] = colEl.dataset['col']!;
    } else {
      e.preventDefault();
      clearDrop();
      const cols = [...root.querySelectorAll<HTMLElement>('.tcol')];
      const before = beforeIdAt(cols.map((c) => ({ id: c.dataset['col']!, start: c.getBoundingClientRect().left, size: c.offsetWidth })), e.clientX, drag.id);
      const ref = before === null ? null : (cols.find((c) => c.dataset['col'] === before) ?? null);
      const row = root.querySelector<HTMLElement>('.tcolumns');
      if (row === null) return;
      line.dataset['before'] = before ?? '';
      line.dataset['col'] = '';
      row.insertBefore(line, ref ?? row.querySelector('.tnew'));
    }
  });
  root.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null || !root.contains(e.relatedTarget as Node)) clearDrop();
  });
  root.addEventListener('drop', (e) => {
    if (drag === null) return;
    const current = drag;
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab[data-col]');
    const placed = line.parentElement !== null;
    const before = placed ? line.dataset['before'] || null : null;
    const target = placed ? line.dataset['col'] || null : null;
    clearDrop();
    drag = null;
    e.preventDefault();
    if (current.kind === 'card') {
      const columnId = tab?.dataset['col'] ?? target;
      if (columnId !== null && columnId !== undefined) void ctx.act({ kind: 'move', id: current.id, columnId, beforeId: tab === null ? before : null });
    } else if (placed) {
      void ctx.act({ kind: 'column-move', id: current.id, beforeId: before });
    }
  });

  // ── 그리기 ──

  function render(): void {
    const board = ctx.board();
    const today = ctx.today();
    const shown = board.view(ctx.filter(), 'manual', today);
    const counts = board.counts();
    const cols = board.columns.items;
    if (activeTab === null || !board.columns.has(activeTab)) activeTab = cols[0]!.id;
    // 다시 그려도 보던 자리가 그대로 있게 스크롤 위치를 기억한다
    const scrolls = new Map<string, number>();
    for (const c of root.querySelectorAll<HTMLElement>('.tcol')) scrolls.set(c.dataset['col']!, c.querySelector('.tcards')?.scrollTop ?? 0);
    const rowLeft = root.querySelector('.tcolumns')?.scrollLeft ?? 0;
    root.classList.toggle('narrow', narrow);
    root.replaceChildren();

    const inColumn = (c: Column): readonly Todo[] => shown.filter((t) => t.columnId === c.id);
    if (narrow) {
      const tabs = el('div', 'tabs ttabs');
      for (const c of cols) {
        const t = el('button', `tab${c.id === activeTab ? ' on' : ''}`);
        t.type = 'button';
        t.dataset['col'] = c.id;
        t.append(dot(c.color), el('span', undefined, c.name), chipOf(String(counts[c.id] ?? 0)));
        t.addEventListener('click', () => ((activeTab = c.id), render()));
        tabs.append(t);
      }
      tabs.append(button('+ 칸', 'btn ghost sm tab-end', () => ((addingColumn = true), render())));
      root.append(tabs);
      const col = cols.find((c) => c.id === activeTab)!;
      const one = column({ ...col, collapsed: false }, inColumn(col), counts[col.id] ?? 0);
      one.classList.add('only');
      root.append(one);
    } else {
      const row = el('div', 'tcolumns');
      for (const c of cols) row.append(column(c, inColumn(c), counts[c.id] ?? 0));
      const tail = el('div', 'tnew');
      tail.append(newColumn());
      row.append(tail);
      root.append(row);
      row.scrollLeft = rowLeft;
    }
    if (narrow && addingColumn) root.append(newColumn());
    for (const c of root.querySelectorAll<HTMLElement>('.tcol')) {
      const list = c.querySelector('.tcards');
      if (list !== null) list.scrollTop = scrolls.get(c.dataset['col']!) ?? 0;
    }
    // 검색·필터로 모두 가려졌을 때 알려 준다
    if (shown.length === 0 && board.items.length > 0) root.append(el('div', 'tempty', '걸러진 카드가 없어요. 검색·필터를 바꿔 보세요.'));
  }

  function newColumn(): HTMLElement {
    if (!addingColumn) return button('+ 칸 추가', 'btn ghost sm', () => ((addingColumn = true), render()));
    const input = el('input', 'sm');
    input.placeholder = '칸 이름을 치고 Enter';
    input.maxLength = 30;
    input.value = columnDraft;
    input.setAttribute('aria-label', '새 칸 이름');
    input.addEventListener('input', () => (columnDraft = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        addingColumn = false;
        columnDraft = '';
        render();
      }
      if (e.key === 'Enter' && input.value.trim() !== '') {
        e.preventDefault();
        const name = input.value;
        void ctx.act({ kind: 'column-add', name, color: 'gray' }).then((r) => {
          if (r.ok) {
            addingColumn = false;
            columnDraft = '';
            const last = r.list.columns[r.list.columns.length - 1];
            if (last !== undefined) activeTab = last.id;
            render();
          }
        });
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim() === '') {
        addingColumn = false;
        columnDraft = '';
        queueMicrotask(render);
      }
    });
    queueMicrotask(() => input.focus());
    return input;
  }

  return {
    root,
    render,
    setNarrow(value: boolean): void {
      if (narrow === value) return;
      narrow = value;
      render();
    },
    openAdder(columnId: string): void {
      adding = columnId;
      activeTab = columnId;
      render();
    },
  };
}
