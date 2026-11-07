import { describe, expect, it } from 'vitest';
import { Job } from './job.js';

const AT = '2026-11-08T00:00:00.000Z';
const LATER = '2026-11-08T00:01:00.000Z';
const queued = (id = 'a', request = '결제 타임아웃 원인 찾아줘') => Job.queue({ id, request, at: AT })!;

describe('Job.queue', () => {
  it('빈 요청이나 공백만 있는 요청은 작업이 되지 않는다', () => {
    expect(Job.queue({ id: 'a', request: '', at: AT })).toBeNull();
    expect(Job.queue({ id: 'a', request: '   \n ', at: AT })).toBeNull();
  });

  it('요청 앞뒤 공백은 지우고 대기로 시작한다', () => {
    const job = Job.queue({ id: 'a', request: '  문서 정리해줘 \n', at: AT })!;
    expect(job.request).toBe('문서 정리해줘');
    expect(job.status).toBe('queued');
    expect(job.queuedAt).toBe(AT);
    expect(job.endedAt).toBeNull();
  });
});

describe('Job 상태 바꾸기', () => {
  it('대기 → 진행 → 끝, 끝난 시각을 남긴다', () => {
    const done = queued().start().finish(LATER);
    expect(done.status).toBe('done');
    expect(done.endedAt).toBe(LATER);
  });

  it('진행 중 기다림으로 갔다가 다시 진행한다', () => {
    const job = queued().start().wait();
    expect(job.status).toBe('waiting');
    expect(job.resume().status).toBe('running');
  });

  it('멈추면 이유와 시각을 남긴다', () => {
    const stopped = queued().start().stop('사용자가 멈춤', LATER);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stopReason).toBe('사용자가 멈춤');
    expect(stopped.endedAt).toBe(LATER);
  });

  it('대기 중인 작업도 멈출 수 있다', () => {
    expect(queued().stop('사용자가 멈춤', LATER).status).toBe('stopped');
  });

  it('끝났거나 멈춘 작업은 다시 바뀌지 않는다', () => {
    const done = queued().start().finish(LATER);
    expect(done.stop('사용자가 멈춤', LATER)).toBe(done);
    expect(done.finish(LATER)).toBe(done);
    const stopped = queued().stop('x', LATER);
    expect(stopped.finish(LATER)).toBe(stopped);
  });

  it('대기가 아닌 작업은 시작할 수 없다', () => {
    expect(() => queued().start().start()).toThrow();
  });

  it('진행 중이 아닌 작업은 기다림으로 갈 수 없고, 기다림이 아닌 작업은 다시 진행할 수 없다', () => {
    expect(() => queued().wait()).toThrow();
    expect(() => queued().start().resume()).toThrow();
  });

  it('바꿔도 원래 작업은 그대로다', () => {
    const job = queued();
    job.start();
    expect(job.status).toBe('queued');
  });
});

describe('Job.holdsSlot · isOver', () => {
  it('진행과 기다림은 자리를 차지하고, 대기·끝·멈춤은 차지하지 않는다', () => {
    const job = queued();
    expect(job.holdsSlot).toBe(false);
    expect(job.start().holdsSlot).toBe(true);
    expect(job.start().wait().holdsSlot).toBe(true);
    expect(job.start().finish(LATER).holdsSlot).toBe(false);
    expect(job.stop('x', LATER).holdsSlot).toBe(false);
  });

  it('끝과 멈춤만 끝난 작업이다', () => {
    expect(queued().isOver).toBe(false);
    expect(queued().start().isOver).toBe(false);
    expect(queued().start().finish(LATER).isOver).toBe(true);
    expect(queued().stop('x', LATER).isOver).toBe(true);
  });
});
