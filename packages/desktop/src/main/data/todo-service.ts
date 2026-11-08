import { TodoDto, TodoListDto, TodoOpDto, type TodoListJson, type TodoResult } from '../../shared/todo-dto.js';
import { TodoError, type TodoList } from '../../shared/todo-list.js';
import type { TodoStorePort } from './todo-store.js';

export interface TodoServiceDeps {
  readonly store: TodoStorePort;
  readonly newId: () => string;
  readonly now: () => string;
  /** 팀(메인)에 일을 넘긴다. 받을 수 없으면 null(작업 폴더를 아직 안 골랐을 때 등) */
  readonly submit: (text: string) => { readonly id: string } | null;
  /** 작업이 끝나거나 앱이 스스로 바꾼 뒤 화면에 알린다 */
  readonly onChange: (list: TodoListJson) => void;
}

const MESSAGE_FALLBACK = '할 일을 저장하지 못했어요.';

/**
 * 할 일 서비스: 불러오기 → 엔티티 메서드 → 저장. 도메인 규칙은 TodoList·Todo가 지키고 여기에는 없다.
 * 요청은 한 줄로 세워 하나씩 처리한다(동시에 저장해서 서로 덮어쓰지 않게).
 */
export class TodoService {
  private list: TodoList | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: TodoServiceDeps) {}

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async current(): Promise<TodoList> {
    this.list ??= await this.deps.store.load();
    return this.list;
  }

  private async commit(next: TodoList): Promise<TodoListJson> {
    await this.deps.store.save(next);
    this.list = next;
    return TodoListDto.fromEntity(next).toJSON();
  }

  get(): Promise<TodoListJson> {
    return this.run(async () => TodoListDto.fromEntity(await this.current()).toJSON());
  }

  /** 화면의 요청 하나를 처리한다. 규칙을 어기면 이유를 돌려주고 아무것도 바꾸지 않는다. */
  apply(raw: unknown): Promise<TodoResult> {
    return this.run(async (): Promise<TodoResult> => {
      try {
        const op = TodoOpDto.from(raw);
        const list = await this.current();
        const delegateId = op.delegateId;
        if (delegateId === null) return { ok: true, list: await this.commit(op.applyTo(list, this.deps.newId, this.deps.now())), jobId: null };
        list.assertCanDelegate(delegateId);
        const job = this.deps.submit(TodoDto.requestText(list.require(delegateId)));
        if (job === null) throw new TodoError('지금은 팀에 맡길 수 없어요. 작업 폴더를 먼저 골라 주세요.');
        return { ok: true, list: await this.commit(list.attachJob(delegateId, job.id, this.deps.now())), jobId: job.id };
      } catch (error) {
        return { ok: false, error: error instanceof TodoError ? error.message : MESSAGE_FALLBACK };
      }
    });
  }

  /** 맡긴 작업이 끝났다/멈췄다. 같은 알림이 여러 번 와도 결과가 같다. */
  jobFinished(jobId: string, outcome: 'done' | 'stopped'): Promise<void> {
    return this.run(async () => {
      const list = await this.current();
      const next = list.jobFinished(jobId, outcome, this.deps.now());
      if (next === list) return;
      this.deps.onChange(await this.commit(next));
    }).catch(() => undefined);
  }

  /** 앱을 켤 때 한 번: 지금 살아 있지 않은 작업에 매인 "진행"을 "할 일"로 돌린다. */
  releaseOrphans(liveJobIds: ReadonlySet<string>): Promise<void> {
    return this.run(async () => {
      const list = await this.current();
      const next = list.releaseOrphans(liveJobIds);
      if (next !== list) await this.commit(next);
    }).catch(() => undefined);
  }
}
