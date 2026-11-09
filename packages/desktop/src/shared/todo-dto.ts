import { NOTE_LIMIT, TEAM_CHOICES, Todo, TodoError, TodoList, TODO_PRIORITIES, TITLE_LIMIT, type Label, type RemoveCards, type TodoDraft, type TodoPatch, type TodoPriority, type TodoProps } from './todo-list.js';
import type { ChecklistItem } from './todo-checklist.js';
import { Columns, TodoColumnError, isColumnColor, type Column, type ColumnColor } from './todo-columns.js';
import { isLegacyTodoFile, migrateLegacyTodos } from './todo-migrate.js';

/** 저장 파일·화면에서 오가는 카드 하나(글자·숫자뿐) */
export type TodoJson = TodoProps;

export interface TodoListJson {
  readonly version: 2;
  readonly columns: readonly Column[];
  /** 카드 순서가 곧 칸 안 순서 */
  readonly items: readonly TodoJson[];
}

/** 칸 하나를 고치는 요청. 들어 있는 것만 바꾼다. */
export interface ColumnPatch {
  readonly name?: string;
  readonly color?: ColumnColor;
  readonly done?: boolean;
  readonly work?: boolean;
  readonly collapsed?: boolean;
  readonly hidden?: boolean;
}

/** 화면이 main에 보내는 요청. 어떤 모양이든 DTO가 검사해서 이 모양이 된다. */
export type TodoOp =
  | { readonly kind: 'add'; readonly draft: TodoDraft }
  | { readonly kind: 'edit'; readonly id: string; readonly patch: TodoPatch }
  | { readonly kind: 'move'; readonly id: string; readonly columnId: string; readonly beforeId: string | null }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'duplicate'; readonly id: string }
  | { readonly kind: 'delegate'; readonly id: string }
  | { readonly kind: 'label-remove'; readonly name: string }
  | { readonly kind: 'column-add'; readonly name: string; readonly color: ColumnColor }
  | { readonly kind: 'column-edit'; readonly id: string; readonly patch: ColumnPatch }
  | { readonly kind: 'column-move'; readonly id: string; readonly beforeId: string | null }
  | { readonly kind: 'column-remove'; readonly id: string; readonly cards: RemoveCards; readonly into: string | null };

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

function flag(v: unknown, field: string): boolean {
  if (typeof v === 'boolean') return v;
  throw new TodoError(`${field} 값이 켜고 끄는 값이 아니에요.`);
}

function priority(v: unknown): TodoPriority {
  if (typeof v === 'string' && (TODO_PRIORITIES as readonly string[]).includes(v)) return v as TodoPriority;
  throw new TodoError('우선순위는 높음·보통·낮음 중에서 골라 주세요.');
}

function color(v: unknown): ColumnColor {
  if (isColumnColor(v)) return v;
  throw new TodoError('고를 수 없는 색이에요.');
}

function listOf(v: unknown, field: string): readonly unknown[] {
  if (Array.isArray(v)) return v;
  throw new TodoError(`${field} 값이 목록이 아니에요.`);
}

function labelsOf(v: unknown): readonly Label[] {
  return listOf(v, '라벨').map((l) => {
    if (!isObject(l)) throw new TodoError('라벨 모양이 올바르지 않아요.');
    return { name: text(l['name'], '라벨 이름'), color: color(l['color']) };
  });
}

function checklistOf(v: unknown): readonly ChecklistItem[] {
  return listOf(v, '체크리스트').map((c) => {
    if (!isObject(c)) throw new TodoError('체크리스트 모양이 올바르지 않아요.');
    return { id: text(c['id'], '체크리스트 번호'), text: text(c['text'], '체크리스트 글'), done: flag(c['done'], '체크 표시') };
  });
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
  if (input['labels'] !== undefined) out.labels = labelsOf(input['labels']);
  if (input['checklist'] !== undefined) out.checklist = checklistOf(input['checklist']);
  return out;
}

function columnPatchOf(input: unknown): ColumnPatch {
  if (!isObject(input)) throw new TodoError('고칠 값이 없어요.');
  const out: { -readonly [K in keyof ColumnPatch]: ColumnPatch[K] } = {};
  if (input['name'] !== undefined) out.name = text(input['name'], '칸 이름');
  if (input['color'] !== undefined) out.color = color(input['color']);
  if (input['done'] !== undefined) out.done = flag(input['done'], '완료로 취급');
  if (input['work'] !== undefined) out.work = flag(input['work'], '일하는 칸');
  if (input['collapsed'] !== undefined) out.collapsed = flag(input['collapsed'], '접기');
  if (input['hidden'] !== undefined) out.hidden = flag(input['hidden'], '숨기기');
  return out;
}

