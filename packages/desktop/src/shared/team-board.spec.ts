import { describe, expect, it } from 'vitest';
import { teamBoard, type BoardTask } from './team-board.js';

const at = (min: number): string => `2026-11-15T10:${String(min).padStart(2, '0')}:00.000Z`;
/** 그 분에 맡긴 태스크. ended 를 주면 그 분에 끝난 것, 안 주면 아직 도는 중 */
const t = (id: string, queued: number, ended: number | null = null, extra: Partial<BoardTask> = {}): BoardTask => ({
  id,
  queuedAt: at(queued),
  thread: null,
  live: ended === null,
  endedAt: ended === null ? null : at(ended),
  ...extra,
});
const START = at(0);
const tasks = (b: ReturnType<typeof teamBoard>) => b.filter((s) => s.kind === 'task');

describe('오른쪽 팀 목록', () => {
  it('일이 없어도 팀 5개가 기다린다', () => {
    expect(teamBoard([], START)).toEqual([{ kind: 'idle', n: 1 }, { kind: 'idle', n: 2 }, { kind: 'idle', n: 3 }, { kind: 'idle', n: 4 }, { kind: 'idle', n: 5 }]);
  });

  it('동시에 도는 일은 위 칸부터 하나씩 맡고 남은 칸은 기다린다', () => {
    const b = teamBoard([t('b', 2), t('a', 1)], START);
    expect(b).toEqual([{ kind: 'task', id: 'a', n: 1 }, { kind: 'task', id: 'b', n: 2 }, { kind: 'idle', n: 3 }, { kind: 'idle', n: 4 }, { kind: 'idle', n: 5 }]);
  });

  it('1팀이 일을 끝내고 쉬고 있으면 새 일은 2팀이 아니라 1팀이 맡는다', () => {
    const b = teamBoard([t('a', 1, 3), t('b', 5)], START);
    expect(tasks(b)).toEqual([{ kind: 'task', id: 'b', n: 1 }]);
    expect(b).toHaveLength(5);
  });

  it('1팀이 아직 일하는 중이면 새 일은 쉬는 팀 중 맨 위(2팀)가 맡는다', () => {
    expect(tasks(teamBoard([t('a', 1), t('b', 2)], START))).toEqual([{ kind: 'task', id: 'a', n: 1 }, { kind: 'task', id: 'b', n: 2 }]);
  });

  it('2팀이 도는 동안 1팀이 끝나면 다음 일은 1팀이 맡고 2팀은 제자리에 있다', () => {
    const b = teamBoard([t('a', 1, 4), t('b', 2), t('c', 6)], START);
    expect(tasks(b)).toEqual([{ kind: 'task', id: 'c', n: 1 }, { kind: 'task', id: 'b', n: 2 }]);
  });

  it('끝난 팀은 다음 일이 오기 전까지 자리를 지킨다(사라지지 않는다)', () => {
    expect(tasks(teamBoard([t('a', 1, 3)], START))).toEqual([{ kind: 'task', id: 'a', n: 1 }]);
  });

  it('일이 도는 중에 맡긴 일은 그 팀이 나중에 끝나도 자리를 옮기지 않는다', () => {
    // a 가 도는 중(1~4분)에 b 를 3분에 맡겼다 → b 는 2팀. a 가 4분에 끝났어도 b 는 2팀에 남는다
    expect(tasks(teamBoard([t('a', 1, 4), t('b', 3)], START))).toEqual([{ kind: 'task', id: 'a', n: 1 }, { kind: 'task', id: 'b', n: 2 }]);
  });

  it('5팀이 모두 바쁘면 6번째 일은 아래에 이어 붙는다(스크롤로 본다)', () => {
    const b = teamBoard(Array.from({ length: 7 }, (_, i) => t(`j${i}`, i + 1)), START);
    expect(b).toHaveLength(7);
    expect(b.every((s) => s.kind === 'task')).toBe(true);
  });

  it('이어서 물은 차례는 새 팀이 아니라 그 태스크 팀에 묶인다', () => {
    const b = teamBoard([t('a', 1), t('a2', 3, null, { thread: 'a' })], START);
    expect(tasks(b)).toEqual([{ kind: 'task', id: 'a', n: 1 }]);
  });

  it('쉬던 팀에 이어 말하면(activeAt) 그때 쉬는 팀 칸을 다시 맡는다', () => {
    // a(1팀) 끝 → b 가 1팀을 맡아 끝 → a 에 이어 말함(8분) → a 가 다시 1팀
    const b = teamBoard([t('a', 1, 2, { activeAt: at(8) }), t('b', 4, 6)], START);
    expect(tasks(b)).toEqual([{ kind: 'task', id: 'a', n: 1 }]);
  });

  it('앱을 켜기 전에 했던 지난 작업은 팀 목록에 올리지 않는다', () => {
    const b = teamBoard([{ id: 'old', queuedAt: '2026-11-14T09:00:00Z', thread: null, live: false, endedAt: '2026-11-14T09:05:00Z' }, t('new', 5)], START);
    expect(b[0]).toEqual({ kind: 'task', id: 'new', n: 1 });
  });

  it('창을 다시 열어 그 전에 맡긴 일이라도 아직 도는 일은 목록에 남는다', () => {
    const b = teamBoard([{ id: 'run', queuedAt: '2026-11-15T09:00:00Z', thread: null, live: true, endedAt: null }], START);
    expect(b[0]).toEqual({ kind: 'task', id: 'run', n: 1 });
  });
});
