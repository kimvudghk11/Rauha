import type { Column } from '../shared/todo-columns.js';
import { beforeIdAt } from '../shared/todo-order.js';
import { TEAM_CHOICES, type Todo } from '../shared/todo-list.js';
import { el, isEnterKey } from './dom.js';
import { PRIORITY_LABEL, button, chipOf, colorItems, confirmDialog, dueText, labelChip, select, showMenu, type MenuItem, type TodoCtx } from './todo-parts.js';

/** 끌고 있는 것. 한 번에 하나이고, 끌기가 끝나면 비운다. (HTML5 끌어서 놓기: 데이터는 여기에 두고 dataTransfer에는 표시만 한다) */
let drag: { readonly kind: 'card' | 'column'; readonly id: string } | null = null;

export interface BoardView {
  readonly root: HTMLElement;
  render(): void;
  /** 칸의 "+ 새로 만들기" 입력을 연다. top이면 칸 맨 위에 넣는 입력이다. */
  openAdder(columnId: string, top?: boolean): void;
  /** 카드에 키보드 초점을 준다(없으면 false) */
  focusCard(id: string): boolean;
  /** 지금 초점이 있는 카드가 든 칸 번호(없으면 null) */
  focusedColumn(): string | null;
}

/** 놓을 자리: 카드면 칸 + 그 칸의 어느 카드 앞인지, 칸이면 어느 칸 앞인지 */
interface DropAt {
  readonly columnId: string | null;
  readonly before: string | null;
}

/**
 * 칸반 보드. 칸은 272px 고정이고 넘치면 가로로 스크롤한다. 규칙은 TodoList가 지키고 여기서는 요청만 보낸다.
 * 칸 머리(색 칩 + 카드 수 + `+` + `⋯`), 칸 아래 "+ 새로 만들기"(연속 입력), 카드 우클릭 메뉴, 방향키·Enter·Alt+방향키, 끌어서 놓기.
 */