function jsonOf(t: Todo): TodoJson {
  return { id: t.id, title: t.title, note: t.note, columnId: t.columnId, priority: t.priority, due: t.due, repo: t.repo, team: t.team, labels: t.labels, checklist: t.checklist.items, jobId: t.jobId, createdAt: t.createdAt, updatedAt: t.updatedAt, completedAt: t.completedAt };
}

/** 저장 파일의 칸 목록. 못 읽으면 null(기본 칸으로 대신하고 건너뛴 것으로 센다) */
function columnsFrom(raw: unknown): Columns | null {
  try {
    return Columns.restore(
      listOf(raw, '칸').map((c) => {
        if (!isObject(c)) throw new TodoError('칸 모양이 올바르지 않아요.');
        return { id: text(c['id'], '칸 번호'), name: text(c['name'], '칸 이름'), color: color(c['color']), done: flag(c['done'], '완료로 취급'), work: flag(c['work'] ?? false, '일하는 칸'), collapsed: flag(c['collapsed'] ?? false, '접기'), hidden: flag(c['hidden'] ?? false, '숨기기') };
      }),
    );
  } catch (error) {
    if (error instanceof TodoError || error instanceof TodoColumnError) return null;
    throw error;
  }
}

/** 보드 ↔ 저장 파일. 깨진 항목은 건너뛰고 나머지로 연다(몇 개 건너뛰었는지 알려, 저장 전에 원본을 남기게 한다). 옛 파일(세 칸 고정)은 읽으면서 새 구조로 바꾼다. */
export class TodoListDto {
  private constructor(
    readonly json: TodoListJson,
    /** 읽다가 건너뛴 항목 수 */
    readonly skipped: number,
  ) {}

  static from(input: unknown): TodoListDto {
    const file = isLegacyTodoFile(input) ? migrateLegacyTodos(input) : input;
    const columns = isObject(file) ? columnsFrom(file['columns']) : null;
    let skipped = isObject(file) && file['columns'] !== undefined && columns === null ? 1 : 0;
    const board = columns ?? Columns.defaults();
    const raw = isObject(file) && Array.isArray(file['items']) ? file['items'] : [];
    const seen = new Set<string>();
    const items: Todo[] = [];
    for (const item of raw) {
      try {
        if (!isObject(item)) throw new TodoError('항목이 객체가 아니에요.');
        const createdAt = text(item['createdAt'], '만든 시각');
        const todo = Todo.restore({
          id: text(item['id'], 'id'),
          title: text(item['title'], '제목'),
          note: text(item['note'], '메모', ''),
          columnId: text(item['columnId'], '칸 번호'),
          priority: priority(item['priority'] ?? 'normal'),
          due: item['due'] === undefined ? null : textOrNull(item['due'], '마감일'),
          repo: item['repo'] === undefined ? null : textOrNull(item['repo'], '레포'),
          team: item['team'] === undefined ? null : textOrNull(item['team'], '팀'),
          labels: item['labels'] === undefined ? [] : labelsOf(item['labels']),
          checklist: item['checklist'] === undefined ? [] : checklistOf(item['checklist']),
          jobId: item['jobId'] === undefined ? null : textOrNull(item['jobId'], '작업'),
          createdAt,
          updatedAt: text(item['updatedAt'], '고친 시각', createdAt),
          completedAt: item['completedAt'] === undefined ? null : textOrNull(item['completedAt'], '끝낸 시각'),
        });
        if (seen.has(todo.id)) continue;
        seen.add(todo.id);
        items.push(todo);
      } catch (error) {
        if (!(error instanceof TodoError)) throw error;
        skipped += 1;
      }
    }
    return new TodoListDto(TodoListDto.fromEntity(TodoList.restore(items, board)).json, skipped);
  }

  static fromEntity(list: TodoList): TodoListDto {
    return new TodoListDto({ version: 2, columns: list.columns.items, items: list.items.map(jsonOf) }, 0);
  }

  toEntity(): TodoList {
    return TodoList.restore(this.json.items.map((p) => Todo.restore(p)), Columns.restore(this.json.columns));
  }

  toJSON(): TodoListJson {
    return this.json;
  }
}

/** 화면의 요청 하나. 모양을 검사하고, 맡기기만 빼고는 보드에 직접 적용한다. */
export class TodoOpDto {
  private constructor(private readonly op: TodoOp) {}

