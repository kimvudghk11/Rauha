import { describe, expect, it } from 'vitest';
import { beforeIdAt, place, reorder } from './todo-order.js';

interface Card { id: string; columnId: string }
const c = (id: string, columnId: string): Card => ({ id, columnId });
const withColumn = (columnId: string) => (card: Card): Card => ({ ...card, columnId });
const ids = (cards: readonly Card[]): string => cards.map((x) => `${x.columnId}:${x.id}`).join(' ');

describe('카드 자리 계산', () => {
  const items = [c('a', 'todo'), c('b', 'doing'), c('c', 'todo'), c('d', 'done')];

  it('다른 칸의 어느 카드 앞에 놓으면 그 카드 바로 앞으로 들어간다', () => {
    expect(ids(place(items, 'a', 'doing', 'b', withColumn('doing')))).toBe('doing:a doing:b todo:c done:d');
  });

  it('앞 카드를 비우면(null) 그 칸의 맨 끝으로 간다', () => {
    expect(ids(place(items, 'a', 'doing', null, withColumn('doing')))).toBe('doing:b doing:a todo:c done:d');
  });

  it('칸 안에서 순서만 바꿔도 된다', () => {
    expect(ids(place(items, 'c', 'todo', 'a', withColumn('todo')))).toBe('todo:c todo:a doing:b done:d');
    expect(ids(place(items, 'a', 'todo', null, withColumn('todo')))).toBe('doing:b todo:c todo:a done:d');
  });

  it('빈 칸으로 옮길 수 있다', () => {
    expect(ids(place([c('a', 'todo')], 'a', 'done', null, withColumn('done')))).toBe('done:a');
  });

  it('자기 자신 앞에 놓으면 제자리다', () => {
    expect(ids(place(items, 'a', 'todo', 'a', withColumn('todo')))).toBe(ids(items));
  });

  it('앞 카드가 다른 칸 것이면 그 칸 맨 끝으로 본다', () => {
    expect(ids(place(items, 'a', 'doing', 'd', withColumn('doing')))).toBe('doing:b doing:a todo:c done:d');
  });

  it('없는 카드는 건드리지 않고 그대로 돌려준다', () => {
    expect(place(items, '없음', 'doing', null, withColumn('doing'))).toBe(items);
  });
});

describe('칸 순서 바꾸기', () => {
  const cols = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  it('칸을 다른 칸 앞으로 옮긴다', () => {
    expect(reorder(cols, 'z', 'x').map((k) => k.id)).toEqual(['z', 'x', 'y']);
  });
  it('앞 칸을 비우면 맨 끝으로 간다', () => {
    expect(reorder(cols, 'x', null).map((k) => k.id)).toEqual(['y', 'z', 'x']);
  });
  it('모르는 칸 번호는 그대로 둔다', () => {
    expect(reorder(cols, 'q', 'x')).toBe(cols);
  });
});

describe('놓을 자리 표시선 위치', () => {
  const rects = [{ id: 'a', start: 0, size: 40 }, { id: 'b', start: 48, size: 40 }, { id: 'c', start: 96, size: 40 }];
  it('포인터가 어느 카드 가운데보다 위면 그 카드 앞이다', () => {
    expect(beforeIdAt(rects, 10)).toBe('a');
    expect(beforeIdAt(rects, 60)).toBe('b');
  });
  it('모든 카드의 가운데보다 아래면 맨 끝(null)이다', () => {
    expect(beforeIdAt(rects, 200)).toBeNull();
    expect(beforeIdAt([], 5)).toBeNull();
  });
  it('끌고 있는 카드는 계산에서 뺀다', () => {
    expect(beforeIdAt(rects, 10, 'a')).toBe('b');
  });
});
