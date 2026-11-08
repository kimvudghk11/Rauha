import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { failureReason, loginUrlFrom, parseLoginStatus, type LoginFailure, type LoginView } from '../../shared/claude-login.js';

export interface ClaudeLoginDeps {
  /** 앱에 들어 있는 Claude Code 실행 파일(없으면 undefined). PATH의 claude는 쓰지 않는다(맥 Finder 실행에는 PATH가 없다). */
  readonly executable: () => string | undefined;
  /** 로그인할 계정의 환경(CLAUDE_CONFIG_DIR 포함). 토큰은 다루지 않는다. */
  readonly env: () => Promise<NodeJS.ProcessEnv>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly onChange: (view: LoginView) => void;
  readonly spawn?: typeof nodeSpawn;
  readonly timeoutMs?: number;
  readonly statusTimeoutMs?: number;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const STATUS_TIMEOUT_MS = 10_000;

/** Electron 안에서 자식이 Node로만 돌지 않게 이 변수는 넘기지 않는다. */
const cleanEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { ELECTRON_RUN_AS_NODE: _drop, ...rest } = env;
  return rest;
};

/**
 * 앱 안 Claude 로그인. 앱에 들어 있는 실행 파일을 계정의 CLAUDE_CONFIG_DIR로 `auth login` 하고,
 * 출력에 나온 https 주소를 브라우저로 연다. 끝나면 `auth status`로 로그인 상태를 다시 읽는다.
 * 한 번에 하나만 돈다. 토큰 파일은 읽지도 옮기지도 않는다.
 */
export class ClaudeLogin {
  private current: LoginView = { state: 'idle', message: null };
  private child: ChildProcess | null = null;
  private cancelled = false;
  private readonly spawn: typeof nodeSpawn;

  constructor(private readonly deps: ClaudeLoginDeps) {
    this.spawn = deps.spawn ?? nodeSpawn;
  }

  view(): LoginView {
    return this.current;
  }

  /** 지금 계정이 로그인돼 있는지. 모르면 null(실행 파일이 없거나 시간이 걸릴 때). */
  async status(): Promise<boolean | null> {
    const exe = this.deps.executable();
    if (exe === undefined) return null;
    const env = cleanEnv(await this.deps.env());
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      let child: ChildProcess;
      const finish = (value: boolean | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      try {
        child = this.spawn(exe, ['auth', 'status'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        return resolve(null);
      }
      const timer = setTimeout(() => {
        child.kill();
        finish(null);
      }, this.deps.statusTimeoutMs ?? STATUS_TIMEOUT_MS);
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.on('error', () => finish(null));
      child.on('close', () => finish(parseLoginStatus(out)));
    });
  }

  /** 로그인을 시작한다. 이미 돌고 있으면 그대로 둔다. 끝나면(성공·실패·취소) 그 상태로 resolve한다. */
  async start(): Promise<LoginView> {
    if (this.current.state === 'running') return this.current;
    this.cancelled = false;
    this.set({ state: 'running', message: null });
    const exe = this.deps.executable();
    if (exe === undefined) return this.fail({ kind: 'no-executable' });
    let env: NodeJS.ProcessEnv;
    try {
      env = cleanEnv(await this.deps.env());
    } catch (error) {
      return this.set({ state: 'failed', message: error instanceof Error ? error.message : '계정 설정을 읽지 못했어요.' });
    }
    return new Promise((resolve) => {
      let output = '';
      let opened = false;
      let ended = false;
      const end = (view: LoginView) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        this.child = null;
        resolve(view);
      };
      let child: ChildProcess;
      try {
        child = this.spawn(exe, ['auth', 'login'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        return end(this.fail({ kind: 'no-executable' }));
      }
      this.child = child;
      const timer = setTimeout(() => {
        child.kill();
        end(this.fail({ kind: 'timeout' }));
      }, this.deps.timeoutMs ?? LOGIN_TIMEOUT_MS);
      const take = (d: Buffer) => {
        output += d.toString();
        if (opened) return;
        const url = loginUrlFrom(output);
        if (url === null) return;
        opened = true;
        void this.deps.openExternal(url).catch(() => undefined);
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      child.on('error', () => end(this.fail({ kind: 'no-executable' })));
      child.on('close', (code) => {
        if (ended) return;
        if (this.cancelled) return end(this.set({ state: 'cancelled', message: null }));
        if (code !== 0) return end(this.fail({ kind: 'exit', code: code ?? 1, output }));
        void this.status().then((loggedIn) => end(loggedIn === true ? this.set({ state: 'success', message: null }) : this.fail({ kind: 'not-confirmed' })));
      });
    });
  }

  /** 돌고 있는 로그인을 멈춘다. */
  cancel(): void {
    if (this.current.state !== 'running' || this.child === null) return;
    this.cancelled = true;
    this.child.kill();
  }

  private fail(failure: LoginFailure): LoginView {
    return this.set({ state: 'failed', message: failureReason(failure) });
  }

  private set(view: LoginView): LoginView {
    this.current = view;
    this.deps.onChange(view);
    return view;
  }
}
