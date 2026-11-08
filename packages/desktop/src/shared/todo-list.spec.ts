import { describe, expect, it } from 'vitest';
import { LABEL_MAX, MAX_TODOS, TodoError, TodoList, type TodoFilter } from './todo-list.js';

let n = 0;
const newId = () => `t${(n += 1)}`;
const at = '2026-11-08T09:00:00.000Z';
const add = (list: TodoList, title: string, extra: Partial<Parameters<TodoList['add']>[0]> = {}) => list.add({ title, ...extra }, newId, at);
const all: TodoFilter = { column: 'all', priority: 'all', repo: null, team: null, label: null, text: '', overdueOnly: false };
const titles = (list: TodoList, column: string) => list.cardsIn(column).map((t) => t.title);
const idOf = (list: TodoList, title: string) => list.items.find((t) => t.title === title)!.id;

describe('카드 더하기', () => {
  it('제목만 있으면 첫 칸·보통 우선순위로 더해진다', () => {
    const list = add(TodoList.empty(), '  환불 API 멱등키  ');
    const todo = list.items[0]!;
    expect(todo.title).toBe('환불 API 멱등키');
    expect(todo.columnId).toBe('todo');
    expect(todo.priority).toBe('normal');
    expect(todo.due).toBeNull();
    expect(todo.jobId).toBeNull();
    expect(todo.labels).toEqual([]);
    expect(todo.checklist.items).toEqual([]);
  });

  it('새 카드는 칸 맨 아래에 붙는다', () => {
    const list = add(add(TodoList.empty(), '첫째'), '둘째');
    expect(titles(list, 'todo')).toEqual(['첫째', '둘째']);
  });

  it('칸을 정하면 그 칸 맨 아래에 붙고, 없는 칸이면 거절한다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b', { columnId: 'doing' });
    expect(titles(list, 'doing')).toEqual(['b']);
    expect(() => add(list, 'c', { columnId: '없음' })).toThrow(/칸/);
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
});

describe('라벨과 체크리스트', () => {
  it('라벨을 지우면 모든 카드에서 빠지고(대소문자 무시) 카드는 남는다', () => {
    let list = add(TodoList.empty(), 'a', { labels: [{ name: 'Bug', color: 'red' }, { name: 'ui', color: 'blue' }] });
    list = add(list, 'b', { labels: [{ name: 'bug', color: 'red' }] });
    const next = list.removeLabel(' BUG ', at);
    expect(next.items.map((t) => t.labels.map((l) => l.name))).toEqual([['ui'], []]);
    expect(next.labels().map((l) => l.name)).toEqual(['ui']);
    expect(() => list.removeLabel('  ', at)).toThrow(TodoError);
  });

  it('라벨은 이름·색을 가지고, 앞뒤 공백을 지우며, 같은 이름(대소문자 무시)은 한 번만 쓴다', () => {
    const list = add(TodoList.empty(), 'a', { labels: [{ name: ' 버그 ', color: 'red' }] });
    expect(list.items[0]!.labels).toEqual([{ name: '버그', color: 'red' }]);
    expect(() => add(TodoList.empty(), 'a', { labels: [{ name: 'Bug', color: 'red' }, { name: 'bug', color: 'blue' }] })).toThrow(/두 번/);
  });

  it('라벨은 8개까지, 이름은 20자까지, 색은 정해진 것만 받는다', () => {
    const many = Array.from({ length: LABEL_MAX + 1 }, (_, i) => ({ name: `l${i}`, color: 'gray' as const }));
    expect(() => add(TodoList.empty(), 'a', { labels: many })).toThrow(/8개/);
    expect(() => add(TodoList.empty(), 'a', { labels: [{ name: 'a'.repeat(21), color: 'gray' }] })).toThrow(/20자/);
    expect(() => add(TodoList.empty(), 'a', { labels: [{ name: 'x', color: 'pink' as never }] })).toThrow(/색/);
    expect(() => add(TodoList.empty(), 'a', { labels: [{ name: ' ', color: 'gray' }] })).toThrow(/이름/);
  });

  it('체크리스트를 고치면 진행률이 따라온다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    const next = list.edit(id, { checklist: [{ id: '1', text: '테스트', done: true }, { id: '2', text: '구현', done: false }] }, at);
    expect(next.get(id)!.checklist.progress()).toEqual({ done: 1, total: 2, percent: 50 });
  });

  it('체크리스트 규칙을 어기면 카드 규칙 오류로 거절한다', () => {
    const list = add(TodoList.empty(), 'a');
    expect(() => list.edit(list.items[0]!.id, { checklist: [{ id: '1', text: ' ', done: false }] }, at)).toThrow(TodoError);
  });
});

