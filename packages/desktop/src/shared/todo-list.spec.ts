import { describe, expect, it } from 'vitest';
import { MAX_TODOS, TodoError, TodoList, type TodoFilter } from './todo-list.js';

let n = 0;
const newId = () => `t${(n += 1)}`;
const at = '2026-11-08T09:00:00.000Z';
const add = (list: TodoList, title: string, extra: Partial<Parameters<TodoList['add']>[0]> = {}) => list.add({ title, ...extra }, newId, at);
const all: TodoFilter = { status: 'all', priority: 'all', repo: null, team: null, text: '', overdueOnly: false };

describe('할 일 더하기', () => {
  it('제목만 있으면 "할 일" 상태·보통 우선순위로 더해진다', () => {
    const list = add(TodoList.empty(), '  환불 API 멱등키  ');
    const todo = list.items[0]!;
    expect(todo.title).toBe('환불 API 멱등키');
    expect(todo.status).toBe('todo');
    expect(todo.priority).toBe('normal');
    expect(todo.due).toBeNull();
    expect(todo.jobId).toBeNull();
  });

  it('제목이 비어 있으면 더하지 않는다', () => {
    expect(() => add(TodoList.empty(), '   ')).toThrow(TodoError);
  });

  it('제목은 120자, 메모는 2000자까지만 받는다', () => {
    expect(() => add(TodoList.empty(), 'a'.repeat(121))).toThrow(/120자/);
    expect(() => add(TodoList.empty(), 'ok', { note: 'a'.repeat(2001) })).toThrow(/2000자/);
  });

  it('마감일은 실제 있는 날짜(YYYY-MM-DD)만 받는다', () => {
    expect(add(TodoList.empty(), 'a', { due: '2026-12-31' }).items[0]!.due).toBe('2026-12-31');
    expect(() => add(TodoList.empty(), 'a', { due: '2026-02-30' })).toThrow(/마감일/);
    expect(() => add(TodoList.empty(), 'a', { due: '내일' })).toThrow(/마감일/);
  });

  it('모르는 우선순위·팀은 받지 않는다', () => {
    expect(() => add(TodoList.empty(), 'a', { priority: 'urgent' as never })).toThrow(/우선순위/);
    expect(() => add(TodoList.empty(), 'a', { team: '없는팀' })).toThrow(/팀/);
  });

  it('개수가 상한이면 더 더하지 않는다', () => {
    let list = TodoList.empty();
    for (let i = 0; i < MAX_TODOS; i += 1) list = add(list, `일 ${i}`);
    expect(() => add(list, '하나 더')).toThrow(/최대/);
  });

  it('새 할 일은 목록 맨 앞에 쌓인다(최신 먼저)', () => {
    const list = add(add(TodoList.empty(), '첫째'), '둘째');
    expect(list.items.map((t) => t.title)).toEqual(['둘째', '첫째']);
  });
});

describe('할 일 고치기·옮기기·지우기', () => {
  it('고친 값도 같은 규칙으로 검사한다', () => {
    const list = add(TodoList.empty(), '원래');
    const id = list.items[0]!.id;
    expect(list.edit(id, { title: '새 제목', priority: 'high', repo: 'api-server' }, at).items[0]).toMatchObject({ title: '새 제목', priority: 'high', repo: 'api-server' });
    expect(() => list.edit(id, { title: '' }, at)).toThrow(TodoError);
    expect(() => list.edit('없는 id', { title: 'x' }, at)).toThrow(/찾지 못/);
  });

  it('완료로 옮기면 완료 시각이 남고, 다시 열면 지워진다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    const done = list.move(id, 'done', '2026-11-09T01:00:00.000Z');
    expect(done.items[0]!.status).toBe('done');
    expect(done.items[0]!.completedAt).toBe('2026-11-09T01:00:00.000Z');
    const reopened = done.move(id, 'todo', at);
    expect(reopened.items[0]!.completedAt).toBeNull();
  });

  it('지우면 목록에서 빠진다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b');
    expect(list.remove(list.items[0]!.id).items.map((t) => t.title)).toEqual(['a']);
    expect(() => list.remove('없는 id')).toThrow(TodoError);
  });
});

