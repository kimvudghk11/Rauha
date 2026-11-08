import { describe, expect, it } from 'vitest';
import { TodoDto, TodoListDto, TodoOpDto } from './todo-dto.js';
import { TodoError, TodoList } from './todo-list.js';

const at = '2026-11-08T09:00:00.000Z';
let n = 0;
const newId = () => `t${(n += 1)}`;

describe('할 일 저장 모양', () => {
  it('저장했다 읽어도 같다(칸·라벨·체크리스트 포함)', () => {
    const list = TodoList.empty()
      .addColumn('검토', 'purple', newId)
      .add({ title: '환불 API', note: '결제 쪽 참고', priority: 'high', due: '2026-12-01', repo: 'api', team: 'dev', labels: [{ name: '버그', color: 'red' }], checklist: [{ id: 'c1', text: '테스트', done: true }] }, newId, at);
    const json = TodoListDto.fromEntity(list).toJSON();
    const back = TodoListDto.from(JSON.parse(JSON.stringify(json))).toEntity();
    expect(TodoListDto.fromEntity(back).toJSON()).toEqual(json);
    expect(json.version).toBe(2);
    expect(json.columns).toHaveLength(4);
  });

  it('깨진 항목은 건너뛰고 몇 개 건너뛰었는지 알려 준다(나머지는 산다)', () => {
    const ok = TodoListDto.fromEntity(TodoList.empty().add({ title: '살아 있는 일' }, newId, at)).toJSON().items[0]!;
    const dto = TodoListDto.from({ version: 2, columns: TodoList.empty().columns.items, items: [ok, { id: 'x', title: '' }, 42, null, { ...ok, id: 'y', priority: '이상한' }] });
    expect(dto.toEntity().items.map((t) => t.title)).toEqual(['살아 있는 일']);
    expect(dto.skipped).toBe(4);
  });

  it('파일이 객체가 아니면 기본 칸의 빈 보드다', () => {
    expect(TodoListDto.from('깨짐').toEntity().items).toEqual([]);
    expect(TodoListDto.from(null).toEntity().columns.items).toHaveLength(3);
    expect(TodoListDto.from(null).skipped).toBe(0);
  });

  it('같은 번호가 두 번 있으면 먼저 나온 것만 쓴다', () => {
    const ok = TodoListDto.fromEntity(TodoList.empty().add({ title: 'a' }, newId, at)).toJSON().items[0]!;
    expect(TodoListDto.from({ version: 2, items: [ok, { ...ok, title: '복사본' }] }).toEntity().items.map((t) => t.title)).toEqual(['a']);
  });

  it('칸 목록이 깨졌으면 기본 칸으로 열고 건너뛴 것으로 센다(원본을 남기게)', () => {
    const ok = TodoListDto.fromEntity(TodoList.empty().add({ title: 'a' }, newId, at)).toJSON().items[0]!;
    const dto = TodoListDto.from({ version: 2, columns: [{ id: 'x' }], items: [ok] });
    expect(dto.toEntity().columns.items.map((c) => c.id)).toEqual(['todo', 'doing', 'done']);
    expect(dto.skipped).toBe(1);
  });

  it('없는 칸에 매인 카드는 첫 칸으로 모인다', () => {
    const ok = TodoListDto.fromEntity(TodoList.empty().add({ title: 'a' }, newId, at)).toJSON().items[0]!;
    expect(TodoListDto.from({ version: 2, items: [{ ...ok, columnId: '사라진칸' }] }).toEntity().items[0]!.columnId).toBe('todo');
  });
});