describe('카드 고치기·옮기기·지우기', () => {
  it('고친 값도 같은 규칙으로 검사한다', () => {
    const list = add(TodoList.empty(), '원래');
    const id = list.items[0]!.id;
    expect(list.edit(id, { title: '새 제목', priority: 'high', repo: 'api-server' }, at).items[0]).toMatchObject({ title: '새 제목', priority: 'high', repo: 'api-server' });
    expect(() => list.edit(id, { title: '' }, at)).toThrow(TodoError);
    expect(() => list.edit('없는 id', { title: 'x' }, at)).toThrow(/찾지 못/);
  });

  it('다른 칸의 어느 카드 앞으로 옮긴다', () => {
    let list = add(add(add(TodoList.empty(), 'a'), 'b'), 'c', { columnId: 'doing' });
    list = list.move(idOf(list, 'a'), 'doing', idOf(list, 'c'), at);
    expect(titles(list, 'todo')).toEqual(['b']);
    expect(titles(list, 'doing')).toEqual(['a', 'c']);
  });

  it('앞 카드를 비우면 그 칸 맨 아래로 간다', () => {
    let list = add(add(add(TodoList.empty(), 'a'), 'b'), 'c', { columnId: 'doing' });
    list = list.move(idOf(list, 'a'), 'doing', null, at);
    expect(titles(list, 'doing')).toEqual(['c', 'a']);
  });

  it('같은 칸 안에서 순서를 바꿔도 된다(칸이 바뀌지 않으니 시각도 그대로)', () => {
    let list = add(add(add(TodoList.empty(), 'a'), 'b'), 'c');
    list = list.move(idOf(list, 'c'), 'todo', idOf(list, 'a'), '2026-11-09T00:00:00.000Z');
    expect(titles(list, 'todo')).toEqual(['c', 'a', 'b']);
    expect(list.get(idOf(list, 'c'))!.updatedAt).toBe(at);
  });

  it('없는 칸·없는 카드로는 옮기지 못한다', () => {
    const list = add(TodoList.empty(), 'a');
    expect(() => list.move(list.items[0]!.id, '없음', null, at)).toThrow(/칸/);
    expect(() => list.move('없음', 'doing', null, at)).toThrow(/찾지 못/);
  });

  it('완료 칸으로 옮기면 끝낸 시각이 남고, 다시 열면 지워진다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    const done = list.move(id, 'done', null, '2026-11-09T01:00:00.000Z');
    expect(done.items[0]!.columnId).toBe('done');
    expect(done.items[0]!.completedAt).toBe('2026-11-09T01:00:00.000Z');
    expect(done.move(id, 'todo', null, at).items[0]!.completedAt).toBeNull();
  });

  it('지우면 목록에서 빠진다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b');
    expect(list.remove(list.items[0]!.id).items.map((t) => t.title)).toEqual(['b']);
    expect(() => list.remove('없는 id')).toThrow(TodoError);
  });
});

