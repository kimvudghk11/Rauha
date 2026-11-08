/**
 * 할 일 탭의 규칙(노션식 칸반). 카드(Todo)와 보드(TodoList: 칸 + 카드 순서)가 스스로 규칙을 지킨다.
 * 값은 불변이다. 바꾸는 메서드는 새 값을 돌려준다(저장·화면 갱신은 바깥이 맡는다).
 * 날짜는 문자열(YYYY-MM-DD, 시각은 ISO)로만 다뤄서 시계·시간대에 기대지 않는다.
 * 카드는 한 줄 배열에 들어 있고, 한 칸 안의 순서는 그 배열에서의 상대 순서다(todo-order.ts).
 */
import { Checklist, ChecklistError, type ChecklistItem } from './todo-checklist.js';
import { Columns, TodoColumnError, isColumnColor, type Column, type ColumnColor } from './todo-columns.js';
import { place } from './todo-order.js';

export type TodoPriority = 'high' | 'normal' | 'low';
export type TodoSort = 'manual' | 'priority' | 'due' | 'created';

export const TODO_PRIORITIES: readonly TodoPriority[] = ['high', 'normal', 'low'];

/** 맡길 팀 고르기. null(자동)이면 메인이 알아서 고른다. 부서 이름은 core의 부서와 같다. */
export const TEAM_CHOICES: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'dev', label: '개발부' },
  { id: 'planning', label: '기획·전략부' },
  { id: 'marketing', label: '마케팅·그로스부' },
  { id: 'design', label: '디자인부' },
  { id: 'quality', label: '품질·보안부' },
  { id: 'operations', label: '운영·유지보수부' },
];

export const TITLE_LIMIT = 120;
export const NOTE_LIMIT = 2000;
export const LABEL_MAX = 8;
export const LABEL_NAME_LIMIT = 20;
const NAME_LIMIT = 80;
/** 한 사람이 쓰는 앱이라 이 정도면 넘칠 일이 없다. 파일이 끝없이 커지는 것만 막는다. */
export const MAX_TODOS = 500;

export class TodoError extends Error {}

export interface Label {
  readonly name: string;
  readonly color: ColumnColor;
}

