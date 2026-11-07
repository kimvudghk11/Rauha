import { describe, expect, it } from 'vitest';
import type { Job } from '../domain/job.js';
import type { JobBoard } from '../domain/job-board.js';
import { JobRunner } from './job-runner.js';

/** 테스트가 끝을 쥐고 있는 일. id마다 resolve/reject와 받은 신호를 남긴다. */
function controlledWork() {
  const calls = new Map<string, { resolve: () => void; reject: (e: unknown) => void; signal: AbortSignal }>();
  const work = (job: Job, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      calls.set(job.id, { resolve, reject, signal });
    });
  return { work, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function runner(onChange?: (b: JobBoard) => void, limit?: number) {
  const { work, calls } = controlledWork();
  let n = 0;
  const r = JobRunner.start({
    work,
    newId: () => `j${++n}`,
    now: () => '2026-11-08T00:00:00.000Z',
    ...(limit !== undefined ? { limit } : {}),
    ...(onChange !== undefined ? { onChange } : {}),
  });
  return { r, calls };
}

describe('JobRunner', () => {
  it('일을 넣으면 끝나기를 기다리지 않고 바로 돌아온다', () => {
    const { r } = runner();
    const job = r.submit('결제 타임아웃 원인 찾아줘');
    expect(job?.id).toBe('j1');
    expect(r.board.find('j1')?.status).toBe('running');
  });

  it('네 번째 일은 앞의 일이 끝날 때까지 대기한다', async () => {
    const { r, calls } = runner();
    ['a', 'b', 'c', 'd'].forEach((t) => r.submit(t));
    expect(r.board.counts()).toEqual({ running: 3, waiting: 0, queued: 1 });
    calls.get('j1')!.resolve();
    await flush();
    expect(r.board.find('j1')?.status).toBe('done');
    expect(r.board.find('j4')?.status).toBe('running');
    expect(r.board.counts()).toEqual({ running: 3, waiting: 0, queued: 0 });
  });

  it('일이 실패해도 멈춤으로 표시하고 다음 대기 일을 시작한다', async () => {
    const { r, calls } = runner(undefined, 1);
    r.submit('a');
    r.submit('b');
    calls.get('j1')!.reject(new Error('boom'));
    await flush();
    expect(r.board.find('j1')?.status).toBe('stopped');
    expect(r.board.find('j1')?.stopReason).toBe('boom');
    expect(r.board.find('j2')?.status).toBe('running');
  });

  it('멈추면 그 일의 신호가 꺼지고 자리가 빈다', async () => {
    const { r, calls } = runner(undefined, 1);
    r.submit('a');
    r.submit('b');
    r.stop('j1');
    expect(calls.get('j1')!.signal.aborted).toBe(true);
    expect(r.board.find('j1')?.status).toBe('stopped');
    expect(r.board.find('j1')?.stopReason).toBe('사용자가 멈춤');
    expect(r.board.find('j2')?.status).toBe('running');
    // 멈춘 뒤 일이 늦게 끝나도 멈춤은 그대로다.
    calls.get('j1')!.resolve();
    await flush();
    expect(r.board.find('j1')?.status).toBe('stopped');
  });

  it('대기 중인 일도 멈출 수 있고, 그 일은 시작되지 않는다', async () => {
    const { r, calls } = runner(undefined, 1);
    r.submit('a');
    r.submit('b');
    r.stop('j2');
    calls.get('j1')!.resolve();
    await flush();
    expect(calls.has('j2')).toBe(false);
    expect(r.board.find('j2')?.status).toBe('stopped');
  });

  it('끝난 일이나 없는 일을 멈춰도 아무 일 없다', async () => {
    const { r, calls } = runner();
    r.submit('a');
    calls.get('j1')!.resolve();
    await flush();
    r.stop('j1');
    r.stop('없음');
    expect(r.board.find('j1')?.status).toBe('done');
  });

  it('빈 요청은 넣지 않는다', () => {
    const changes: JobBoard[] = [];
    const { r } = runner((b) => changes.push(b));
    expect(r.submit('   ')).toBeNull();
    expect(changes).toEqual([]);
    expect(r.board.jobs).toEqual([]);
  });

  it('판이 바뀔 때마다 알린다', async () => {
    const changes: JobBoard[] = [];
    const { r, calls } = runner((b) => changes.push(b));
    r.submit('a');
    calls.get('j1')!.resolve();
    await flush();
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.at(-1)?.find('j1')?.status).toBe('done');
  });

  it('모든 일이 끝날 때까지 기다릴 수 있다', async () => {
    const { r, calls } = runner();
    r.submit('a');
    r.submit('b');
    const idle = r.idle();
    calls.get('j1')!.resolve();
    calls.get('j2')!.resolve();
    await idle;
    expect(r.board.jobs.every((j) => j.isOver)).toBe(true);
  });
});

describe('JobRunner 보고', () => {
  type Report = import('./job-runner.js').JobReport;
  const start = (onChange?: (b: JobBoard) => void) => {
    const holder: { report: Report | null; finish: () => void } = { report: null, finish: () => undefined };
    const r = JobRunner.start({
      work: (_job, _signal, report) => {
        holder.report = report;
        return new Promise<void>((resolve) => (holder.finish = resolve));
      },
      newId: () => 'j1',
      now: () => '2026-11-08T00:00:00.000Z',
      ...(onChange !== undefined ? { onChange } : {}),
    });
    r.submit('일');
    return { r, holder };
  };

  it('일하는 쪽이 남긴 한 줄과 결과가 작업에 붙고 판이 바뀐 것으로 알린다', () => {
    const seen: JobBoard[] = [];
    const { r, holder } = start((b) => seen.push(b));
    const before = seen.length;
    holder.report!.note('implementer', '구현 중');
    holder.report!.result('결과');
    expect(r.board.find('j1')?.lastNote?.message).toBe('구현 중');
    expect(r.board.find('j1')?.activeRole).toBe('implementer');
    expect(r.board.find('j1')?.result).toBe('결과');
    expect(seen.length).toBe(before + 2);
  });

  it('허락을 기다리면 기다림 상태가 되고 자리는 그대로 차지하며, 답이 오면 다시 진행한다', () => {
    const { r, holder } = start();
    holder.report!.waiting(true);
    expect(r.board.find('j1')?.status).toBe('waiting');
    expect(r.board.counts().waiting).toBe(1);
    holder.report!.waiting(true);
    holder.report!.waiting(false);
    expect(r.board.find('j1')?.status).toBe('running');
  });

  it('끝난 일이 늦게 알려도 아무 일 없다', async () => {
    const { r, holder } = start();
    holder.finish();
    await flush();
    holder.report!.note('tester', '늦은 알림');
    expect(r.board.find('j1')?.notes.length).toBe(0);
  });
});