describe('옛 파일(세 칸 고정) 읽기', () => {
  const legacy = {
    version: 1,
    items: [
      { id: 'a', title: '옛 일', note: '메모', status: 'doing', priority: 'high', due: '2026-12-01', repo: 'api', team: 'dev', jobId: 'job-1', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', completedAt: null },
      { id: 'b', title: '끝난 일', note: '', status: 'done', priority: 'normal', due: null, repo: null, team: null, jobId: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', completedAt: '2026-11-02T00:00:00.000Z' },
    ],
  };

  it('상태가 같은 번호의 칸으로 옮겨 가고 다른 값은 그대로다', () => {
    const board = TodoListDto.from(legacy).toEntity();
    expect(board.columns.items.map((c) => c.name)).toEqual(['할 일', '진행 중', '완료']);
    expect(board.get('a')).toMatchObject({ columnId: 'doing', title: '옛 일', priority: 'high', jobId: 'job-1' });
    expect(board.get('b')).toMatchObject({ columnId: 'done', completedAt: '2026-11-02T00:00:00.000Z' });
    expect(TodoListDto.from(legacy).skipped).toBe(0);
  });

  it('모르는 상태의 항목은 건너뛴다', () => {
    const dto = TodoListDto.from({ items: [{ ...legacy.items[0], status: '??' }] });
    expect(dto.skipped).toBe(1);
  });
});

describe('화면에서 온 요청', () => {
  it('카드 요청(더하기·고치기·옮기기·지우기·맡기기)을 알아본다', () => {
    expect(TodoOpDto.from({ kind: 'add', title: '새 일' }).kind).toBe('add');
    expect(TodoOpDto.from({ kind: 'edit', id: 'a', patch: { title: 'x' } }).kind).toBe('edit');
    expect(TodoOpDto.from({ kind: 'move', id: 'a', columnId: 'done', beforeId: null }).kind).toBe('move');
    expect(TodoOpDto.from({ kind: 'remove', id: 'a' }).kind).toBe('remove');
    expect(TodoOpDto.from({ kind: 'delegate', id: 'a' }).delegateId).toBe('a');
  });

  it('칸 요청(더하기·고치기·옮기기·지우기)을 알아본다', () => {
    expect(TodoOpDto.from({ kind: 'column-add', name: '검토' }).kind).toBe('column-add');
    expect(TodoOpDto.from({ kind: 'column-edit', id: 'todo', patch: { name: '백로그', done: true } }).kind).toBe('column-edit');
    expect(TodoOpDto.from({ kind: 'column-move', id: 'done', beforeId: 'todo' }).kind).toBe('column-move');
    expect(TodoOpDto.from({ kind: 'column-remove', id: 'doing', cards: 'merge' }).kind).toBe('column-remove');
  });

  it('모르는 종류·번호 없음·값 모양이 틀리면 거절한다', () => {
    expect(() => TodoOpDto.from({ kind: 'drop-all' })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'remove' })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'add', title: 5 })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'edit', id: 'a', patch: { priority: 'x' } })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'edit', id: 'a', patch: { labels: 'x' } })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'edit', id: 'a', patch: { labels: [{ name: 'a', color: 'pink' }] } })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'edit', id: 'a', patch: { checklist: [{ id: 'a', text: 'x', done: 'yes' }] } })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'move', id: 'a' })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'move', id: 'a', columnId: 'x', beforeId: 5 })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'column-edit', id: 'a', patch: { done: 'yes' } })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'column-remove', id: 'a' })).toThrow(/카드/);
    expect(() => TodoOpDto.from('x')).toThrow(TodoError);
  });

  it('카드 요청을 보드에 적용한다', () => {
    let list = TodoOpDto.from({ kind: 'add', title: '하나', due: '2026-12-01' }).applyTo(TodoList.empty(), newId, at);
    const id = list.items[0]!.id;
    list = TodoOpDto.from({ kind: 'edit', id, patch: { due: null, priority: 'low', labels: [{ name: '문서', color: 'blue' }], checklist: [{ id: '1', text: '쓰기', done: false }] } }).applyTo(list, newId, at);
    expect(list.items[0]).toMatchObject({ due: null, priority: 'low' });
    expect(list.items[0]!.labels).toEqual([{ name: '문서', color: 'blue' }]);
    list = TodoOpDto.from({ kind: 'move', id, columnId: 'done', beforeId: null }).applyTo(list, newId, at);
    expect(list.items[0]!.columnId).toBe('done');
    expect(TodoOpDto.from({ kind: 'remove', id }).applyTo(list, newId, at).items).toEqual([]);
  });

  it('칸 요청을 보드에 적용한다', () => {
    let list = TodoOpDto.from({ kind: 'column-add', name: '검토', color: 'purple' }).applyTo(TodoList.empty(), newId, at);
    const id = list.columns.items[3]!.id;
    list = TodoOpDto.from({ kind: 'column-edit', id, patch: { name: '리뷰', color: 'yellow', done: true, collapsed: true } }).applyTo(list, newId, at);
    expect(list.columns.get(id)).toMatchObject({ name: '리뷰', color: 'yellow', done: true, collapsed: true });
    list = TodoOpDto.from({ kind: 'column-move', id, beforeId: 'todo' }).applyTo(list, newId, at);
    expect(list.columns.items[0]!.id).toBe(id);
    list = TodoOpDto.from({ kind: 'column-remove', id, cards: 'delete' }).applyTo(list, newId, at);
    expect(list.columns.items).toHaveLength(3);
  });

  it('맡기기는 보드에 직접 적용하지 않는다(팀에 보낸 뒤에 이어 붙인다)', () => {
    expect(() => TodoOpDto.from({ kind: 'delegate', id: 'a' }).applyTo(TodoList.empty(), newId, at)).toThrow(TodoError);
  });
});