export interface TodoProps {
  readonly id: string;
  readonly title: string;
  /** 설명(여러 줄) */
  readonly note: string;
  readonly columnId: string;
  readonly priority: TodoPriority;
  /** YYYY-MM-DD 또는 null(마감 없음) */
  readonly due: string | null;
  /** 레포(폴더) 이름. 레포가 나중에 사라져도 이름은 남는다. */
  readonly repo: string | null;
  readonly team: string | null;
  readonly labels: readonly Label[];
  readonly checklist: readonly ChecklistItem[];
  /** 팀에 맡겼으면 그 작업 번호 */
  readonly jobId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

type Fields = Pick<TodoProps, 'title' | 'note' | 'priority' | 'due' | 'repo' | 'team' | 'labels' | 'checklist'>;

export interface TodoDraft {
  readonly title: string;
  readonly note?: string;
  readonly priority?: TodoPriority;
  readonly due?: string | null;
  readonly repo?: string | null;
  readonly team?: string | null;
  readonly labels?: readonly Label[];
  readonly checklist?: readonly ChecklistItem[];
  /** 넣을 칸. 비우면 새 카드가 들어가는 첫 칸 */
  readonly columnId?: string;
}

export type TodoPatch = Partial<Omit<TodoDraft, 'columnId'>>;

export interface TodoFilter {
  /** 칸 번호 또는 'all' */
  readonly column: string;
  readonly priority: TodoPriority | 'all';
  readonly repo: string | null;
  readonly team: string | null;
  readonly label: string | null;
  readonly text: string;
  readonly overdueOnly: boolean;
}

function validDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function checkedLabels(labels: readonly Label[]): readonly Label[] {
  if (labels.length > LABEL_MAX) throw new TodoError(`라벨은 ${LABEL_MAX}개까지예요.`);
  const seen = new Set<string>();
  return labels.map((l) => {
    const name = l.name.trim();
    if (name === '') throw new TodoError('라벨 이름을 적어 주세요.');
    if (name.length > LABEL_NAME_LIMIT) throw new TodoError(`라벨 이름은 ${LABEL_NAME_LIMIT}자까지예요.`);
    if (!isColumnColor(l.color)) throw new TodoError('고를 수 없는 라벨 색이에요.');
    const key = name.toLowerCase();
    if (seen.has(key)) throw new TodoError('같은 라벨이 두 번 들어 있어요.');
    seen.add(key);
    return { name, color: l.color };
  });
}

function checkedChecklist(items: readonly ChecklistItem[]): readonly ChecklistItem[] {
  try {
    return Checklist.restore(items).items;
  } catch (error) {
    if (error instanceof ChecklistError) throw new TodoError(error.message);
    throw error;
  }
}

/** 입력 하나하나의 규칙. 만들 때와 고칠 때 같은 검사를 쓴다. */
function checked(fields: Fields): Fields {
  const title = fields.title.trim();
  if (title === '') throw new TodoError('할 일 제목을 적어 주세요.');
  if (title.length > TITLE_LIMIT) throw new TodoError(`제목은 ${TITLE_LIMIT}자까지예요.`);
  const note = fields.note.trim();
  if (note.length > NOTE_LIMIT) throw new TodoError(`메모는 ${NOTE_LIMIT}자까지예요.`);
  if (!TODO_PRIORITIES.includes(fields.priority)) throw new TodoError('우선순위는 높음·보통·낮음 중에서 골라 주세요.');
  const due = fields.due === null || fields.due.trim() === '' ? null : fields.due.trim();
  if (due !== null && !validDate(due)) throw new TodoError('마감일은 YYYY-MM-DD 모양의 실제 날짜로 적어 주세요.');
  const repo = fields.repo === null || fields.repo.trim() === '' ? null : fields.repo.trim();
  if (repo !== null && repo.length > NAME_LIMIT) throw new TodoError(`레포 이름은 ${NAME_LIMIT}자까지예요.`);
  const team = fields.team === null || fields.team.trim() === '' ? null : fields.team.trim();
  if (team !== null && !TEAM_CHOICES.some((t) => t.id === team)) throw new TodoError('고를 수 없는 팀이에요.');
  return { title, note, priority: fields.priority, due, repo, team, labels: checkedLabels(fields.labels), checklist: checkedChecklist(fields.checklist) };
}

/** 카드 하나 */
export class Todo {
  private constructor(private readonly props: TodoProps) {}

  /** 저장 파일에서 다시 만든다(규칙을 한 번 더 검사한다). */
  static restore(props: TodoProps): Todo {
    if (props.id === '') throw new TodoError('할 일 번호가 없어요.');
    if (props.columnId === '') throw new TodoError('칸 번호가 없어요.');
    return new Todo({ ...props, ...checked(props), jobId: props.jobId === '' ? null : props.jobId });
  }

  static create(draft: TodoDraft, id: string, columnId: string, at: string): Todo {
    const fields = checked({ title: draft.title, note: draft.note ?? '', priority: draft.priority ?? 'normal', due: draft.due ?? null, repo: draft.repo ?? null, team: draft.team ?? null, labels: draft.labels ?? [], checklist: draft.checklist ?? [] });
    return Todo.restore({ id, ...fields, columnId, jobId: null, createdAt: at, updatedAt: at, completedAt: null });
  }

  get id(): string { return this.props.id; }
  get title(): string { return this.props.title; }
  get note(): string { return this.props.note; }
  get columnId(): string { return this.props.columnId; }
  get priority(): TodoPriority { return this.props.priority; }
  get due(): string | null { return this.props.due; }
  get repo(): string | null { return this.props.repo; }
  get team(): string | null { return this.props.team; }
  get labels(): readonly Label[] { return this.props.labels; }
  get jobId(): string | null { return this.props.jobId; }
  get createdAt(): string { return this.props.createdAt; }
  get updatedAt(): string { return this.props.updatedAt; }
  get completedAt(): string | null { return this.props.completedAt; }
  get checklist(): Checklist { return Checklist.restore(this.props.checklist); }

  /** 마감이 오늘보다 앞이고 아직 끝나지 않았다(끝났는지는 카드가 있는 칸이 정해서 done으로 받는다). today는 YYYY-MM-DD. */
  isOverdue(today: string, done: boolean): boolean {
    return !done && this.props.due !== null && today !== '' && this.props.due < today;
  }

