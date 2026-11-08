import { TodoListDto, type TodoListJson, type TodoResult } from '../shared/todo-dto.js';
import { TEAM_CHOICES, TODO_PRIORITIES, TodoList, type Todo, type TodoFilter, type TodoPriority, type TodoSort, type TodoStatus } from '../shared/todo-list.js';
import { el } from './dom.js';

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

const STATUS_LABEL: Readonly<Record<TodoStatus, string>> = { todo: '할 일', doing: '진행', done: '완료' };
const COLUMNS: readonly TodoStatus[] = ['todo', 'doing', 'done'];
const PRIORITY_LABEL: Readonly<Record<TodoPriority, string>> = { high: '높음', normal: '보통', low: '낮음' };
const SORT_LABEL: Readonly<Record<TodoSort, string>> = { priority: '우선순위순', due: '마감순', created: '최신순' };

const NO_FILTER: TodoFilter = { status: 'all', priority: 'all', repo: null, team: null, text: '', overdueOnly: false };

// 작업이 끝나 할 일이 저절로 바뀔 때 가장 최근에 열린 화면만 갱신한다(탭을 오갈 때마다 새로 만들어지므로).
let latest: ((list: TodoListJson) => void) | null = null;
let listening = false;

function field(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'tfield');
  row.append(el('span', 'tlab', label), control);
  return row;
}

