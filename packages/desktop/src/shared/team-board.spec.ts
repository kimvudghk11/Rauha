import { describe, expect, it } from 'vitest';
import { teamBoard, type BoardTask } from './team-board.js';

const t = (id: string, queuedAt: string, extra: Partial<BoardTask> = {}): BoardTask => ({ id, queuedAt, thread: null, ...extra });
const START = '2026-11-15T10:00:00.000Z';

describe('오른쪽 팀 목록', () => {
  it('일이 없어도 팀 5개가 기다린다', () => {
    expect(teamBoard([], START)).toEqual([{ kind: 'idle', n: 1 }, { kind: 'idle', n: 2 }, { kind: 'idle', n: 3 }, { kind: 'idle', n: 4 }, { kind: 'idle', n: 5 }]);
  });

  it('맡긴 순서대로 위 칸부터 채우고 남은 칸은 기다린다', () => {
    const b = teamBoard([t('b', '2026-11-15T10:02:00Z'), t('a', '2026-11-15T10:01:00Z')], START);
    expect(b).toEqual([{ kind: 'task', id: 'a', n: 1 }, { kind: 'task', id: 'b', n: 2 }, { kind: 'idle', n: 3 }, { kind: 'idle', n: 4 }, { kind: 'idle', n: 5 }]);
  });

  it('5개가 넘으면 기다리는 칸 없이 모두 이어 붙는다(스크롤로 본다)', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => t(`j${i}`, `2026-11-15T10:0${i}:30Z`));
    const b = teamBoard(tasks, START);
    expect(b).toHaveLength(7);
    expect(b.every((s) => s.kind === 'task')).toBe(true);
  });

  it('이어서 물은 차례는 새 팀이 아니라 그 태스크 팀에 묶인다', () => {
    const b = teamBoard([t('a', '2026-11-15T10:01:00Z'), t('a2', '2026-11-15T10:03:00Z', { thread: 'a' })], START);
    expect(b.filter((s) => s.kind === 'task')).toEqual([{ kind: 'task', id: 'a', n: 1 }]);
  });

  it('앱을 켜기 전에 했던 지난 작업은 팀 목록에 올리지 않는다', () => {
    const b = teamBoard([t('old', '2026-11-14T09:00:00Z'), t('new', '2026-11-15T10:05:00Z')], START);
    expect(b[0]).toEqual({ kind: 'task', id: 'new', n: 1 });
  });

  it('창을 다시 열어 그 전에 맡긴 일이라도 아직 도는 일은 목록에 남는다', () => {
    const b = teamBoard([t('run', '2026-11-15T09:00:00Z', { live: true })], START);
    expect(b[0]).toEqual({ kind: 'task', id: 'run', n: 1 });
  });
});
