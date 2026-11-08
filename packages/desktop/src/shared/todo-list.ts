/**
 * 할 일 탭의 규칙. 할 일 하나(Todo)와 할 일 모음(TodoList)이 스스로 규칙을 지킨다.
 * 값은 불변이다. 바꾸는 메서드는 새 모음을 돌려준다(저장·화면 갱신은 바깥이 맡는다).
 * 날짜는 문자열(YYYY-MM-DD, 시각은 ISO)로만 다뤄서 시계·시간대에 기대지 않는다.
 */

export type TodoStatus = 'todo' | 'doing' | 'done';
export type TodoPriority = 'high' | 'normal' | 'low';
export type TodoSort = 'priority' | 'due' | 'created';

export const TODO_STATUSES: readonly TodoStatus[] = ['todo', 'doing', 'done'];
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
const NAME_LIMIT = 80;
/** 한 사람이 쓰는 앱이라 이 정도면 넘칠 일이 없다. 파일이 끝없이 커지는 것만 막는다. */
export const MAX_TODOS = 500;

export class TodoError extends Error {}

export interface TodoProps {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly status: TodoStatus;
  readonly priority: TodoPriority;
  /** YYYY-MM-DD 또는 null(마감 없음) */
  readonly due: string | null;
  /** 레포(폴더) 이름. 레포가 나중에 사라져도 이름은 남는다. */
  readonly repo: string | null;
  readonly team: string | null;
  /** 팀에 맡겼으면 그 작업 번호 */
  readonly jobId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface TodoDraft {
  readonly title: string;
  readonly note?: string;
  readonly priority?: TodoPriority;
  readonly due?: string | null;
  readonly repo?: string | null;
  readonly team?: string | null;
}

export type TodoPatch = Partial<TodoDraft>;

export interface TodoFilter {
  readonly status: TodoStatus | 'all';
  readonly priority: TodoPriority | 'all';
  readonly repo: string | null;
  readonly team: string | null;
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

/** 입력 하나하나의 규칙. 만들 때와 고칠 때 같은 검사를 쓴다. */
function checked(fields: Pick<TodoProps, 'title' | 'note' | 'priority' | 'due' | 'repo' | 'team'>): Pick<TodoProps, 'title' | 'note' | 'priority' | 'due' | 'repo' | 'team'> {
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
  return { title, note, priority: fields.priority, due, repo, team };
}

/** 할 일 하나 */
export class Todo {
  private constructor(private readonly props: TodoProps) {}

  /** 저장 파일에서 다시 만든다(규칙을 한 번 더 검사한다). */
  static restore(props: TodoProps): Todo {
    if (props.id === '') throw new TodoError('할 일 번호가 없어요.');
    if (!TODO_STATUSES.includes(props.status)) throw new TodoError('모르는 상태예요.');
    return new Todo({ ...props, ...checked(props), jobId: props.jobId === '' ? null : props.jobId });
  }

  static create(draft: TodoDraft, id: string, at: string): Todo {
    const fields = checked({ title: draft.title, note: draft.note ?? '', priority: draft.priority ?? 'normal', due: draft.due ?? null, repo: draft.repo ?? null, team: draft.team ?? null });
    return Todo.restore({ id, ...fields, status: 'todo', jobId: null, createdAt: at, updatedAt: at, completedAt: null });
  }

  get id(): string { return this.props.id; }
  get title(): string { return this.props.title; }
  get note(): string { return this.props.note; }
  get status(): TodoStatus { return this.props.status; }
  get priority(): TodoPriority { return this.props.priority; }
  get due(): string | null { return this.props.due; }
  get repo(): string | null { return this.props.repo; }
  get team(): string | null { return this.props.team; }
  get jobId(): string | null { return this.props.jobId; }
  get createdAt(): string { return this.props.createdAt; }
  get updatedAt(): string { return this.props.updatedAt; }
  get completedAt(): string | null { return this.props.completedAt; }

  /** 마감이 오늘보다 앞이고 아직 끝나지 않았다. today는 YYYY-MM-DD. */
  isOverdue(today: string): boolean {
    return this.props.status !== 'done' && this.props.due !== null && today !== '' && this.props.due < today;
  }

  /** 팀에 맡길 수 있다: 아직 안 했고 일하는 중인 작업이 없다. */
  canDelegate(): boolean {
    return this.props.status === 'todo' && this.props.jobId === null;
  }

  /** 맡길 수 없는 이유를 알려 주며 던진다. */
  assertCanDelegate(): void {
    if (this.props.status === 'done') throw new TodoError('이미 끝난 할 일은 맡기지 않아요. 다시 열고 맡겨 주세요.');
    if (!this.canDelegate()) throw new TodoError('이미 팀이 일하고 있어요.');
  }

  withFields(patch: TodoPatch, at: string): Todo {
    const next = checked({
      title: patch.title ?? this.props.title,
      note: patch.note ?? this.props.note,
      priority: patch.priority ?? this.props.priority,
      due: patch.due === undefined ? this.props.due : patch.due,
      repo: patch.repo === undefined ? this.props.repo : patch.repo,
      team: patch.team === undefined ? this.props.team : patch.team,
    });
    return new Todo({ ...this.props, ...next, updatedAt: at });
  }