function select<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = el('select');
  for (const [v, label] of options) {
    const o = el('option', undefined, label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

function dueText(todo: Todo, today: string): { text: string; cls: string } | null {
  if (todo.due === null) return null;
  if (todo.isOverdue(today)) return { text: `기한 지남 · ${todo.due.slice(5)}`, cls: 'red' };
  if (todo.status !== 'done' && todo.due === today) return { text: '오늘까지', cls: 'yellow' };
  return { text: `~ ${todo.due.slice(5)}`, cls: '' };
}

/**
 * 할 일 탭: 할 일 · 진행 · 완료 세 칸. 더하기·고치기·상태 옮기기·지우기, 우선순위·마감·레포·팀, 정렬·필터, 팀에 맡기기.
 * 규칙은 TodoList(엔티티)가 지키고, 저장은 main이 한다. 화면은 요청을 보내고 돌아온 모음을 그린다.
 */
export function buildTodo(deps: TodoViewDeps) {
  const root = el('section', 'todo');
  let list = TodoList.empty();
  let filter: TodoFilter = NO_FILTER;
  let sort: TodoSort = 'priority';
  let editing: string | 'new' | null = null;
  let confirming: string | null = null;
  let known: readonly string[] = [];
  let loaded = false;

  const head = el('div', 'rhead');
  const addButton = el('button', 'btn primary', '＋ 새 할 일');
  head.append(el('b', undefined, '할 일'), el('span', 'hint', '팀에 맡길 일을 모아 두고, 맡기면 진행 칸으로 가요. 메인에서 보낸 일도 "할 일로"로 담을 수 있어요.'), addButton);

  // ── 거르기·정렬 ──
  const tools = el('div', 'ttools');
  const search = el('input');
  search.placeholder = '제목·메모 검색';
  search.addEventListener('input', () => {
    filter = { ...filter, text: search.value };
    renderBoard();
  });
  const toolHost = el('div', 'tselects');
  tools.append(search, toolHost);

  // ── 폼 ──
  const form = el('form', 'tform pane');
  form.hidden = true;
  const formTitle = el('div', 'ph');
  const fTitle = el('input');
  fTitle.placeholder = '무엇을 할까요? 예: 환불 API에 멱등키 적용';
  fTitle.maxLength = 120;
  const fNote = el('textarea');
  fNote.rows = 3;
  fNote.placeholder = '메모(팀에 맡길 때 함께 보내요)';
  const fPriority = select(TODO_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const), 'normal', () => undefined);
  const fDue = el('input');
  fDue.type = 'date';
  const fRepo = el('select');
  const fTeam = select([['', '자동(메인이 골라요)'] as const, ...TEAM_CHOICES.map((t) => [t.id, t.label] as const)], '', () => undefined);
  const fError = el('div', 'err');
  const save = el('button', 'btn primary', '더하기');
  save.type = 'submit';
  const cancel = el('button', 'btn sec', '취소');
  cancel.type = 'button';
  const fRow = el('div', 'trow');
  fRow.append(save, cancel);
  const grid = el('div', 'tgrid');
  grid.append(field('우선순위', fPriority), field('마감일', fDue), field('레포', fRepo), field('맡길 팀', fTeam));
  const fields = el('div', 'tfields');
  fields.append(fTitle, fNote, grid, fError, fRow);
  form.append(formTitle, fields);

  const board = el('div', 'tboard');
  root.append(head, tools, form, board);

  function repoOptions(selected: string | null): void {
    const names = [...new Set([...known, ...list.items.map((t) => t.repo).filter((r): r is string => r !== null), ...(selected === null ? [] : [selected])])].sort();
    fRepo.replaceChildren(...[['', '없음'] as const, ...names.map((n) => [n, n] as const)].map(([v, label]) => Object.assign(el('option', undefined, label), { value: v })));
    fRepo.value = selected ?? '';
  }

  function openForm(id: string | 'new' | null): void {
    editing = id;
    form.hidden = id === null;
    if (id === null) return;
    const todo = id === 'new' ? null : list.get(id);
    formTitle.replaceChildren(el('b', undefined, todo === null ? '새 할 일' : '할 일 고치기'));
    save.textContent = todo === null ? '더하기' : '저장';
    fTitle.value = todo?.title ?? '';
    fNote.value = todo?.note ?? '';
    fPriority.value = todo?.priority ?? 'normal';
    fDue.value = todo?.due ?? '';
    fTeam.value = todo?.team ?? '';
    repoOptions(todo?.repo ?? null);
    fError.textContent = '';
    form.scrollIntoView({ block: 'nearest' });
    fTitle.focus();
  }

  async function send(op: unknown): Promise<TodoResult> {
    let res: TodoResult;
    try {
      res = await deps.api.apply(op);
    } catch {
      res = { ok: false, error: '할 일을 저장하지 못했어요. 잠시 뒤에 다시 해 주세요.' };
    }
    if (res.ok) {
      list = TodoListDto.from(res.list).toEntity();
      renderBoard();
    }
    return res;
  }

  /** 카드 위쪽 안내 줄(맡기기가 막혔을 때 이유 등) */
  const notice = el('div', 'tnotice');
  notice.hidden = true;
  root.insertBefore(notice, board);
  function say(text: string): void {
    notice.textContent = text;
    notice.hidden = text === '';
  }

  async function act(op: unknown): Promise<void> {
    say('');
    const res = await send(op);
    if (!res.ok) say(res.error);
    else if (res.jobId !== null) deps.openJob(res.jobId);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fields = { title: fTitle.value, note: fNote.value, priority: fPriority.value, due: fDue.value === '' ? null : fDue.value, repo: fRepo.value === '' ? null : fRepo.value, team: fTeam.value === '' ? null : fTeam.value };
    void (async () => {
      const res = await send(editing === 'new' ? { kind: 'add', ...fields } : { kind: 'edit', id: editing, patch: fields });
      if (res.ok) openForm(null);
      else fError.textContent = res.error;
    })();
  });
  cancel.addEventListener('click', () => openForm(null));
  addButton.addEventListener('click', () => openForm('new'));

  function chip(text: string, cls = ''): HTMLElement {
    return el('span', `chip ${cls}`.trim(), text);
  }

  function card(todo: Todo, today: string): HTMLElement {
    const box = el('div', `tcard p-${todo.priority}${todo.status === 'done' ? ' done' : ''}`);
    const top = el('div', 'ttop');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = todo.status === 'done';
    check.title = todo.status === 'done' ? '다시 열기' : '완료로 표시';
    check.addEventListener('change', () => void act({ kind: 'move', id: todo.id, status: check.checked ? 'done' : 'todo' }));
    top.append(check, el('b', 'tt', todo.title));
    box.append(top);

    const chips = el('div', 'tchips');
    if (todo.priority !== 'normal') chips.append(chip(`우선순위 ${PRIORITY_LABEL[todo.priority]}`, todo.priority === 'high' ? 'red' : ''));
    const due = dueText(todo, today);
    if (due !== null) chips.append(chip(due.text, due.cls));
    if (todo.repo !== null) chips.append(chip(todo.repo, 'blue'));
    const team = TEAM_CHOICES.find((t) => t.id === todo.team);
    if (team !== undefined) chips.append(chip(team.label, 'purple'));
    if (todo.jobId !== null) chips.append(chip(todo.status === 'doing' ? '팀이 일하는 중' : '팀이 한 일', 'green'));
    if (chips.childElementCount > 0) box.append(chips);
    if (todo.note !== '') box.append(el('div', 'tnote', todo.note));

    const buttons = el('div', 'tbtns');
    const button = (label: string, onClick: () => void, cls = 'btn sec') => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      buttons.append(b);
    };
    if (todo.canDelegate()) button('팀에 맡기기', () => void act({ kind: 'delegate', id: todo.id }), 'btn primary');
    if (todo.status === 'todo') button('시작', () => void act({ kind: 'move', id: todo.id, status: 'doing' }));
    if (todo.status === 'doing') {
      if (todo.jobId !== null) button('진행 보기', () => deps.openJob(todo.jobId!));
      button('완료', () => void act({ kind: 'move', id: todo.id, status: 'done' }));
      button('할 일로', () => void act({ kind: 'move', id: todo.id, status: 'todo' }));
    }
    if (todo.status === 'done') button('다시 열기', () => void act({ kind: 'move', id: todo.id, status: 'todo' }));
    button('고치기', () => openForm(todo.id));
    if (confirming === todo.id) {
      button('정말 지울까요?', () => {
        confirming = null;
        void act({ kind: 'remove', id: todo.id });
      }, 'btn danger');
      button('아니요', () => {
        confirming = null;
        renderBoard();
      });
    } else {
      button('지우기', () => {
        confirming = todo.id;
        renderBoard();
      }, 'btn sec danger');
    }
    box.append(buttons);
    return box;
  }

  function renderTools(): void {
    const repos = [...new Set([...known, ...list.items.map((t) => t.repo).filter((r): r is string => r !== null)])].sort();
    const statusSel = select([['all', '상태 전체'], ...COLUMNS.map((s) => [s, STATUS_LABEL[s]] as const)] as readonly (readonly [TodoStatus | 'all', string])[], filter.status, (v) => {
      filter = { ...filter, status: v };
      renderBoard();
    });
    const prioritySel = select([['all', '우선순위 전체'], ...TODO_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const)] as readonly (readonly [TodoPriority | 'all', string])[], filter.priority, (v) => {
      filter = { ...filter, priority: v };
      renderBoard();
    });
    const repoSel = select([['', '레포 전체'] as const, ...repos.map((r) => [r, r] as const)], filter.repo ?? '', (v) => {
      filter = { ...filter, repo: v === '' ? null : v };
      renderBoard();
    });
    const teamSel = select([['', '팀 전체'] as const, ...TEAM_CHOICES.map((t) => [t.id, t.label] as const)], filter.team ?? '', (v) => {
      filter = { ...filter, team: v === '' ? null : v };
      renderBoard();
    });
    const sortSel = select((Object.keys(SORT_LABEL) as TodoSort[]).map((s) => [s, SORT_LABEL[s]] as const), sort, (v) => {
      sort = v;
      renderBoard();
    });
    const late = el('label', 'tg');
    const lateBox = el('input');
    lateBox.type = 'checkbox';
    lateBox.checked = filter.overdueOnly;
    lateBox.addEventListener('change', () => {
      filter = { ...filter, overdueOnly: lateBox.checked };
      renderBoard();
    });
    late.append(lateBox, el('span', undefined, '기한 지난 것만'));
    toolHost.replaceChildren(statusSel, prioritySel, repoSel, teamSel, sortSel, late);
  }

  function renderBoard(): void {
    renderTools();
    board.replaceChildren();
    if (!loaded) {
      board.append(el('div', 'tempty', '불러오는 중…'));
      return;
    }
    if (list.items.length === 0) {
      const empty = el('div', 'tempty');
      empty.append(el('b', undefined, '할 일이 없어요'), el('div', undefined, '＋ 새 할 일로 더하거나, 메인에서 "…할 일에 넣어 줘"라고 해도 돼요.'));
      board.append(empty);
      return;
    }
    const today = deps.today();
    const shown = list.view(filter, sort, today);
    const counts = list.counts();
    const columns = COLUMNS.filter((s) => filter.status === 'all' || filter.status === s);
    for (const status of columns) {
      const col = el('div', `tcol s-${status}`);
      const mine = shown.filter((t) => t.status === status);
      col.append(el('div', 'tch', `${STATUS_LABEL[status]} ${mine.length}${mine.length !== counts[status] ? ` / ${counts[status]}` : ''}`));
      if (mine.length === 0) col.append(el('div', 'tnone', '없어요'));
      for (const todo of mine) col.append(card(todo, today));
      board.append(col);
    }
  }

  function replaceFromMain(json: TodoListJson): void {
    list = TodoListDto.from(json).toEntity();
    renderBoard();
  }

  latest = replaceFromMain;
  if (!listening) {
    listening = true;
    deps.api.onChange((json) => latest?.(json));
  }

  renderBoard();
  void deps.api.get().then(
    (json) => {
      loaded = true;
      replaceFromMain(json);
    },
    () => {
      loaded = true;
      say('할 일을 읽지 못했어요.');
      renderBoard();
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
    return { ok: false, error: '할 일을 저장하지 못했어요.' };
  }
}

/** 오늘 날짜(YYYY-MM-DD). 이 PC의 시간대 기준 */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