  /** 팀에 맡길 수 있다: 완료 칸이 아니고 일하는 중인 작업이 없다. */
  canDelegate(done: boolean): boolean {
    return !done && this.props.jobId === null;
  }

  /** 맡길 수 없는 이유를 알려 주며 던진다. */
  assertCanDelegate(done: boolean): void {
    if (done) throw new TodoError('이미 끝난 할 일은 맡기지 않아요. 다시 열고 맡겨 주세요.');
    if (this.props.jobId !== null) throw new TodoError('이미 팀이 일하고 있어요.');
  }

  withFields(patch: TodoPatch, at: string): Todo {
    const next = checked({
      title: patch.title ?? this.props.title,
      note: patch.note ?? this.props.note,
      priority: patch.priority ?? this.props.priority,
      due: patch.due === undefined ? this.props.due : patch.due,
      repo: patch.repo === undefined ? this.props.repo : patch.repo,
      team: patch.team === undefined ? this.props.team : patch.team,
      labels: patch.labels ?? this.props.labels,
      checklist: patch.checklist ?? this.props.checklist,
    });
    return new Todo({ ...this.props, ...next, updatedAt: at });
  }

  /** 다른 칸으로 옮긴다. 완료 칸이면 끝낸 시각이 남고, 아니면 지워진다. 작업 번호는 그대로 둔다. */
  movedTo(columnId: string, done: boolean, at: string): Todo {
    if (columnId === '') throw new TodoError('칸 번호가 없어요.');
    const completedAt = done ? (this.props.columnId === columnId && this.props.completedAt !== null ? this.props.completedAt : at) : null;
    return new Todo({ ...this.props, columnId, completedAt, updatedAt: at });
  }

  /** 시각을 바꾸지 않고 칸만 맞춘다(저장 파일의 칸이 사라졌을 때) */
  repairedInto(columnId: string): Todo {
    return new Todo({ ...this.props, columnId });
  }

  withJob(jobId: string, columnId: string, at: string): Todo {
    return new Todo({ ...this.props, jobId, columnId, completedAt: null, updatedAt: at });
  }

  withoutJob(at: string): Todo {
    return new Todo({ ...this.props, jobId: null, updatedAt: at });
  }

  matches(filter: TodoFilter, today: string, done: boolean): boolean {
    if (filter.column !== 'all' && this.props.columnId !== filter.column) return false;
    if (filter.priority !== 'all' && this.props.priority !== filter.priority) return false;
    if (filter.repo !== null && this.props.repo !== filter.repo) return false;
    if (filter.team !== null && this.props.team !== filter.team) return false;
    if (filter.label !== null && !this.props.labels.some((l) => l.name.toLowerCase() === filter.label!.toLowerCase())) return false;
    if (filter.overdueOnly && !this.isOverdue(today, done)) return false;
    const text = filter.text.trim().toLowerCase();
    if (text === '') return true;
    const haystack = [this.props.title, this.props.note, ...this.props.labels.map((l) => l.name), ...this.props.checklist.map((c) => c.text)].join('\n');
    return haystack.toLowerCase().includes(text);
  }
}

const PRIORITY_RANK: Readonly<Record<TodoPriority, number>> = { high: 0, normal: 1, low: 2 };
const dueRank = (t: Todo): string => t.due ?? '9999-99-99';

/** 칸을 지울 때 그 칸의 카드를 어떻게 할지 */
export type RemoveCards = 'merge' | 'delete';

/** 보드: 칸 + 카드 */
export class TodoList {
  private constructor(
    readonly columns: Columns,
    readonly items: readonly Todo[],
  ) {}

  static empty(): TodoList {
    return new TodoList(Columns.defaults(), []);
  }

  /** 저장 파일에서 다시 만든다. 사라진 칸에 매인 카드는 새 카드가 들어가는 첫 칸으로 모은다. */
  static restore(items: readonly Todo[], columns: Columns = Columns.defaults()): TodoList {
    const entry = columns.entry().id;
    return new TodoList(columns, items.slice(0, MAX_TODOS).map((t) => (columns.has(t.columnId) ? t : t.repairedInto(entry))));
  }

  get(id: string): Todo | null {
    return this.items.find((t) => t.id === id) ?? null;
  }