describe('칸 고치기', () => {
  it('칸을 더하고 이름·색을 바꾼다', () => {
    let list = TodoList.empty().addColumn('검토', 'purple', newId);
    const id = list.columns.items[3]!.id;
    list = list.renameColumn(id, '리뷰').recolorColumn(id, 'yellow');
    expect(list.columns.get(id)).toMatchObject({ name: '리뷰', color: 'yellow' });
  });

  it('칸 규칙 위반은 카드 규칙 오류로 알린다', () => {
    expect(() => TodoList.empty().renameColumn('todo', ' ')).toThrow(TodoError);
    expect(() => TodoList.empty().removeColumn('todo', 'merge', at).removeColumn('doing', 'merge', at).removeColumn('done', 'merge', at)).toThrow(/마지막/);
  });

  it('칸을 지우며 카드를 합치면 앞 칸 맨 아래로 간다', () => {
    let list = add(add(add(TodoList.empty(), 'a'), 'b', { columnId: 'doing' }), 'c', { columnId: 'doing' });
    list = list.removeColumn('doing', 'merge', at);
    expect(list.columns.items.map((c) => c.id)).toEqual(['todo', 'done']);
    expect(titles(list, 'todo')).toEqual(['a', 'b', 'c']);
  });

  it('첫 칸을 지우며 합치면 다음 칸으로 간다', () => {
    let list = add(add(TodoList.empty(), 'a'), 'b', { columnId: 'doing' });
    list = list.removeColumn('todo', 'merge', at);
    expect(titles(list, 'doing')).toEqual(['b', 'a']);
  });

  it('완료로 취급하는 칸으로 합쳐지면 끝낸 시각이 남는다', () => {
    const list = add(TodoList.empty(), 'z', { columnId: 'doing' }).setColumnDone('todo', true).removeColumn('doing', 'merge', '2026-11-10T00:00:00.000Z');
    expect(list.items[0]).toMatchObject({ columnId: 'todo', completedAt: '2026-11-10T00:00:00.000Z' });
  });

  it('카드를 함께 지울 수도 있다', () => {
    let list = add(add(TodoList.empty(), 'a'), 'b', { columnId: 'doing' });
    list = list.removeColumn('doing', 'delete', at);
    expect(list.items.map((t) => t.title)).toEqual(['a']);
  });

  it('칸 순서를 바꾸면 보드 보기 순서도 따라온다', () => {
    let list = add(add(TodoList.empty(), 'a'), 'b', { columnId: 'done' });
    list = list.moveColumn('done', 'todo');
    expect(list.view(all, 'manual').map((t) => t.title)).toEqual(['b', 'a']);
  });

  it('저장 파일의 칸이 사라졌으면 카드는 첫 칸으로 모인다', () => {
    const made = add(TodoList.empty(), 'a', { columnId: 'doing' });
    const restored = TodoList.restore(made.items, made.columns.remove('doing'));
    expect(restored.items[0]!.columnId).toBe('todo');
  });
});

