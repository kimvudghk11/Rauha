import { spawn } from 'node:child_process';

export interface RunOptions {
  /** 이 시간이 지나면 멈춘다(밀리초) */
  readonly timeoutMs?: number;
  /** stdout + stderr 합계 상한(바이트). 넘으면 멈춘다. */
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  readonly cwd?: string;
}

export interface RunOutcome {
  /** 시작하지 못했거나 신호로 끝나면 null */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly tooLarge: boolean;
  /** 실행 파일을 못 찾으면 ENOENT */
  readonly spawnCode?: string | undefined;
}

/** docker 를 고정 인자 배열로 한 번 돌리고 끝나면 결과를 돌려준다. 던지지 않는다. */
export type RunDocker = (args: readonly string[], options?: RunOptions) => Promise<RunOutcome>;

export interface StreamEnd {
  readonly code: number | null;
  /** 상한 때문에 멈췄거나 시작하지 못한 사유. 정상 종료·사용자가 멈춘 것이면 null */
  readonly note: string | null;
  readonly spawnCode?: string | undefined;
  readonly stderr: string;
}
export interface StreamHandle {
  stop(): void;
}
/** docker 를 돌리면서 출력(stdout·stderr 합쳐서)을 조각으로 흘려 보낸다(logs --follow). */
export type StreamDocker = (args: readonly string[], on: { readonly data: (chunk: string) => void; readonly end: (end: StreamEnd) => void }, options?: { readonly maxBytes?: number }) => StreamHandle;

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * 실제로 부를 프로그램. 보통 PATH 의 `docker`(윈도우는 docker.exe 를 찾아 준다).
 * 시험용으로 RAUHA_DOCKER_BIN 이 .js/.mjs/.cjs 면 앱 자신의 node(ELECTRON_RUN_AS_NODE)로, 아니면 그 실행 파일을 쓴다.
 */
export function dockerCommand(env: NodeJS.ProcessEnv, execPath: string): { readonly file: string; readonly prefix: readonly string[]; readonly env: NodeJS.ProcessEnv } {
  const base: NodeJS.ProcessEnv = { ...env, DOCKER_CLI_HINTS: 'false' };
  const bin = env['RAUHA_DOCKER_BIN'];
  if (bin === undefined || bin === '') return { file: 'docker', prefix: [], env: base };
  if (/\.(c|m)?js$/i.test(bin)) return { file: execPath, prefix: [bin], env: { ...base, ELECTRON_RUN_AS_NODE: '1' } };
  return { file: bin, prefix: [], env: base };
}

const decode = (parts: Buffer[]): string => Buffer.concat(parts).toString('utf8');

/** 진짜 docker 를 부르는 실행기. 셸을 거치지 않는다(spawn, 인자 배열). */
export const runDocker: RunDocker = (args, options = {}) =>
  new Promise((resolve) => {
    const cmd = dockerCommand(process.env, process.execPath);
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let cancelled = false;
    let tooLarge = false;
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const child = spawn(cmd.file, [...cmd.prefix, ...args], { cwd: options.cwd, env: cmd.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const finish = (code: number | null, spawnCode?: string): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout: decode(out), stderr: decode(err), timedOut, cancelled, tooLarge, spawnCode });
    };
    const kill = (): void => {
      try {
        child.kill();
      } catch {
        /* 이미 끝났다 */
      }
    };
    const onAbort = (): void => {
      cancelled = true;
      kill();
    };
    if (options.signal?.aborted === true) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const take = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        kill();
        return;
      }
      into.push(chunk);
    };
    child.stdout.on('data', take(out));
    child.stderr.on('data', take(err));
    child.on('error', (e: NodeJS.ErrnoException) => finish(null, e.code ?? 'ERROR'));
    child.on('close', (code) => finish(code));
  });

/** 진짜 docker 를 부르는 흐름 실행기(로그 따라가기). */
export const streamDocker: StreamDocker = (args, on, options = {}) => {
  const cmd = dockerCommand(process.env, process.execPath);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const child = spawn(cmd.file, [...cmd.prefix, ...args], { env: cmd.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let size = 0;
  let note: string | null = null;
  let stopped = false;
  let ended = false;
  const errTail: string[] = [];
  const kill = (): void => {
    try {
      child.kill();
    } catch {
      /* 이미 끝났다 */
    }
  };
  const feed = (isErr: boolean) => (chunk: Buffer) => {
    if (stopped) return;
    size += chunk.length;
    if (size > maxBytes) {
      note = 'Log size limit reached, so the stream was stopped. Press Clear and start again to see newer lines.';
      stopped = true;
      kill();
      return;
    }
    const text = chunk.toString('utf8');
    if (isErr && errTail.join('').length < 4000) errTail.push(text);
    on.data(text);
  };
  child.stdout.on('data', feed(false));
  child.stderr.on('data', feed(true));
  const finish = (code: number | null, spawnCode?: string): void => {
    if (ended) return;
    ended = true;
    on.end({ code, note, spawnCode, stderr: errTail.join('') });
  };
  child.on('error', (e: NodeJS.ErrnoException) => finish(null, e.code ?? 'ERROR'));
  child.on('close', (code) => finish(code));
  return {
    stop: () => {
      stopped = true;
      kill();
    },
  };
};