describe('팀에 맡기기', () => {
  it('맡기면 작업 번호가 붙고 "진행"으로 간다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    expect(list.get(id)!.canDelegate()).toBe(true);
    const doing = list.attachJob(id, 'job-1', at);
    expect(doing.items[0]).toMatchObject({ status: 'doing', jobId: 'job-1' });
    expect(doing.get(id)!.canDelegate()).toBe(false);
  });

  it('이미 맡겨 일하는 중이거나 끝난 할 일은 다시 맡기지 못한다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    expect(() => list.attachJob(id, 'job-1', at).attachJob(id, 'job-2', at)).toThrow(/이미/);
    expect(() => list.move(id, 'done', at).attachJob(id, 'job-2', at)).toThrow(/끝난/);
  });

  it('작업이 끝나면 완료가 되고, 멈추면 "할 일"로 돌아온다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b');
    const [b, a] = [list.items[0]!.id, list.items[1]!.id];
    const running = list.attachJob(a, 'job-a', at).attachJob(b, 'job-b', at);
    const next = running.jobFinished('job-a', 'done', '2026-11-08T10:00:00.000Z').jobFinished('job-b', 'stopped', at);
    expect(next.get(a)).toMatchObject({ status: 'done', completedAt: '2026-11-08T10:00:00.000Z', jobId: 'job-a' });
    expect(next.get(b)).toMatchObject({ status: 'todo', jobId: null });
  });

  it('사용자가 이미 다른 칸으로 옮긴 할 일은 작업이 끝나도 그대로 둔다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    const moved = list.attachJob(id, 'job-a', at).move(id, 'todo', at);
    expect(moved.jobFinished('job-a', 'done', at).get(id)!.status).toBe('todo');
  });

  it('모르는 작업이 끝나도 아무 일 없다', () => {
    const list = add(TodoList.empty(), 'a');
    expect(list.jobFinished('nope', 'done', at)).toBe(list);
  });

  it('앱을 다시 켰을 때 살아 있지 않은 작업에 매인 "진행"은 "할 일"로 돌린다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b');
    const [b, a] = [list.items[0]!.id, list.items[1]!.id];
    const running = list.attachJob(a, 'job-a', at).attachJob(b, 'job-b', at).move(b, 'doing', at);
    const next = running.releaseOrphans(new Set(['job-a']));
    expect(next.get(a)!.status).toBe('doing');
    expect(next.get(b)).toMatchObject({ status: 'todo', jobId: null });
  });
});

describe('마감과 정렬·필터', () => {
  const build = () => {
    let list = TodoList.empty();
    list = add(list, '느긋', { priority: 'low' });
    list = add(list, '급함', { priority: 'high', due: '2026-11-10' });
    list = add(list, '지난 일', { due: '2026-11-01' });
    list = add(list, '평범');
    return list;
  };

  it('마감이 오늘보다 앞이고 끝나지 않았으면 기한이 지난 것이다', () => {
    const list = build();
    const late = list.items.find((t) => t.title === '지난 일')!;
    expect(late.isOverdue('2026-11-08')).toBe(true);
    expect(list.move(late.id, 'done', at).get(late.id)!.isOverdue('2026-11-08')).toBe(false);
    expect(list.items.find((t) => t.title === '급함')!.isOverdue('2026-11-08')).toBe(false);
  });

  it('우선순위순: 높음 먼저, 같으면 마감이 빠른 것, 마감 없는 것은 뒤', () => {
    expect(build().view(all, 'priority').map((t) => t.title)).toEqual(['급함', '지난 일', '평범', '느긋']);
  });

  it('마감순은 마감이 빠른 것부터, 마감 없는 것은 뒤', () => {
    expect(build().view(all, 'due').map((t) => t.title)).toEqual(['지난 일', '급함', '평범', '느긋']);
  });

  it('최신순은 만든 순서의 반대', () => {
    expect(build().view(all, 'created').map((t) => t.title)).toEqual(['평범', '지난 일', '급함', '느긋']);
  });

  it('상태·우선순위·레포·팀·글자로 거른다', () => {
    let list = build();
    const id = list.items.find((t) => t.title === '평범')!.id;
    list = list.edit(id, { repo: 'api-server', team: 'operations', note: '타임아웃 확인' }, at).move(id, 'doing', at);
    expect(list.view({ ...all, status: 'doing' }, 'created').map((t) => t.title)).toEqual(['평범']);
    expect(list.view({ ...all, priority: 'high' }, 'created').map((t) => t.title)).toEqual(['급함']);
    expect(list.view({ ...all, repo: 'api-server' }, 'created').map((t) => t.title)).toEqual(['평범']);
    expect(list.view({ ...all, team: 'operations' }, 'created').map((t) => t.title)).toEqual(['평범']);
    expect(list.view({ ...all, text: '타임아웃' }, 'created').map((t) => t.title)).toEqual(['평범']);
    expect(list.view({ ...all, text: '  급  ' }, 'created').map((t) => t.title)).toEqual(['급함']);
  });

  it('기한 지난 것만 볼 수 있다', () => {
    expect(build().view({ ...all, overdueOnly: true }, 'created', '2026-11-08').map((t) => t.title)).toEqual(['지난 일']);
  });

  it('칸마다 개수를 센다', () => {
    const list = build();
    expect(list.counts()).toEqual({ todo: 4, doing: 0, done: 0 });
  });
});
