import { NOTE_LIMIT, TEAM_CHOICES, Todo, TodoError, TodoList, TODO_PRIORITIES, TODO_STATUSES, TITLE_LIMIT, type TodoDraft, type TodoPatch, type TodoPriority, type TodoProps, type TodoStatus } from './todo-list.js';

/** 저장 파일·화면에서 오가는 할 일 하나(글자·숫자뿐) */
export type TodoJson = TodoProps;

export interface TodoListJson {
  readonly version: 1;
  readonly items: readonly TodoJson[];
}

/** 화면이 main에 보내는 요청. 어떤 모양이든 DTO가 검사해서 이 모양이 된다. */
export type TodoOp =
  | { readonly kind: 'add'; readonly draft: TodoDraft }
  | { readonly kind: 'edit'; readonly id: string; readonly patch: TodoPatch }
  | { readonly kind: 'move'; readonly id: string; readonly status: TodoStatus }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'delegate'; readonly id: string };

/** main이 화면에 돌려주는 결과 */
export type TodoResult = { readonly ok: true; readonly list: TodoListJson; readonly jobId: string | null } | { readonly ok: false; readonly error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, fallback?: string): string {
  if (typeof v === 'string') return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new TodoError(`${field} 값이 글자가 아니에요.`);
}

function textOrNull(v: unknown, field: string): string | null {
  if (v === null) return null;
  return text(v, field);
}

function priority(v: unknown): TodoPriority {
  if (typeof v === 'string' && (TODO_PRIORITIES as readonly string[]).includes(v)) return v as TodoPriority;
  throw new TodoError('우선순위는 높음·보통·낮음 중에서 골라 주세요.');
}

function status(v: unknown): TodoStatus {
  if (typeof v === 'string' && (TODO_STATUSES as readonly string[]).includes(v)) return v as TodoStatus;
  throw new TodoError('모르는 상태예요.');
}

/** 바깥 입력의 모양만 확인해 초안·고침으로 바꾼다(값의 규칙은 엔티티가 검사한다). */
function patchOf(input: unknown): TodoPatch {
  if (!isObject(input)) throw new TodoError('고칠 값이 없어요.');
  const out: { -readonly [K in keyof TodoPatch]: TodoPatch[K] } = {};
  if (input['title'] !== undefined) out.title = text(input['title'], '제목');
  if (input['note'] !== undefined) out.note = text(input['note'], '메모');
  if (input['priority'] !== undefined) out.priority = priority(input['priority']);
  if (input['due'] !== undefined) out.due = textOrNull(input['due'], '마감일');
  if (input['repo'] !== undefined) out.repo = textOrNull(input['repo'], '레포');
  if (input['team'] !== undefined) out.team = textOrNull(input['team'], '팀');
  return out;
}

function jsonOf(t: Todo): TodoJson {
  return { id: t.id, title: t.title, note: t.note, status: t.status, priority: t.priority, due: t.due, repo: t.repo, team: t.team, jobId: t.jobId, createdAt: t.createdAt, updatedAt: t.updatedAt, completedAt: t.completedAt };
}

/** 할 일 모음 ↔ 저장 파일. 깨진 항목은 건너뛰고 나머지로 연다(몇 개 건너뛰었는지 알려, 저장 전에 원본을 남기게 한다). */
export class TodoListDto {
  private constructor(
    readonly json: TodoListJson,
    /** 읽다가 건너뛴 항목 수 */
    readonly skipped: number,
  ) {}

  static from(input: unknown): TodoListDto {
    const raw = isObject(input) && Array.isArray(input['items']) ? input['items'] : [];
    const seen = new Set<string>();
    const items: TodoJson[] = [];
    let skipped = 0;
    for (const item of raw) {
      try {
        if (!isObject(item)) throw new TodoError('항목이 객체가 아니에요.');
        const createdAt = text(item['createdAt'], '만든 시각');
        const todo = Todo.restore({
          id: text(item['id'], 'id'),
          title: text(item['title'], '제목'),
          note: text(item['note'], '메모', ''),
          status: status(item['status']),
          priority: priority(item['priority'] ?? 'normal'),
          due: item['due'] === undefined ? null : textOrNull(item['due'], '마감일'),
          repo: item['repo'] === undefined ? null : textOrNull(item['repo'], '레포'),
          team: item['team'] === undefined ? null : textOrNull(item['team'], '팀'),
          jobId: item['jobId'] === undefined ? null : textOrNull(item['jobId'], '작업'),
          createdAt,
          updatedAt: text(item['updatedAt'], '고친 시각', createdAt),
          completedAt: item['completedAt'] === undefined ? null : textOrNull(item['completedAt'], '끝낸 시각'),
        });
        if (seen.has(todo.id)) continue;
        seen.add(todo.id);
        items.push(jsonOf(todo));
      } catch (error) {
        if (!(error instanceof TodoError)) throw error;
        skipped += 1;
      }
    }
    return new TodoListDto({ version: 1, items }, skipped);
  }

