import { describe, expect, it } from 'vitest';
import { Job } from './job.js';
import { DEFAULT_JOB_LIMIT, JobBoard } from './job-board.js';

const AT = '2026-11-08T00:00:00.000Z';
const job = (id: string) => Job.queue({ id, request: `일 ${id}`, at: AT })!;
const boardOf = (...ids: string[]) => ids.reduce((b, id) => b.add(job(id)), JobBoard.empty());

describe('JobBoard', () => {
  it('기본 상한은 3이다', () => {
    expect(DEFAULT_JOB_LIMIT).toBe(3);
    expect(JobBoard.empty().limit).toBe(3);
  });

  it('진행 중이 상한보다 적으면 먼저 들어온 대기 작업부터 시작할 수 있다', () => {
    expect(boardOf('a', 'b', 'c', 'd', 'e').startable().map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('진행 중인 만큼 시작할 수 있는 수가 줄어든다', () => {
    const board = boardOf('a', 'b', 'c', 'd');
    const started = board.replace(board.find('a')!.start()).replace(board.find('b')!.start());
    expect(started.startable().map((j) => j.id)).toEqual(['c']);
  });

  it('기다리는 작업도 자리를 차지한다', () => {
    const board = boardOf('a', 'b', 'c', 'd');
    const full = board
      .replace(board.find('a')!.start())
      .replace(board.find('b')!.start())
      .replace(board.find('c')!.start().wait());
    expect(full.startable()).toEqual([]);
    expect(full.counts()).toEqual({ running: 2, waiting: 1, queued: 1 });
  });

  it('끝난 작업은 자리를 비운다', () => {
    const board = boardOf('a', 'b', 'c', 'd');
    const next = board
      .replace(board.find('a')!.start().finish(AT))
      .replace(board.find('b')!.start())
      .replace(board.find('c')!.start());
    expect(next.startable().map((j) => j.id)).toEqual(['d']);
  });

  it('상한을 바꿀 수 있다', () => {
    const board = ['a', 'b', 'c'].reduce((b, id) => b.add(job(id)), JobBoard.empty(1));
    expect(board.startable().map((j) => j.id)).toEqual(['a']);
  });

  it('상한은 1보다 작을 수 없다', () => {
    expect(JobBoard.empty(0).limit).toBe(1);
  });

  it('같은 id를 두 번 넣으면 거절한다', () => {
    expect(() => boardOf('a').add(job('a'))).toThrow();
  });

  it('없는 작업은 바꿀 수 없다', () => {
    expect(() => boardOf('a').replace(job('z'))).toThrow();
  });

  it('바꿔도 원래 판은 그대로다', () => {
    const board = boardOf('a');
    board.replace(board.find('a')!.start());
    expect(board.find('a')!.status).toBe('queued');
  });
});
