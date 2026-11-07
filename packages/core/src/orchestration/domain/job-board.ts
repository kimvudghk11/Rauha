import type { Job } from './job.js';

/** 함께 도는 작업 수의 기본 상한. 구독 한도를 아끼려고 작게 잡는다. */
export const DEFAULT_JOB_LIMIT = 3;

/**
 * 메인이 넘긴 작업 모음. 들어온 순서를 지키고, 자리(진행·기다림)가 상한보다 적을 때만 다음 대기 작업을 시작하게 한다.
 * 값은 불변이다.
 */
export class JobBoard {
  private constructor(
    readonly limit: number,
    readonly jobs: readonly Job[],
  ) {}

  /** 상한은 1보다 작을 수 없다. */
  static empty(limit: number = DEFAULT_JOB_LIMIT): JobBoard {
    return new JobBoard(Math.max(1, Math.floor(limit)), []);
  }

  add(job: Job): JobBoard {
    if (this.find(job.id) !== null) throw new Error(`이미 있는 작업이다: ${job.id}`);
    return new JobBoard(this.limit, [...this.jobs, job]);
  }

  replace(job: Job): JobBoard {
    if (this.find(job.id) === null) throw new Error(`없는 작업이다: ${job.id}`);
    return new JobBoard(this.limit, this.jobs.map((j) => (j.id === job.id ? job : j)));
  }

  find(id: string): Job | null {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  /** 지금 시작해도 되는 대기 작업. 먼저 들어온 것부터, 빈 자리만큼. */
  startable(): readonly Job[] {
    const free = this.limit - this.jobs.filter((j) => j.holdsSlot).length;
    return free <= 0 ? [] : this.jobs.filter((j) => j.status === 'queued').slice(0, free);
  }

  counts(): { running: number; waiting: number; queued: number } {
    const count = (status: Job['status']) => this.jobs.filter((j) => j.status === status).length;
    return { running: count('running'), waiting: count('waiting'), queued: count('queued') };
  }
}