  /** 번호로 찾는다. 없으면 던진다. */
  require(id: string): Todo {
    const found = this.get(id);
    if (found === null) throw new TodoError('그 할 일을 찾지 못했어요. 이미 지워졌을 수 있어요.');
    return found;
  }

  isDone(todo: Todo): boolean {
    return this.columns.isDone(todo.columnId);
  }

  isOverdue(todo: Todo, today: string): boolean {
    return todo.isOverdue(today, this.isDone(todo));
  }

  canDelegate(todo: Todo): boolean {
    return todo.canDelegate(this.isDone(todo));
  }

  /** 팀에 맡길 수 없으면 이유를 알려 주며 던진다. */
  assertCanDelegate(id: string): void {
    const todo = this.require(id);
    todo.assertCanDelegate(this.isDone(todo));
  }

  /** 한 칸의 카드(칸 안 순서대로) */
  cardsIn(columnId: string): readonly Todo[] {
    return this.items.filter((t) => t.columnId === columnId);
  }

  // ── 카드 ──

  /** 새 카드는 칸 맨 아래에 붙는다(칸을 안 정하면 새 카드가 들어가는 첫 칸). */
  add(draft: TodoDraft, newId: () => string, at: string): TodoList {
    if (this.items.length >= MAX_TODOS) throw new TodoError(`할 일은 최대 ${MAX_TODOS}개까지예요. 끝난 것부터 지워 주세요.`);
    const columnId = draft.columnId ?? this.columns.entry().id;
    this.requireColumn(columnId);
    const made = Todo.create(draft, newId(), columnId, at);
    return this.withItems(place([...this.items, made], made.id, columnId, null, (t) => t));
  }

  edit(id: string, patch: TodoPatch, at: string): TodoList {
    return this.replace(id, (t) => t.withFields(patch, at));
  }

  /** 카드를 columnId 칸의 beforeId 카드 앞(null이면 맨 아래)으로 옮긴다. 칸 안에서 순서만 바꿔도 된다. */
  move(id: string, columnId: string, beforeId: string | null, at: string): TodoList {
    this.require(id);
    this.requireColumn(columnId);
    const done = this.columns.isDone(columnId);
    return this.withItems(place(this.items, id, columnId, beforeId, (t) => (t.columnId === columnId ? t : t.movedTo(columnId, done, at))));
  }

  remove(id: string): TodoList {
    this.require(id);
    return this.withItems(this.items.filter((t) => t.id !== id));
  }

  /** 팀에 맡긴 일의 작업 번호를 붙이고 "팀이 일하는 칸"으로 보낸다(그런 칸이 없으면 제자리). */
  attachJob(id: string, jobId: string, at: string): TodoList {
    const todo = this.require(id);
    todo.assertCanDelegate(this.isDone(todo));
    const target = this.columns.work()?.id ?? todo.columnId;
    return this.withItems(place(this.items, id, target, null, (t) => t.withJob(jobId, target, at)));
  }

  /** 맡긴 작업이 끝나면 완료 칸으로, 멈추면 첫 칸으로 돌린다. 그 사이 사람이 일하는 칸 밖으로 옮겨 뒀으면 건드리지 않는다. */
  jobFinished(jobId: string, outcome: 'done' | 'stopped', at: string): TodoList {
    const target = this.items.find((t) => t.jobId === jobId);
    if (target === undefined || !this.inWorkColumn(target)) return this;
    if (outcome === 'done') {
      const done = this.columns.firstDone();
      if (done === null) return this;
      return this.withItems(place(this.items, target.id, done.id, null, (t) => t.movedTo(done.id, true, at)));
    }
    return this.releaseTo(target, at);
  }

  /** 앱을 다시 켰을 때, 지금 살아 있지 않은 작업에 매인 "일하는 칸"의 카드를 첫 칸으로 돌린다. */
  releaseOrphans(liveJobIds: ReadonlySet<string>): TodoList {
    const stale = this.items.filter((t) => t.jobId !== null && this.inWorkColumn(t) && !liveJobIds.has(t.jobId));
    if (stale.length === 0) return this;
    return stale.reduce<TodoList>((list, t) => list.releaseTo(t, t.updatedAt), this);
  }

  // ── 칸 ──

  addColumn(name: string, color: ColumnColor, newId: () => string): TodoList {
    return this.withColumns(() => this.columns.add(name, color, newId()));
  }

