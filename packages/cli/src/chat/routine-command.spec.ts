import { Routine, RoutineBook } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { markStarted, routineCommand, type RoutineStorePort } from './routine-command.js';

class MemoryStore implements RoutineStorePort {
  saves = 0;
  constructor(public book: RoutineBook = RoutineBook.empty()) {}
  async load() {
    return this.book;
  }
  async save(book: RoutineBook) {
    this.saves += 1;
    this.book = book;
  }
}
const daily = (id: string, request: string) => Routine.create({ id, request, cadence: { kind: 'daily' }, today: '2026-10-01' });
const today = '2026-11-01';
let n = 0;
const newId = () => `id-${(n += 1)}`;

describe('routineCommand', () => {
  it('목록은 등록된 정기 업무를 보여 준다', async () => {
    const store = new MemoryStore(RoutineBook.empty().add(daily('a', '릴리스 노트 써줘')));
    const effect = await routineCommand({ kind: 'routine', action: 'list' }, store, today, newId);
    expect(effect.lines.join('\n')).toContain('릴리스 노트 써줘');
    expect(effect.start).toEqual([]);
  });

  it('등록하면 저장하고 알려 준다', async () => {
    const store = new MemoryStore();
    const effect = await routineCommand({ kind: 'routine', action: 'add', cadence: { kind: 'daily' }, request: '지표 점검' }, store, today, newId);
    expect(store.book.routines).toHaveLength(1);
    expect(effect.lines.join('\n')).toContain('정기 업무를 등록했어요: 지표 점검');
  });

  it('등록하지 못하면(열 개가 넘을 때) 이유를 알려 주고 저장하지 않는다', async () => {
    let book = RoutineBook.empty();
    for (let i = 0; i < 10; i += 1) book = book.add(daily(`r${i}`, `일 ${i}`));
    const store = new MemoryStore(book);
    const effect = await routineCommand({ kind: 'routine', action: 'add', cadence: { kind: 'daily' }, request: '하나 더' }, store, today, newId);
    expect(store.saves).toBe(0);
    expect(effect.lines.join('\n')).not.toContain('등록했어요');
    expect(effect.lines.join('')).not.toBe('');
  });

  it('지우면 그 번호의 업무가 사라진다', async () => {
    const store = new MemoryStore(RoutineBook.empty().add(daily('a', '하나')).add(daily('b', '둘')));
    await routineCommand({ kind: 'routine', action: 'remove', number: 1 }, store, today, newId);
    expect(store.book.routines.map((r) => r.request)).toEqual(['둘']);
  });

  it('run은 때가 된 것을 돌릴 목록으로 돌려주지만 아직 했다고 표시하지 않는다', async () => {
    const store = new MemoryStore(RoutineBook.empty().add(daily('a', '하나')));
    const effect = await routineCommand({ kind: 'routine', action: 'run' }, store, today, newId);
    expect(effect.start).toEqual([{ id: 'a', request: '하나' }]);
    expect(store.saves).toBe(0);
  });

  it('때가 된 것이 없으면 run은 그렇게 알린다', async () => {
    const effect = await routineCommand({ kind: 'routine', action: 'run' }, new MemoryStore(), today, newId);
    expect(effect.start).toEqual([]);
    expect(effect.lines.join('')).toContain('때가 된 정기 업무가 없어요');
  });
});

describe('markStarted', () => {
  it('실제로 시작한 업무만 오늘 했다고 표시한다', async () => {
    const store = new MemoryStore(RoutineBook.empty().add(daily('a', '하나')).add(daily('b', '둘')));
    await markStarted(store, 'a', today);
    expect(store.book.routines.map((r) => r.lastRunOn)).toEqual([today, null]);
  });
});
