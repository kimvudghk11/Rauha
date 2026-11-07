import { describe, expect, it } from 'vitest';
import { Job, JobBoard } from '@rauha/core/jobs';
import { boardView } from './ipc.js';

const AT = '2026-11-08T00:00:00.000Z';

describe('boardView', () => {
  it('작업판을 화면용 모양으로 바꾼다 — 상태 수와 상한을 담는다', () => {
    const a = Job.queue({ id: 'a', request: '결제 타임아웃 원인 찾아줘', at: AT })!;
    const b = Job.queue({ id: 'b', request: '온보딩 시안', at: AT })!;
    const board = JobBoard.empty().add(a).add(b);
    const view = boardView(board.replace(a.start()));
    expect(view).toEqual({
      jobs: [
        { id: 'a', request: '결제 타임아웃 원인 찾아줘', status: 'running', stopReason: null },
        { id: 'b', request: '온보딩 시안', status: 'queued', stopReason: null },
      ],
      running: 1,
      waiting: 0,
      queued: 1,
      limit: 3,
    });
  });

  it('멈춘 이유를 함께 보낸다', () => {
    const a = Job.queue({ id: 'a', request: 'x', at: AT })!;
    const view = boardView(JobBoard.empty().add(a.stop('사용자가 멈춤', AT)));
    expect(view.jobs[0]?.stopReason).toBe('사용자가 멈춤');
  });
});