  renameColumn(id: string, name: string): TodoList {
    return this.withColumns(() => this.columns.rename(id, name));
  }

  recolorColumn(id: string, color: ColumnColor): TodoList {
    return this.withColumns(() => this.columns.recolor(id, color));
  }

  setColumnDone(id: string, done: boolean): TodoList {
    return this.withColumns(() => this.columns.setDone(id, done));
  }

  setColumnWork(id: string, work: boolean): TodoList {
    return this.withColumns(() => this.columns.setWork(id, work));
  }

  collapseColumn(id: string, collapsed: boolean): TodoList {
    return this.withColumns(() => this.columns.collapse(id, collapsed));
  }

  moveColumn(id: string, beforeId: string | null): TodoList {
    return this.withColumns(() => this.columns.move(id, beforeId));
  }

  /** 칸을 지운다. 카드는 앞 칸(첫 칸이면 다음 칸) 맨 아래로 옮기거나 함께 지운다. */
  removeColumn(id: string, cards: RemoveCards, at: string): TodoList {
    const landing = this.withColumns(() => this.columns.remove(id)).columns;
    const landingId = this.columns.landingFor(id);
    const mine = this.cardsIn(id);
    if (cards === 'delete') return new TodoList(landing, this.items.filter((t) => t.columnId !== id));
    const done = landing.isDone(landingId);
    const moved = mine.reduce<readonly Todo[]>((items, t) => place(items, t.id, landingId, null, (x) => x.movedTo(landingId, done, at)), this.items);
    return new TodoList(landing, moved);
  }

  // ── 보기 ──

  /** 거르고 정렬한 보기. today를 주면 기한 지남을 가릴 수 있다. manual은 보드 순서(칸 순서 → 칸 안 순서). */
  view(filter: TodoFilter, sort: TodoSort, today = ''): readonly Todo[] {
    const kept = this.items.filter((t) => t.matches(filter, today, this.isDone(t)));
    const columnRank = (t: Todo): number => this.columns.items.findIndex((c) => c.id === t.columnId);
    const compare = (a: Todo, b: Todo): number => {
      const key = (t: Todo): string => (sort === 'due' ? dueRank(t) : `${PRIORITY_RANK[t.priority]}${dueRank(t)}`);
      switch (sort) {
        case 'manual':
          return columnRank(a) - columnRank(b);
        case 'created':
          return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
        default:
          return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
      }
    };
    // 정렬은 안정적이라 같은 값이면 보드 순서가 남는다.
    return [...kept].sort(compare);
  }

  /** 칸마다 카드 수 */
  counts(): Readonly<Record<string, number>> {
    const c: Record<string, number> = {};
    for (const col of this.columns.items) c[col.id] = 0;
    for (const t of this.items) c[t.columnId] = (c[t.columnId] ?? 0) + 1;
    return c;
  }

  /** 카드에 붙은 라벨 모두(이름 기준으로 하나씩, 처음 나온 색) */
  labels(): readonly Label[] {
    const seen = new Map<string, Label>();
    for (const t of this.items) for (const l of t.labels) if (!seen.has(l.name.toLowerCase())) seen.set(l.name.toLowerCase(), l);
    return [...seen.values()];
  }

  private inWorkColumn(todo: Todo): boolean {
    return this.columns.work()?.id === todo.columnId;
  }

  private releaseTo(todo: Todo, at: string): TodoList {
    const entry = this.columns.entry().id;
    return this.withItems(place(this.items, todo.id, entry, null, (t) => t.movedTo(entry, this.columns.isDone(entry), at).withoutJob(at)));
  }

  private requireColumn(id: string): Column {
    const found = this.columns.get(id);
    if (found === null) throw new TodoError('그 칸을 찾지 못했어요.');
    return found;
  }

  private withItems(items: readonly Todo[]): TodoList {
    return new TodoList(this.columns, items);
  }

  private withColumns(change: () => Columns): TodoList {
    try {
      return new TodoList(change(), this.items);
    } catch (error) {
      if (error instanceof TodoColumnError) throw new TodoError(error.message);
      throw error;
    }
  }

  private replace(id: string, change: (t: Todo) => Todo): TodoList {
    const found = this.require(id);
    const next = change(found);
    return this.withItems(this.items.map((t) => (t === found ? next : t)));
  }
}