  static fromEntity(list: TodoList): TodoListDto {
    return new TodoListDto({ version: 1, items: list.items.map(jsonOf) }, 0);
  }

  toEntity(): TodoList {
    return TodoList.restore(this.json.items.map((p) => Todo.restore(p)));
  }

  toJSON(): TodoListJson {
    return this.json;
  }
}

/** 화면의 요청 하나. 모양을 검사하고, 맡기기만 빼고는 모음에 직접 적용한다. */
export class TodoOpDto {
  private constructor(private readonly op: TodoOp) {}

  static from(input: unknown): TodoOpDto {
    if (!isObject(input)) throw new TodoError('요청 모양이 올바르지 않아요.');
    const kind = input['kind'];
    const id = (): string => {
      const v = input['id'];
      if (typeof v !== 'string' || v === '') throw new TodoError('할 일 번호가 없어요.');
      return v;
    };
    switch (kind) {
      case 'add':
        return new TodoOpDto({ kind, draft: { ...patchOf(input), title: text(input['title'], '제목') } });
      case 'edit':
        return new TodoOpDto({ kind, id: id(), patch: patchOf(input['patch']) });
      case 'move':
        return new TodoOpDto({ kind, id: id(), status: status(input['status']) });
      case 'remove':
        return new TodoOpDto({ kind, id: id() });
      case 'delegate':
        return new TodoOpDto({ kind, id: id() });
      default:
        throw new TodoError('모르는 요청이에요.');
    }
  }

  get kind(): TodoOp['kind'] {
    return this.op.kind;
  }

  /** 맡기기 요청이면 그 할 일 번호. 아니면 null */
  get delegateId(): string | null {
    return this.op.kind === 'delegate' ? this.op.id : null;
  }

  /** 맡기기가 아닌 요청을 모음에 적용한다 */
  applyTo(list: TodoList, newId: () => string, at: string): TodoList {
    const op = this.op;
    switch (op.kind) {
      case 'add':
        return list.add(op.draft, newId, at);
      case 'edit':
        return list.edit(op.id, op.patch, at);
      case 'move':
        return list.move(op.id, op.status, at);
      case 'remove':
        return list.remove(op.id);
      case 'delegate':
        throw new TodoError('맡기기는 팀에 보낸 뒤에 이어 붙여요.');
    }
  }
}

/** 할 일을 바깥 글로 바꾸는 도우미 */
export const TodoDto = {
  /** 채팅에서 보낸 글을 할 일 초안으로. 첫 줄이 제목, 나머지가 메모. 제목이 너무 길면 줄이고 전체 글을 메모에 둔다. */
  draftFromChat(request: string): { title: string; note: string } {
    const trimmed = request.trim();
    const newline = trimmed.indexOf('\n');
    const first = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim();
    const rest = newline === -1 ? '' : trimmed.slice(newline + 1).trim();
    const tooLong = first.length > TITLE_LIMIT;
    const title = tooLong ? `${first.slice(0, TITLE_LIMIT - 1)}…` : first;
    const note = tooLong ? trimmed : rest;
    return { title, note: note.slice(0, NOTE_LIMIT) };
  },

  /** 팀에 맡길 때 메인으로 보내는 글: `@레포 제목`, 메모, 팀 힌트 */
  requestText(todo: Todo): string {
    const lines = [`${todo.repo === null ? '' : `@${todo.repo} `}${todo.title}`];
    if (todo.note !== '') lines.push(todo.note);
    const team = TEAM_CHOICES.find((t) => t.id === todo.team);
    if (team !== undefined) lines.push(`(맡길 팀: ${team.label})`);
    return lines.join('\n');
  },
};
