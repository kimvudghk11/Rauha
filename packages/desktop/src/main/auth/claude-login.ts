import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { accountFromStatus, shortPath, unknownBecause, type AccountCheck, type AccountState } from '../../shared/account-state.js';
import { failureReason, loginUrlFrom, type LoginFailure, type LoginView } from '../../shared/claude-login.js';

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
    const { state } = await this.check();
    return state.kind === 'signed-in' ? true : state.kind === 'signed-out' ? false : null;
  }

  /** 계정 구역에 보일 상태: 누구로 로그인됨 / 로그인 안 됨 / 확인 못 함(이유 한 줄). 읽지 못한 것을 "로그인 안 됨"으로 말하지 않는다. */
  async check(): Promise<AccountCheck> {
    const exe = this.deps.executable();
    if (exe === undefined) return { state: unknownBecause({ kind: 'no-executable' }), configDir: null };
    let env: NodeJS.ProcessEnv;
    try {
      env = cleanEnv(await this.deps.env());
    } catch (error) {
      return { state: unknownBecause({ kind: 'config', message: error instanceof Error ? error.message : String(error) }), configDir: null };
    }
    const dir = env['CLAUDE_CONFIG_DIR'];
    const configDir = dir === undefined ? null : shortPath(dir, env['HOME'] ?? env['USERPROFILE'] ?? null);
    return { state: await this.readStatus(exe, env), configDir };
  }

  private readStatus(exe: string, env: NodeJS.ProcessEnv): Promise<AccountState> {
    const timeoutMs = this.deps.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      let done = false;
      let child: ChildProcess;
      const finish = (value: AccountState) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      try {
        child = this.spawn(exe, ['auth', 'status'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        return resolve(unknownBecause({ kind: 'spawn', message: error instanceof Error ? error.message : String(error) }));
      }
      const timer = setTimeout(() => {
        child.kill();
        finish(unknownBecause({ kind: 'timeout', seconds: Math.max(1, Math.round(timeoutMs / 1000)) }));
      }, timeoutMs);
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', (error) => finish(unknownBecause({ kind: 'spawn', message: error.message })));
      child.on('close', (code) => {
        const state = accountFromStatus(out);
        // 출력이 비었는데 오류로 끝났으면 읽을 수 없는 답이 아니라 종료 코드와 마지막 오류 줄을 이유로 든다
        finish(state.kind === 'unknown' && out.trim() === '' && code !== 0 ? unknownBecause({ kind: 'exit', code: code ?? 1, stderr: err }) : state);
      });
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
