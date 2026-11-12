import { TodoListDto, type TodoListJson, type TodoResult } from '../shared/todo-dto.js';
import { TODO_PRIORITIES, TodoList, type TodoFilter, type TodoPriority, type TodoSort } from '../shared/todo-list.js';
import { el } from './dom.js';
import { buildBoard } from './todo-board.js';
import { buildDetail } from './todo-detail.js';
import { NO_FILTER, PRIORITY_LABEL, button, select, type TodoCtx } from './todo-parts.js';
import { buildTable } from './todo-table.js';

export interface TodoViewDeps {
  readonly api: {
    get(): Promise<TodoListJson>;
    apply(op: unknown): Promise<TodoResult>;
    onChange(listener: (list: TodoListJson) => void): void;
  };
  /** 일을 맡길 수 있는 레포 이름들 */
  repos(): Promise<readonly string[]>;
  /** 오늘 날짜(YYYY-MM-DD, 이 PC의 날짜) */
  today(): string;
  /** 맡긴 작업을 채팅 탭에서 연다 */
  openJob(jobId: string): void;
}

type Mode = 'board' | 'list';

const SORT_LABEL: Readonly<Record<TodoSort, string>> = { manual: 'Board order', priority: 'By priority', due: 'By due date', created: 'Newest' };
const MODE_KEY = 'rauha.todo.mode';

// 작업이 끝나 할 일이 저절로 바뀔 때 가장 최근에 열린 화면만 갱신한다(탭을 오갈 때마다 새로 만들어지므로).
let latest: ((list: TodoListJson) => void) | null = null;
let listening = false;

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

/**
 * 할 일 탭: 노션식 칸반. 칸을 자유롭게 두고(이름·색·순서·접기·"완료로 취급") 카드를 끌어서 옮기며, 카드를 누르면 가운데 창에서 고친다.
 * AI는 선택이다. 카드마다 "팀에 맡기기"가 있지만 안 써도 된다.
 * 규칙은 TodoList(엔티티)가 지키고, 저장은 main이 한다. 화면은 요청을 보내고 돌아온 보드를 그린다.
 */