export function buildBoard(ctx: TodoCtx): BoardView {
  const root = el('div', 'tboard');
  let adding: { readonly columnId: string; readonly top: boolean } | null = null;
  let addDraft = '';
  let renaming: string | null = null;
  let addingColumn = false;
  let columnDraft = '';
  let pendingFocus: string | null = null;
  const line = el('div', 'tdrop');

  const clearDrop = (): void => {
    line.remove();
    for (const n of root.querySelectorAll('.drop-on')) n.classList.remove('drop-on');
  };

  const cardEls = (colEl: Element): HTMLElement[] => [...colEl.querySelectorAll<HTMLElement>('.tcard')];
  const columnEls = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.tcol')];

  // ── 카드 ──

  function cardMenu(todo: Todo, at: { x: number; y: number }): void {
    const board = ctx.board();
    const items: MenuItem[] = [
      { label: '열기', pick: () => ctx.open(todo.id) },
      { label: '복제', pick: () => void ctx.act({ kind: 'duplicate', id: todo.id }) },
    ];
    if (board.canDelegate(todo)) items.push({ label: '팀에 맡기기', pick: () => void ctx.act({ kind: 'delegate', id: todo.id }).then((r) => r.ok && r.jobId !== null && ctx.openJob(r.jobId)) });
    if (todo.jobId !== null) items.push({ label: '진행 보기', pick: () => ctx.openJob(todo.jobId!) });
    items.push('sep', { heading: '칸 이동' });
    for (const c of board.columns.items) {
      if (c.id !== todo.columnId) items.push({ label: c.hidden ? `${c.name} (숨김)` : c.name, dot: c.color, pick: () => void ctx.act({ kind: 'move', id: todo.id, columnId: c.id, beforeId: null }) });
    }
    const mine = board.cardsIn(todo.columnId);
    const index = mine.findIndex((t) => t.id === todo.id);
    items.push({ label: '칸 안에서 위로', disabled: index <= 0, pick: () => moveWithin(todo, -1) });
    items.push({ label: '칸 안에서 아래로', disabled: index === mine.length - 1, pick: () => moveWithin(todo, 1) });
    items.push('sep', {
      label: '지우기',
      danger: true,
      pick: () => confirmDialog('카드를 지울까요?', `"${todo.title}" 카드가 지워져요. 되돌릴 수 없어요.`, [{ label: '지우기', cls: 'btn danger', pick: () => void ctx.act({ kind: 'remove', id: todo.id }) }]),
    });
    showMenu(at, items);
  }

  /** 같은 칸 안에서 한 칸 위(-1)나 아래(+1)로 */
  function moveWithin(todo: Todo, step: -1 | 1): void {
    const mine = ctx.board().cardsIn(todo.columnId);
    const index = mine.findIndex((t) => t.id === todo.id);
    if (index < 0) return;
    const beforeId = step === -1 ? (mine[index - 1]?.id ?? null) : (mine[index + 2]?.id ?? null);
    if (step === -1 && index === 0) return;
    if (step === 1 && index === mine.length - 1) return;
    pendingFocus = todo.id;
    void ctx.act({ kind: 'move', id: todo.id, columnId: todo.columnId, beforeId });
  }

  /** 옆 칸으로(방향키 -1/+1). 같은 자리쯤에 놓는다. */
  function moveAcross(todo: Todo, step: -1 | 1): void {
    const board = ctx.board();
    const cols = board.columns.visible();
    const at = cols.findIndex((c) => c.id === todo.columnId);
    const next = cols[at + step];
    if (next === undefined) return;
    const index = board.cardsIn(todo.columnId).findIndex((t) => t.id === todo.id);
    pendingFocus = todo.id;
    void ctx.act({ kind: 'move', id: todo.id, columnId: next.id, beforeId: board.cardsIn(next.id)[index]?.id ?? null });
  }

  /** 방향키로 초점을 옮긴다 */
  function focusNeighbor(box: HTMLElement, key: string): void {
    const colEl = box.closest<HTMLElement>('.tcol');
    if (colEl === null) return;
    const mine = cardEls(colEl);
    const index = mine.indexOf(box);
    if (key === 'ArrowUp') mine[index - 1]?.focus();
    else if (key === 'ArrowDown') mine[index + 1]?.focus();
    else {
      const cols = columnEls();
      let at = cols.indexOf(colEl);
      const step = key === 'ArrowLeft' ? -1 : 1;
      for (at += step; at >= 0 && at < cols.length; at += step) {
        const there = cardEls(cols[at]!);
        if (there.length > 0) {
          there[Math.min(index, there.length - 1)]!.focus();
          return;
        }
      }
    }
  }

  function card(todo: Todo): HTMLElement {
    const board = ctx.board();
    const box = el('div', `item tcard${board.isDone(todo) ? ' done' : ''}`);
    box.dataset['id'] = todo.id;
    box.draggable = true;
    box.tabIndex = 0;
    box.setAttribute('role', 'button');
    box.addEventListener('click', () => ctx.open(todo.id));
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cardMenu(todo, { x: e.clientX, y: e.clientY });
    });
    box.addEventListener('keydown', (e) => {
      if (e.target !== box) return;
      if (isEnterKey(e) || e.key === ' ') {
        e.preventDefault();
        ctx.open(todo.id);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = box.getBoundingClientRect();
        cardMenu(todo, { x: r.left + 16, y: r.top + 16 });
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (!e.altKey) focusNeighbor(box, e.key);
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') moveWithin(todo, e.key === 'ArrowUp' ? -1 : 1);
        else moveAcross(todo, e.key === 'ArrowLeft' ? -1 : 1);
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

    box.append(el('div', 'tt', todo.title));

    // 값이 있는 속성만 칩으로 보인다
    const chips = el('div', 'tchips');
    for (const l of todo.labels) chips.append(labelChip(l));
    if (todo.priority !== 'normal') {
      const p = chipOf(PRIORITY_LABEL[todo.priority], todo.priority === 'high' ? 'red' : '');
      p.title = '우선순위';
      chips.append(p);
    }
    const due = dueText(board, todo, ctx.today());
    if (due !== null) chips.append(chipOf(due.text, due.cls));
    if (todo.repo !== null) chips.append(chipOf(todo.repo, 'blue'));
    const team = TEAM_CHOICES.find((t) => t.id === todo.team);
    if (team !== undefined) chips.append(chipOf(team.label, 'purple'));
    if (todo.jobId !== null) chips.append(chipOf(board.columns.work()?.id === todo.columnId ? '팀이 일하는 중' : '팀이 한 일', 'green'));
    const progress = todo.checklist.progress();
    if (progress.total > 0) chips.append(chipOf(`✓ ${progress.done}/${progress.total}`, progress.done === progress.total ? 'green' : ''));
    if (chips.childElementCount > 0) box.append(chips);
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
      { label: '숨기기', disabled: board.columns.visible().length <= 1, pick: () => edit({ hidden: true }) },
      'sep',
      { label: '앞으로 이동', disabled: at === 0, pick: () => void ctx.act({ kind: 'column-move', id: col.id, beforeId: board.columns.items[at - 1]!.id }) },
      { label: '뒤로 이동', disabled: at === board.columns.items.length - 1, pick: () => void ctx.act({ kind: 'column-move', id: col.id, beforeId: board.columns.items[at + 2]?.id ?? null }) },
      'sep',
      { label: '칸 지우기', danger: true, disabled: board.columns.items.length <= 1, pick: () => removeColumn(col) },
    ];
    showMenu(anchor, items);
  }

  /** 칸 지우기: 카드가 있으면 옮길 칸을 고르게 하거나 카드까지 함께 지운다 */
  function removeColumn(col: Column): void {
    const board = ctx.board();
    const count = board.cardsIn(col.id).length;
    if (count === 0) {
      confirmDialog(`"${col.name}" 칸을 지울까요?`, '카드가 없는 칸이에요.', [{ label: '지우기', cls: 'btn danger', pick: () => void ctx.act({ kind: 'column-remove', id: col.id, cards: 'merge', into: null }) }]);
      return;
    }
    const others = board.columns.items.filter((c) => c.id !== col.id);
    const landing = board.columns.landingFor(col.id);
    const into = select(others.map((c) => [c.id, c.hidden ? `${c.name} (숨김)` : c.name] as const), landing, () => undefined);
    into.setAttribute('aria-label', '카드를 옮길 칸');
    const pick = el('label', 'dfield');
    pick.append(el('span', 'lbl', '카드를 옮길 칸'), into);
    confirmDialog(
      `"${col.name}" 칸을 지울까요?`,
      `카드 ${count}장이 있어요. 고른 칸으로 옮기거나, 카드까지 함께 지울 수 있어요. 함께 지우면 되돌릴 수 없어요.`,
      [
        { label: '옮기고 지우기', cls: 'btn primary', pick: () => void ctx.act({ kind: 'column-remove', id: col.id, cards: 'merge', into: into.value }) },
        { label: `카드 ${count}장도 함께 지우기`, cls: 'btn danger', pick: () => void ctx.act({ kind: 'column-remove', id: col.id, cards: 'delete', into: null }) },
      ],
      pick,
    );
  }

  function header(col: Column, shown: number, total: number): HTMLElement {
    const head = el('div', 'tch');
    head.dataset['col'] = col.id;
    head.draggable = renaming !== col.id;
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
        if (isEnterKey(e)) finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      head.append(input);
      queueMicrotask(() => (input.focus(), input.select()));
    } else {
      const name = el('span', `chip tname${col.color === 'gray' ? '' : ` ${col.color}`}`, col.name);
      name.title = '두 번 누르면 이름을 바꿔요';
      name.addEventListener('dblclick', () => ((renaming = col.id), render()));
      head.append(name);
    }
    head.append(el('span', 'tcount', shown === total ? String(total) : `${shown}/${total}`));
    head.append(el('span', 'grow'));
    if (!col.collapsed) {
      const add = button('+', 'btn icon sm ghost', () => ctx.quickAdd(col.id, true));
      add.title = '이 칸 맨 위에 카드 추가';
      add.setAttribute('aria-label', `${col.name} 칸에 카드 추가`);
      head.append(add);
    }
    const more = button('⋯', 'btn icon sm ghost', () => columnMenu(col, more));
    more.title = '칸 메뉴';
    more.setAttribute('aria-label', `${col.name} 칸 메뉴`);
    head.append(more);
    return head;
  }

  /** 카드 이름을 치고 Enter로 잇따라 만드는 입력칸. 비어 있는 채 초점을 잃으면 사라진다. */
  function adder(col: Column, top: boolean): HTMLElement {
    const wrap = el('div', 'tadding');
    const input = el('input', 'sm');
    input.placeholder = '제목을 치고 Enter';
    input.maxLength = 120;
    input.value = addDraft;
    input.setAttribute('aria-label', '새 카드 제목');
    input.addEventListener('input', () => (addDraft = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        adding = null;
        addDraft = '';
        render();
      }
      if (isEnterKey(e) && input.value.trim() !== '') {
        e.preventDefault();
        const title = input.value;
        input.value = '';
        addDraft = '';
        void ctx.act({ kind: 'add', title, columnId: col.id, top }).then((r) => {
          if (!r.ok) {
            addDraft = title;
            render();
          }
        });
      }
    });
    input.addEventListener('blur', () => {
      // (화면이 다시 그려져 이 입력칸이 이미 새 것으로 바뀌었다면 아무것도 안 한다) 다른 곳을 누르는 중에 화면을 다시 그리면 그 클릭이 사라진다. 잠깐 뒤에 아직 비어 있고 초점이 없을 때만 닫는다.
      setTimeout(() => {
        if (input.isConnected && adding?.columnId === col.id && input.value.trim() === '' && document.activeElement !== input) {
          adding = null;
          addDraft = '';
          render();
        }
      }, 200);
    });
    wrap.append(input);
    queueMicrotask(() => input.focus());
    return wrap;
  }

  function column(col: Column, cards: readonly Todo[], total: number): HTMLElement {
    const box = el('div', `tcol${col.collapsed ? ' collapsed' : ''}`);
    box.dataset['col'] = col.id;
    box.append(header(col, cards.length, total));
    if (col.collapsed) {
      box.title = '눌러서 펼치기';
      box.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('button, input')) void ctx.act({ kind: 'column-edit', id: col.id, patch: { collapsed: false } });
      });
      return box;
    }
    const list = el('div', 'tcards');
    const topAdd = adding?.columnId === col.id && adding.top;
    const bottomAdd = adding?.columnId === col.id && !adding.top;
    if (topAdd) list.append(adder(col, true));
    if (cards.length === 0 && !topAdd && !bottomAdd) list.append(el('div', 'tnone', total === 0 ? '카드가 없어요' : '걸러져서 안 보여요'));
    for (const c of cards) list.append(card(c));
    if (bottomAdd) list.append(adder(col, false));
    box.append(list);
    if (!bottomAdd) {
      const open = button('+ 새로 만들기', 'btn ghost sm block tadd', () => ctx.quickAdd(col.id, false));
      box.append(open);
    }
    return box;
  }

  // ── 끌어서 놓기: 놓는 자리는 포인터 위치로 그때그때 다시 계산한다(저장해 둔 값에 기대지 않는다) ──

  function locate(e: DragEvent): DropAt | null {
    if (drag === null) return null;
    const target = e.target as HTMLElement;
    if (drag.kind === 'card') {
      const hid = target.closest<HTMLElement>('.thid[data-col]');
      if (hid !== null) return { columnId: hid.dataset['col']!, before: null };
      const colEl = target.closest<HTMLElement>('.tcol');
      if (colEl === null) return null;
      const columnId = colEl.dataset['col']!;
      const list = colEl.querySelector<HTMLElement>('.tcards');
      if (list === null) return { columnId, before: null };
      const cards = cardEls(list);
      return { columnId, before: beforeIdAt(cards.map((c) => ({ id: c.dataset['id']!, start: c.getBoundingClientRect().top, size: c.offsetHeight })), e.clientY, drag.id) };
    }
    const cols = columnEls();
    return { columnId: null, before: beforeIdAt(cols.map((c) => ({ id: c.dataset['col']!, start: c.getBoundingClientRect().left, size: c.offsetWidth })), e.clientX, drag.id) };
  }

  root.addEventListener('dragover', (e) => {
    const at = locate(e);
    if (at === null || drag === null) return;
    e.preventDefault();
    clearDrop();
    const target = e.target as HTMLElement;
    if (drag.kind === 'card') {
      const hid = target.closest<HTMLElement>('.thid[data-col]');
      if (hid !== null) {
        hid.classList.add('drop-on');
        return;
      }
      const colEl = target.closest<HTMLElement>('.tcol')!;
      colEl.classList.add('drop-on');
      const list = colEl.querySelector<HTMLElement>('.tcards');
      if (list === null) return;
      const ref = at.before === null ? null : (cardEls(list).find((c) => c.dataset['id'] === at.before) ?? null);
      list.insertBefore(line, ref);
    } else {
      const row = root.querySelector<HTMLElement>('.tcolumns');
      if (row === null) return;
      const ref = at.before === null ? null : (columnEls().find((c) => c.dataset['col'] === at.before) ?? null);
      row.insertBefore(line, ref ?? row.querySelector('.ttail'));
    }
  });
  root.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null || !root.contains(e.relatedTarget as Node)) clearDrop();
  });
  root.addEventListener('drop', (e) => {
    const current = drag;
    const at = locate(e);
    clearDrop();
    drag = null;
    if (current === null || at === null) return;
    e.preventDefault();
    if (current.kind === 'card') {
      if (at.columnId !== null) void ctx.act({ kind: 'move', id: current.id, columnId: at.columnId, beforeId: at.before });
    } else {
      void ctx.act({ kind: 'column-move', id: current.id, beforeId: at.before });
    }
  });

  // ── 그리기 ──

  /** 숨긴 칸 영역: 칸을 다시 보이게 하거나(카드를 끌어다 놓아도 그 칸으로 옮겨진다) 지운다 */
  function hiddenPanel(hidden: readonly Column[], counts: Readonly<Record<string, number>>): HTMLElement {
    const panel = el('div', 'thidden');
    panel.append(el('div', 'lbl', `숨긴 칸 ${hidden.length}`));
    for (const c of hidden) {
      const row = el('div', 'thid row-item');
      row.dataset['col'] = c.id;
      row.append(el('span', `dot ${c.color}`), el('span', 'grow tname', c.name), el('span', 'tcount', String(counts[c.id] ?? 0)));
      const show = button('보이기', 'btn sm', () => void ctx.act({ kind: 'column-edit', id: c.id, patch: { hidden: false } }));
      show.setAttribute('aria-label', `${c.name} 칸 보이기`);
      row.append(show);
      panel.append(row);
    }
    return panel;
  }

  function newColumn(): HTMLElement {
    if (!addingColumn) return button('+ 칸 추가', 'btn ghost sm block', () => ((addingColumn = true), render()));
    const input = el('input', 'sm');
    input.placeholder = '칸 이름을 치고 Enter';
    input.maxLength = 30;
    input.value = columnDraft;
    input.setAttribute('aria-label', '새 칸 이름');
    input.addEventListener('input', () => (columnDraft = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        addingColumn = false;
        columnDraft = '';
        render();
      }
      if (isEnterKey(e) && input.value.trim() !== '') {
        e.preventDefault();
        const name = input.value;
        void ctx.act({ kind: 'column-add', name, color: 'gray' }).then((r) => {
          if (r.ok) {
            addingColumn = false;
            columnDraft = '';
            render();
            // 새 칸이 가로 끝에 있으므로 보이는 곳까지 스크롤한다
            const row = root.querySelector('.tcolumns');
            if (row !== null) row.scrollLeft = row.scrollWidth;
          }
        });
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (input.isConnected && addingColumn && input.value.trim() === '' && document.activeElement !== input) {
          addingColumn = false;
          columnDraft = '';
          render();
        }
      }, 200);
    });
    queueMicrotask(() => input.focus());
    return input;
  }

  function render(): void {
    const board = ctx.board();
    const shown = board.view(ctx.filter(), 'manual', ctx.today());
    const counts = board.counts();
    const cols = board.columns.visible();
    const hidden = board.columns.items.filter((c) => c.hidden);
    // 다시 그려도 보던 자리와 초점이 그대로 있게 스크롤 위치와 초점 카드를 기억한다
    const scrolls = new Map<string, number>();
    for (const c of root.querySelectorAll<HTMLElement>('.tcol')) scrolls.set(c.dataset['col']!, c.querySelector('.tcards')?.scrollTop ?? 0);
    const rowLeft = root.querySelector('.tcolumns')?.scrollLeft ?? 0;
    const active = document.activeElement;
    const focusId = pendingFocus ?? (active instanceof HTMLElement && active.classList.contains('tcard') && root.contains(active) ? (active.dataset['id'] ?? null) : null);
    pendingFocus = null;
    root.replaceChildren();

    const row = el('div', 'tcolumns');
    for (const c of cols) row.append(column(c, shown.filter((t) => t.columnId === c.id), counts[c.id] ?? 0));
    const tail = el('div', 'ttail');
    tail.append(newColumn());
    if (hidden.length > 0) tail.append(hiddenPanel(hidden, counts));
    row.append(tail);
    root.append(row);
    row.scrollLeft = rowLeft;
    for (const c of root.querySelectorAll<HTMLElement>('.tcol')) {
      const list = c.querySelector('.tcards');
      if (list !== null) list.scrollTop = scrolls.get(c.dataset['col']!) ?? 0;
    }
    if (adding !== null) {
      // 맨 아래 입력은 보이는 곳까지 내려 준다
      const input = root.querySelector('.tadding');
      if (input !== null && !adding.top) input.scrollIntoView({ block: 'nearest' });
    }
    if (focusId !== null) view.focusCard(focusId);
    // 검색·필터로 모두 가려졌을 때 알려 준다
    if (shown.length === 0 && board.items.length > 0) root.append(el('div', 'tempty', '걸러진 카드가 없어요. 검색·필터를 바꿔 보세요.'));
  }

  const view: BoardView = {
    root,
    render,
    openAdder(columnId: string, top = false): void {
      adding = { columnId, top };
      render();
    },
    focusCard(id: string): boolean {
      const found = [...root.querySelectorAll<HTMLElement>('.tcard')].find((c) => c.dataset['id'] === id);
      found?.focus();
      return found !== undefined;
    },
    focusedColumn(): string | null {
      const active = document.activeElement;
      return active instanceof HTMLElement && root.contains(active) ? (active.closest<HTMLElement>('.tcol')?.dataset['col'] ?? null) : null;
    },
  };
  return view;
}