  static from(input: unknown): TodoOpDto {
    if (!isObject(input)) throw new TodoError('요청 모양이 올바르지 않아요.');
    const kind = input['kind'];
    const str = (key: string, missing: string): string => {
      const v = input[key];
      if (typeof v !== 'string' || v === '') throw new TodoError(missing);
      return v;
    };
    const id = (): string => str('id', '할 일 번호가 없어요.');
    const before = (): string | null => {
      const v = input['beforeId'];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string') throw new TodoError('놓을 자리 값이 올바르지 않아요.');
      return v;
    };
    switch (kind) {
      case 'add': {
        const draft: { -readonly [K in keyof TodoDraft]: TodoDraft[K] } = { ...patchOf(input), title: text(input['title'], '제목') };
        if (input['columnId'] !== undefined) draft.columnId = text(input['columnId'], '칸 번호');
        if (input['top'] !== undefined) draft.top = flag(input['top'], '맨 위에 넣기');
        return new TodoOpDto({ kind, draft });
      }
      case 'edit':
        return new TodoOpDto({ kind, id: id(), patch: patchOf(input['patch']) });
      case 'move':
        return new TodoOpDto({ kind, id: id(), columnId: str('columnId', '옮길 칸 번호가 없어요.'), beforeId: before() });
      case 'remove':
        return new TodoOpDto({ kind, id: id() });
      case 'delegate':
      case 'duplicate':
        return new TodoOpDto({ kind, id: id() });
      case 'label-remove':
        return new TodoOpDto({ kind, name: text(input['name'], '라벨 이름') });
      case 'column-add':
        return new TodoOpDto({ kind, name: text(input['name'], '칸 이름'), color: input['color'] === undefined ? 'gray' : color(input['color']) });
      case 'column-edit':
        return new TodoOpDto({ kind, id: str('id', '칸 번호가 없어요.'), patch: columnPatchOf(input['patch']) });
      case 'column-move':
        return new TodoOpDto({ kind, id: str('id', '칸 번호가 없어요.'), beforeId: before() });
      case 'column-remove': {
        const cards = input['cards'];
        if (cards !== 'merge' && cards !== 'delete') throw new TodoError('칸을 지울 때 카드를 어떻게 할지 골라 주세요.');
        const into = input['into'];
        if (into !== undefined && into !== null && (typeof into !== 'string' || into === '')) throw new TodoError('카드를 옮길 칸 값이 올바르지 않아요.');
        return new TodoOpDto({ kind, id: str('id', '칸 번호가 없어요.'), cards, into: typeof into === 'string' ? into : null });
      }
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

  /** 맡기기가 아닌 요청을 보드에 적용한다 */
  applyTo(board: TodoList, newId: () => string, at: string): TodoList {
    const op = this.op;
    switch (op.kind) {
      case 'add':
        return board.add(op.draft, newId, at);
      case 'edit':
        return board.edit(op.id, op.patch, at);
      case 'move':
        return board.move(op.id, op.columnId, op.beforeId, at);
      case 'remove':
        return board.remove(op.id);
      case 'duplicate':
        return board.duplicate(op.id, newId, at);
      case 'label-remove':
        return board.removeLabel(op.name, at);
      case 'delegate':
        throw new TodoError('맡기기는 팀에 보낸 뒤에 이어 붙여요.');
      case 'column-add':
        return board.addColumn(op.name, op.color, newId);
      case 'column-edit': {
        const p = op.patch;
        let next = board;
        if (p.name !== undefined) next = next.renameColumn(op.id, p.name);
        if (p.color !== undefined) next = next.recolorColumn(op.id, p.color);
        if (p.done !== undefined) next = next.setColumnDone(op.id, p.done);
        if (p.work !== undefined) next = next.setColumnWork(op.id, p.work);
        if (p.collapsed !== undefined) next = next.collapseColumn(op.id, p.collapsed);
        if (p.hidden !== undefined) next = next.hideColumn(op.id, p.hidden);
        return next;
      }
      case 'column-move':
        return board.moveColumn(op.id, op.beforeId);
      case 'column-remove':
        return board.removeColumn(op.id, op.cards, at, op.into);
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

  /** 팀에 맡길 때 메인으로 보내는 글: `@레포 제목`, 메모, 체크리스트, 팀 힌트 */
  requestText(todo: Todo): string {
    const lines = [`${todo.repo === null ? '' : `@${todo.repo} `}${todo.title}`];
    if (todo.note !== '') lines.push(todo.note);
    const items = todo.checklist.items;
    if (items.length > 0) lines.push(...items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`));
    const team = TEAM_CHOICES.find((t) => t.id === todo.team);
    if (team !== undefined) lines.push(`(맡길 팀: ${team.label})`);
    return lines.join('\n');
  },
};
