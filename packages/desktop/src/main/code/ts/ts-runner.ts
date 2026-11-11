import { Worker } from 'node:worker_threads';
import type { TsRequest, TsResponse, TsWorkerData, TsWorkerIn, TsWorkerOut } from './ts-protocol.js';

export type TsRunResult = { readonly ok: true; readonly res: TsResponse } | { readonly ok: false; readonly reason: 'timeout' | 'unavailable' | 'error' };

export interface TsRunner {
  request(root: string, req: TsRequest): Promise<TsRunResult>;
  stop(): void;
}

export interface TsRunnerDeps {
  /** worker 파일(ts-worker 를 typescript 와 함께 묶은 것). 없으면 null */
  readonly workerFile: () => string | null;
  /** typescript 의 lib.*.d.ts 폴더. 없으면 null(문법 오류만 본다) */
  readonly libDir: () => string | null;
}

/** 요청 하나의 시간 상한(처음에는 프로젝트를 읽느라 몇 초 걸린다) */
export const TS_REQUEST_TIMEOUT_MS = 30_000;
/** 이 시간 동안 요청이 없으면 worker 를 끝낸다(메모리를 돌려준다) */
export const TS_IDLE_MS = 3 * 60_000;
/** 한 worker 의 힙 상한 */
const HEAP_MB = 1536;

interface Pending {
  readonly resolve: (r: TsRunResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * TypeScript 언어 도구를 worker 스레드 하나로 돌린다. 작업 폴더가 바뀌면 새로 띄우고, 요청이 시간을 넘기면 worker 를 끊고
 * 다음 요청에서 새로 띄운다. 쉬는 동안은 끝낸다.
 */
export class WorkerTsRunner implements TsRunner {
  private worker: Worker | null = null;
  private root = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly deps: TsRunnerDeps,
    private readonly limits: { readonly timeoutMs: number; readonly idleMs: number } = { timeoutMs: TS_REQUEST_TIMEOUT_MS, idleMs: TS_IDLE_MS },
  ) {}

  request(root: string, req: TsRequest): Promise<TsRunResult> {
    const worker = this.ensure(root);
    if (worker === null) return Promise.resolve({ ok: false, reason: 'unavailable' });
    clearTimeout(this.idleTimer);
    return new Promise<TsRunResult>((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.failAll('timeout');
        this.kill();
      }, this.limits.timeoutMs);
      this.pending.set(id, { resolve, timer });
      const msg: TsWorkerIn = { id, req };
      worker.postMessage(msg);
    });
  }

  stop(): void {
    this.failAll('error');
    this.kill();
  }

  private ensure(root: string): Worker | null {
    if (this.worker !== null && this.root === root) return this.worker;
    this.stop();
    const file = this.deps.workerFile();
    if (file === null) return null;
    const data: TsWorkerData = { root, libDir: this.deps.libDir() ?? '' };
    try {
      const worker = new Worker(file, { workerData: data, env: {}, resourceLimits: { maxOldGenerationSizeMb: HEAP_MB } });
      worker.unref();
      worker.on('message', (m: TsWorkerOut) => this.onMessage(m));
      worker.on('error', () => {
        if (this.worker === worker) {
          this.failAll('error');
          this.kill();
        }
      });
      worker.on('exit', () => {
        if (this.worker === worker) {
          this.failAll('error');
          this.worker = null;
        }
      });
      this.worker = worker;
      this.root = root;
      return worker;
    } catch {
      return null;
    }
  }

  private onMessage(m: TsWorkerOut): void {
    if ('ready' in m) return;
    const p = this.pending.get(m.id);
    if (p === undefined) return;
    clearTimeout(p.timer);
    this.pending.delete(m.id);
    p.resolve('res' in m ? { ok: true, res: m.res } : { ok: false, reason: 'error' });
    if (this.pending.size === 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.kill(), this.limits.idleMs);
    }
  }

  private failAll(reason: 'timeout' | 'error'): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, reason });
    }
    this.pending.clear();
  }

  private kill(): void {
    clearTimeout(this.idleTimer);
    const w = this.worker;
    this.worker = null;
    this.root = '';
    if (w !== null) void w.terminate();
  }
}