export function buildTodo(deps: TodoViewDeps) {
  const root = el('section', 'todo');
  let board = TodoList.empty();
  let filter: TodoFilter = NO_FILTER;
  let sort: TodoSort = 'manual';
  let mode: Mode = savedMode();
  let known: readonly string[] = [];
  let loaded = false;

  const notice = el('div', 'notice');
  notice.hidden = true;
  const say = (text: string): void => {
    notice.textContent = text;
    notice.hidden = text === '';
  };

  const ctx: TodoCtx = {
    board: () => board,
    filter: () => filter,
    today: deps.today,
    repos: () => [...new Set([...known, ...board.items.map((t) => t.repo).filter((r): r is string => r !== null)])].sort(),
    act: async (op) => {
      say('');
      let res: TodoResult;
      try {
        res = await deps.api.apply(op);
      } catch {
        res = { ok: false, error: 'Could not save the cards. Please try again.' };
      }
      if (res.ok) replaceFromMain(res.list);
      else say(res.error);
      return res;
    },
    open: (id) => detail.show(id),
    openJob: deps.openJob,
    quickAdd: (columnId, top = false) => {
      if (mode !== 'board') setMode('board');
      boardView.openAdder(columnId, top);
    },
  };

  const boardView = buildBoard(ctx);
  const table = buildTable(ctx);
  const detail = buildDetail(ctx, (closedId) => {
    // 닫은 카드로 키보드 초점을 돌려준다(보드가 다시 그려져도 초점 카드는 기억된다)
    if (mode === 'board') boardView.focusCard(closedId);
  });

  // ── 머리와 도구줄 ──
  const head = el('div', 'rhead');
  const modeSeg = el('div', 'seg md');
  const addButton = button('＋ New card', 'btn primary', () => ctx.quickAdd(board.columns.entry().id));
  head.append(el('b', undefined, 'Todo'), el('span', 'hint', 'Drag cards between columns, click to edit. Handing work to AI is optional.'), modeSeg, addButton);

  const tools = el('div', 'ttools bar');
  const search = el('input', 'grow');
  search.placeholder = 'Search title, notes, labels';
  search.setAttribute('aria-label', 'Search');
  search.addEventListener('input', () => {
    filter = { ...filter, text: search.value };
    render();
  });
  const toolHost = el('div', 'bar');
  tools.append(search, toolHost);

  function renderTools(): void {
    const set = (patch: Partial<TodoFilter>): void => {
      filter = { ...filter, ...patch };
      render();
    };
    const labelSel = select([['', 'All labels'] as const, ...board.labels().map((l) => [l.name, l.name] as const)], filter.label ?? '', (v) => set({ label: v === '' ? null : v }));
    const prioritySel = select([['all', 'All priorities'], ...TODO_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const)] as readonly (readonly [TodoPriority | 'all', string])[], filter.priority, (v) => set({ priority: v }));
    const repoSel = select([['', 'All repos'] as const, ...ctx.repos().map((r) => [r, r] as const)], filter.repo ?? '', (v) => set({ repo: v === '' ? null : v }));
    const late = el('label', 'tg');
    const lateBox = el('input');
    lateBox.type = 'checkbox';
    lateBox.checked = filter.overdueOnly;
    lateBox.addEventListener('change', () => set({ overdueOnly: lateBox.checked }));
    late.append(lateBox, el('span', undefined, 'Overdue only'));
    const nodes: HTMLElement[] = [labelSel, prioritySel, repoSel, late];
    if (mode === 'list') {
      nodes.push(
        select((Object.keys(SORT_LABEL) as TodoSort[]).map((s) => [s, SORT_LABEL[s]] as const), sort, (v) => {
          sort = v;
          render();
        }),
      );
    }
    const active = filter.label !== null || filter.priority !== 'all' || filter.repo !== null || filter.overdueOnly || filter.text !== '';
    if (active) {
      nodes.push(
        button('Clear filters', 'link', () => {
          filter = NO_FILTER;
          search.value = '';
          render();
        }),
      );
    }
    toolHost.replaceChildren(...nodes);
  }

  function renderMode(): void {
    modeSeg.replaceChildren();
    for (const [m, label] of [['board', 'Board'], ['list', 'List']] as const) {
      const b = el('button', m === mode ? 'on' : undefined, label);
      b.type = 'button';
      b.addEventListener('click', () => setMode(m));
      modeSeg.append(b);
    }
  }

  function setMode(next: Mode): void {
    mode = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* 저장할 수 없어도 화면은 그대로 쓴다 */
    }
    render();
  }

  // ── 몸통: 보드/목록. 카드 창은 가운데 모달이라 몸통 밖에 둔다 ──
  const body = el('div', 'tbody');
  const main = el('div', 'tmain');
  body.append(main);
  root.append(head, tools, notice, body, detail.root);

  // n: 새 카드. 글을 쓰는 중이거나 카드 창이 열려 있을 때는 건드리지 않는다.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || mode !== 'board' || detail.current() !== null) return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || t.closest('input, textarea, select, button, [contenteditable]') !== null) return;
    e.preventDefault();
    ctx.quickAdd(boardView.focusedColumn() ?? board.columns.entry().id);
  });

  function render(): void {
    renderMode();
    renderTools();
    main.replaceChildren();
    if (!loaded) {
      main.append(el('div', 'empty-state tempty', 'Loading…'));
      return;
    }
    if (mode === 'board') {
      main.append(boardView.root);
      boardView.render();
    } else {
      main.append(table.root);
      table.render(sort);
    }
    detail.refresh();
  }

  function replaceFromMain(json: TodoListJson): void {
    board = TodoListDto.from(json).toEntity();
    render();
  }

  latest = replaceFromMain;
  if (!listening) {
    listening = true;
    deps.api.onChange((json) => latest?.(json));
  }
  render();
  void deps.api.get().then(
    (json) => {
      loaded = true;
      replaceFromMain(json);
    },
    () => {
      loaded = true;
      say('Could not load the cards.');
      render();
    },
  );
  void deps.repos().then(
    (names) => {
      known = names;
      renderTools();
    },
    () => undefined,
  );

  return { root };
}

/** 채팅 등 할 일 탭 밖에서 쓰는 더하기. 화면 없이 main에 요청만 보낸다. */
export async function addTodo(api: Pick<TodoViewDeps['api'], 'apply'>, draft: { title: string; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await api.apply({ kind: 'add', ...draft });
    return res.ok ? { ok: true } : res;
  } catch {
    return { ok: false, error: 'Could not save the cards.' };
  }
}

/** 오늘 날짜(YYYY-MM-DD). 이 PC의 시간대 기준 */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