describe('팀에 맡기기', () => {
  it('맡기면 작업 번호가 붙고 "일하는 칸"(진행 중)으로 간다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    expect(list.canDelegate(list.get(id)!)).toBe(true);
    const doing = list.attachJob(id, 'job-1', at);
    expect(doing.items[0]).toMatchObject({ columnId: 'doing', jobId: 'job-1' });
    expect(doing.canDelegate(doing.get(id)!)).toBe(false);
  });

  it('일하는 칸이 따로 없으면 있던 칸에 그대로 둔다', () => {
    const list = add(TodoList.empty(), 'a').setColumnWork('doing', false);
    expect(list.attachJob(list.items[0]!.id, 'job-1', at).items[0]).toMatchObject({ columnId: 'todo', jobId: 'job-1' });
  });

  it('이미 맡겨 일하는 중이거나 끝난 카드는 다시 맡기지 못한다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    expect(() => list.attachJob(id, 'job-1', at).attachJob(id, 'job-2', at)).toThrow(/이미/);
    expect(() => list.move(id, 'done', null, at).attachJob(id, 'job-2', at)).toThrow(/끝난/);
  });

  it('작업이 끝나면 완료 칸으로 가고, 멈추면 첫 칸으로 돌아온다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b');
    const [a, b] = [list.items[0]!.id, list.items[1]!.id];
    const running = list.attachJob(a, 'job-a', at).attachJob(b, 'job-b', at);
    const next = running.jobFinished('job-a', 'done', '2026-11-08T10:00:00.000Z').jobFinished('job-b', 'stopped', at);
    expect(next.get(a)).toMatchObject({ columnId: 'done', completedAt: '2026-11-08T10:00:00.000Z', jobId: 'job-a' });
    expect(next.get(b)).toMatchObject({ columnId: 'todo', jobId: null });
  });

  it('완료로 취급하는 칸이 없으면 끝나도 제자리다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    const running = list.attachJob(id, 'job-a', at).setColumnDone('done', false);
    expect(running.jobFinished('job-a', 'done', at).get(id)!.columnId).toBe('doing');
  });

  it('사용자가 이미 일하는 칸 밖으로 옮긴 카드는 작업이 끝나도 그대로 둔다', () => {
    const list = add(TodoList.empty(), 'a');
    const id = list.items[0]!.id;
    const moved = list.attachJob(id, 'job-a', at).move(id, 'todo', null, at);
    expect(moved.jobFinished('job-a', 'done', at).get(id)!.columnId).toBe('todo');
  });

  it('모르는 작업이 끝나도 아무 일 없다', () => {
    const list = add(TodoList.empty(), 'a');
    expect(list.jobFinished('nope', 'done', at)).toBe(list);
  });

  it('앱을 다시 켰을 때 살아 있지 않은 작업에 매인 카드는 첫 칸으로 돌린다', () => {
    const list = add(add(TodoList.empty(), 'a'), 'b');
    const [a, b] = [list.items[0]!.id, list.items[1]!.id];
    const next = list.attachJob(a, 'job-a', at).attachJob(b, 'job-b', at).releaseOrphans(new Set(['job-a']));
    expect(next.get(a)!.columnId).toBe('doing');
    expect(next.get(b)).toMatchObject({ columnId: 'todo', jobId: null });
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

  it('마감이 오늘보다 앞이고 완료 칸이 아니면 기한이 지난 것이다', () => {
    const list = build();
    const late = list.items.find((t) => t.title === '지난 일')!;
    expect(list.isOverdue(late, '2026-11-08')).toBe(true);
    const done = list.move(late.id, 'done', null, at);
    expect(done.isOverdue(done.get(late.id)!, '2026-11-08')).toBe(false);
    expect(list.isOverdue(list.items.find((t) => t.title === '급함')!, '2026-11-08')).toBe(false);
  });

  it('"완료로 취급"을 다른 칸에 켜면 그 칸의 카드도 기한이 지났다고 하지 않는다', () => {
    const list = build().setColumnDone('todo', true);
    expect(list.view({ ...all, overdueOnly: true }, 'manual', '2026-11-08')).toEqual([]);
  });

  it('보드 순서(manual)는 칸 순서 다음 칸 안 순서다', () => {
    expect(build().view(all, 'manual').map((t) => t.title)).toEqual(['느긋', '급함', '지난 일', '평범']);
  });

  it('우선순위순: 높음 먼저, 같으면 마감이 빠른 것, 마감 없는 것은 뒤', () => {
    expect(build().view(all, 'priority').map((t) => t.title)).toEqual(['급함', '지난 일', '평범', '느긋']);
  });

  it('마감순은 마감이 빠른 것부터, 마감 없는 것은 뒤', () => {
    expect(build().view(all, 'due').map((t) => t.title)).toEqual(['지난 일', '급함', '느긋', '평범']);
  });

  it('최신순은 만든 시각이 늦은 것부터', () => {
    let list = TodoList.empty();
    list = list.add({ title: '먼저' }, newId, '2026-11-01T00:00:00.000Z');
    list = list.add({ title: '나중' }, newId, '2026-11-02T00:00:00.000Z');
    expect(list.view(all, 'created').map((t) => t.title)).toEqual(['나중', '먼저']);
  });

  it('칸·우선순위·레포·팀·라벨·글자로 거른다', () => {
    let list = build();
    const id = idOf(list, '평범');
    list = list.edit(id, { repo: 'api-server', team: 'operations', note: '타임아웃 확인', labels: [{ name: '버그', color: 'red' }], checklist: [{ id: 'c1', text: '로그 확인', done: false }] }, at).move(id, 'doing', null, at);
    const titlesOf = (f: Partial<TodoFilter>) => list.view({ ...all, ...f }, 'manual').map((t) => t.title);
    expect(titlesOf({ column: 'doing' })).toEqual(['평범']);
    expect(titlesOf({ priority: 'high' })).toEqual(['급함']);
    expect(titlesOf({ repo: 'api-server' })).toEqual(['평범']);
    expect(titlesOf({ team: 'operations' })).toEqual(['평범']);
    expect(titlesOf({ label: '버그' })).toEqual(['평범']);
    expect(titlesOf({ text: '타임아웃' })).toEqual(['평범']);
    expect(titlesOf({ text: '로그 확인' })).toEqual(['평범']);
    expect(titlesOf({ text: '  급  ' })).toEqual(['급함']);
  });

  it('기한 지난 것만 볼 수 있다', () => {
    expect(build().view({ ...all, overdueOnly: true }, 'manual', '2026-11-08').map((t) => t.title)).toEqual(['지난 일']);
  });

  it('칸마다 개수를 센다', () => {
    expect(build().counts()).toEqual({ todo: 4, doing: 0, done: 0 });
  });

  it('카드에 붙은 라벨을 이름 하나씩 모아 준다', () => {
    let list = add(add(TodoList.empty(), 'a', { labels: [{ name: '버그', color: 'red' }] }), 'b', { labels: [{ name: '버그', color: 'blue' }, { name: '문서', color: 'gray' }] });
    list = list.edit(list.items[0]!.id, {}, at);
    expect(list.labels()).toEqual([{ name: '버그', color: 'red' }, { name: '문서', color: 'gray' }]);
  });
});