describe('채팅에서 할 일로', () => {
  it('첫 줄이 제목, 나머지는 메모가 된다', () => {
    expect(TodoDto.draftFromChat('결제 타임아웃 원인 찾기\n로그는 어제 것부터 보기')).toEqual({ title: '결제 타임아웃 원인 찾기', note: '로그는 어제 것부터 보기' });
  });

  it('제목이 길면 줄이고 전체 글은 메모에 남긴다', () => {
    const long = '가'.repeat(200);
    const draft = TodoDto.draftFromChat(long);
    expect(draft.title.length).toBeLessThanOrEqual(120);
    expect(draft.title.endsWith('…')).toBe(true);
    expect(draft.note).toBe(long);
  });

  it('메모 상한을 넘는 글은 잘라서 담는다', () => {
    expect(TodoDto.draftFromChat(`제목\n${'나'.repeat(5000)}`).note.length).toBeLessThanOrEqual(2000);
  });
});

describe('팀에 맡길 글', () => {
  it('레포가 있으면 @레포를 앞에 붙이고, 팀이 있으면 힌트 줄을 붙인다', () => {
    const list = TodoList.empty().add({ title: '인스턴스 늘리기', note: '최소 2대', repo: 'infra', team: 'operations' }, newId, at);
    expect(TodoDto.requestText(list.items[0]!)).toBe('@infra 인스턴스 늘리기\n최소 2대\n(맡길 팀: 운영·유지보수부)');
  });

  it('레포·메모·팀이 없으면 제목만 보낸다', () => {
    expect(TodoDto.requestText(TodoList.empty().add({ title: '문서 정리' }, newId, at).items[0]!)).toBe('문서 정리');
  });

  it('체크리스트가 있으면 할 일 목록으로 덧붙인다', () => {
    const list = TodoList.empty().add({ title: '배포', checklist: [{ id: '1', text: '테스트', done: true }, { id: '2', text: '릴리스', done: false }] }, newId, at);
    expect(TodoDto.requestText(list.items[0]!)).toBe('배포\n- [x] 테스트\n- [ ] 릴리스');
  });
});

describe('라벨 지우기 요청', () => {
  it('이름이 글자가 아니면(숫자·배열·객체·없음) 거절한다', () => {
    for (const name of [5, null, ['bug'], { toString: () => 'bug' }, undefined]) expect(() => TodoOpDto.from({ kind: 'label-remove', name })).toThrow(TodoError);
  });

  it('빈 이름은 요청은 받아도 적용에서 거절해 아무 카드도 건드리지 않는다', () => {
    const op = TodoOpDto.from({ kind: 'label-remove', name: '   ' });
    const list = TodoList.empty().add({ title: 'a', labels: [{ name: 'bug', color: 'red' }] }, newId, at);
    expect(() => op.applyTo(list, newId, at)).toThrow(TodoError);
    expect(list.items[0]?.labels.map((l) => l.name)).toEqual(['bug']);
  });

  it('프로토타입 이름(__proto__·constructor)을 지우라 해도 다른 라벨은 그대로다', () => {
    const list = TodoList.empty().add({ title: 'a', labels: [{ name: 'bug', color: 'red' }] }, newId, at);
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const next = TodoOpDto.from({ kind: 'label-remove', name }).applyTo(list, newId, at);
      expect(next.items[0]?.labels.map((l) => l.name)).toEqual(['bug']);
    }
  });
});
