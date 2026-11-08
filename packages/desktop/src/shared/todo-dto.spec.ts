import { describe, expect, it } from 'vitest';
import { TodoDto, TodoListDto, TodoOpDto } from './todo-dto.js';
import { TodoError, TodoList } from './todo-list.js';

const at = '2026-11-08T09:00:00.000Z';
let n = 0;
const newId = () => `t${(n += 1)}`;

describe('할 일 저장 모양', () => {
  it('저장했다 읽어도 같다', () => {
    const list = TodoList.empty().add({ title: '환불 API', note: '결제 쪽 참고', priority: 'high', due: '2026-12-01', repo: 'api', team: 'dev' }, newId, at);
    const json = TodoListDto.fromEntity(list).toJSON();
    const back = TodoListDto.from(JSON.parse(JSON.stringify(json))).toEntity();
    expect(TodoListDto.fromEntity(back).toJSON()).toEqual(json);
  });

  it('깨진 항목은 건너뛰고 몇 개 건너뛰었는지 알려 준다(나머지는 산다)', () => {
    const ok = TodoListDto.fromEntity(TodoList.empty().add({ title: '살아 있는 일' }, newId, at)).toJSON().items[0]!;
    const dto = TodoListDto.from({ items: [ok, { id: 'x', title: '' }, 42, null, { ...ok, id: 'y', status: '이상한' }] });
    expect(dto.toEntity().items.map((t) => t.title)).toEqual(['살아 있는 일']);
    expect(dto.skipped).toBe(4);
  });

  it('파일이 객체가 아니면 빈 모음이다', () => {
    expect(TodoListDto.from('깨짐').toEntity().items).toEqual([]);
    expect(TodoListDto.from(null).skipped).toBe(0);
  });

  it('같은 번호가 두 번 있으면 먼저 나온 것만 쓴다', () => {
    const ok = TodoListDto.fromEntity(TodoList.empty().add({ title: 'a' }, newId, at)).toJSON().items[0]!;
    expect(TodoListDto.from({ items: [ok, { ...ok, title: '복사본' }] }).toEntity().items.map((t) => t.title)).toEqual(['a']);
  });
});

describe('화면에서 온 요청', () => {
  it('더하기·고치기·옮기기·지우기·맡기기를 알아본다', () => {
    expect(TodoOpDto.from({ kind: 'add', title: '새 일' }).kind).toBe('add');
    expect(TodoOpDto.from({ kind: 'edit', id: 'a', patch: { title: 'x' } }).kind).toBe('edit');
    expect(TodoOpDto.from({ kind: 'move', id: 'a', status: 'done' }).kind).toBe('move');
    expect(TodoOpDto.from({ kind: 'remove', id: 'a' }).kind).toBe('remove');
    expect(TodoOpDto.from({ kind: 'delegate', id: 'a' }).delegateId).toBe('a');
  });

  it('모르는 종류·번호 없음·값 모양이 틀리면 거절한다', () => {
    expect(() => TodoOpDto.from({ kind: 'drop-all' })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'remove' })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'add', title: 5 })).toThrow(TodoError);
    expect(() => TodoOpDto.from({ kind: 'edit', id: 'a', patch: { priority: 'x' } })).toThrow(TodoError);
    expect(() => TodoOpDto.from('x')).toThrow(TodoError);
  });

  it('요청을 모음에 적용한다', () => {
    let list = TodoOpDto.from({ kind: 'add', title: '하나', due: '2026-12-01' }).applyTo(TodoList.empty(), newId, at);
    const id = list.items[0]!.id;
    list = TodoOpDto.from({ kind: 'edit', id, patch: { due: null, priority: 'low' } }).applyTo(list, newId, at);
    expect(list.items[0]).toMatchObject({ due: null, priority: 'low' });
    list = TodoOpDto.from({ kind: 'move', id, status: 'done' }).applyTo(list, newId, at);
    expect(list.items[0]!.status).toBe('done');
    expect(TodoOpDto.from({ kind: 'remove', id }).applyTo(list, newId, at).items).toEqual([]);
  });

  it('맡기기는 모음에 직접 적용하지 않는다(팀에 보낸 뒤에 이어 붙인다)', () => {
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
});