  movedTo(status: TodoStatus, at: string): Todo {
    if (!TODO_STATUSES.includes(status)) throw new TodoError('모르는 상태예요.');
    // 작업 번호는 그대로 둔다. 사람이 옮겨 둔 할 일은 작업이 끝나도 상태를 바꾸지 않는다(jobFinished 참고).
    return new Todo({ ...this.props, status, completedAt: status === 'done' ? at : null, updatedAt: at });
  }

  withJob(jobId: string, at: string): Todo {
    return new Todo({ ...this.props, jobId, status: 'doing', completedAt: null, updatedAt: at });
  }

  withoutJob(at: string): Todo {
    return new Todo({ ...this.props, jobId: null, updatedAt: at });
  }

  matches(filter: TodoFilter, today: string): boolean {
    if (filter.status !== 'all' && this.props.status !== filter.status) return false;
    if (filter.priority !== 'all' && this.props.priority !== filter.priority) return false;
    if (filter.repo !== null && this.props.repo !== filter.repo) return false;
    if (filter.team !== null && this.props.team !== filter.team) return false;
    if (filter.overdueOnly && !this.isOverdue(today)) return false;
    const text = filter.text.trim().toLowerCase();
    return text === '' || `${this.props.title}\n${this.props.note}`.toLowerCase().includes(text);
  }
}

const PRIORITY_RANK: Readonly<Record<TodoPriority, number>> = { high: 0, normal: 1, low: 2 };
const dueRank = (t: Todo): string => t.due ?? '9999-99-99';

/** 할 일 모음 */
export class TodoList {
  private constructor(readonly items: readonly Todo[]) {}

  static empty(): TodoList {
    return new TodoList([]);
  }

  static restore(items: readonly Todo[]): TodoList {
    return new TodoList(items.slice(0, MAX_TODOS));
  }

  get(id: string): Todo | null {
    return this.items.find((t) => t.id === id) ?? null;
  }

  add(draft: TodoDraft, newId: () => string, at: string): TodoList {
    if (this.items.length >= MAX_TODOS) throw new TodoError(`할 일은 최대 ${MAX_TODOS}개까지예요. 끝난 것부터 지워 주세요.`);
    return new TodoList([Todo.create(draft, newId(), at), ...this.items]);
  }

  edit(id: string, patch: TodoPatch, at: string): TodoList {
    return this.replace(id, (t) => t.withFields(patch, at));
  }

  move(id: string, status: TodoStatus, at: string): TodoList {
    return this.replace(id, (t) => t.movedTo(status, at));
  }

  remove(id: string): TodoList {
    this.need(id);
    return new TodoList(this.items.filter((t) => t.id !== id));
  }

  /** 팀에 맡긴 일의 작업 번호를 붙이고 "진행"으로 보낸다. */
  attachJob(id: string, jobId: string, at: string): TodoList {
    return this.replace(id, (t) => {
      t.assertCanDelegate();
      return t.withJob(jobId, at);
    });
  }

  /** 맡긴 작업이 끝나면 완료로, 멈추면 "할 일"로 돌린다. 그 사이 사람이 다른 칸으로 옮겨 뒀으면 건드리지 않는다. */
  jobFinished(jobId: string, outcome: 'done' | 'stopped', at: string): TodoList {
    const target = this.items.find((t) => t.jobId === jobId);
    if (target === undefined || target.status !== 'doing') return this;
    return this.replace(target.id, (t) => (outcome === 'done' ? t.movedTo('done', at) : t.movedTo('todo', at).withoutJob(at)));
  }

  /** 앱을 다시 켰을 때, 지금 살아 있지 않은 작업에 매인 "진행"을 "할 일"로 돌린다. */
  releaseOrphans(liveJobIds: ReadonlySet<string>): TodoList {
    const stale = this.items.filter((t) => t.status === 'doing' && t.jobId !== null && !liveJobIds.has(t.jobId));
    if (stale.length === 0) return this;
    return new TodoList(this.items.map((t) => (stale.includes(t) ? t.movedTo('todo', t.updatedAt).withoutJob(t.updatedAt) : t)));
  }

  /** 거르고 정렬한 보기. today를 주면 기한 지남을 가릴 수 있다. */
  view(filter: TodoFilter, sort: TodoSort, today = ''): readonly Todo[] {
    const kept = this.items.filter((t) => t.matches(filter, today));
    if (sort === 'created') return kept;
    const key = (t: Todo): string => (sort === 'due' ? dueRank(t) : `${PRIORITY_RANK[t.priority]}${dueRank(t)}`);
    // 정렬은 안정적이라 같은 값이면 목록 순서(최신 먼저)가 남는다.
    return [...kept].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  counts(): Readonly<Record<TodoStatus, number>> {
    const c = { todo: 0, doing: 0, done: 0 };
    for (const t of this.items) c[t.status] += 1;
    return c;
  }

  private need(id: string): Todo {
    const found = this.get(id);
    if (found === null) throw new TodoError('그 할 일을 찾지 못했어요. 이미 지워졌을 수 있어요.');
    return found;
  }

  private replace(id: string, change: (t: Todo) => Todo): TodoList {
    const found = this.need(id);
    const next = change(found);
    return new TodoList(this.items.map((t) => (t === found ? next : t)));
  }
}
