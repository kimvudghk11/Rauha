import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ClaudeLogin } from './claude-login.js';
import type { LoginView } from '../../shared/claude-login.js';

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number;
  hang?: boolean;
  error?: boolean;
}

/** 가짜 Claude 실행 파일: 인자(auth login / auth status)별로 정해 둔 출력을 내고 닫힌다. 진짜 로그인은 하지 않는다. */
function fake(scripts: { login?: Script; status?: Script }) {
  const calls: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const killed: string[] = [];
  const spawn = ((file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ file, args, env: options.env });
    const kind = args[1] === 'login' ? 'login' : 'status';
    const script = scripts[kind] ?? {};
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {
        killed.push(kind);
        setImmediate(() => child.emit('close', null));
        return true;
      },
    });
    setImmediate(() => {
      if (script.error) return child.emit('error', new Error('spawn ENOENT'));
      if (script.stdout !== undefined) child.stdout.emit('data', Buffer.from(script.stdout));
      if (script.stderr !== undefined) child.stderr.emit('data', Buffer.from(script.stderr));
      if (script.hang) return;
      setImmediate(() => child.emit('close', script.code ?? 0));
    });
    return child;
  }) as never;
  return { calls, killed, spawn };
}

function setup(scripts: Parameters<typeof fake>[0], extra: { executable?: string | undefined; timeoutMs?: number } = {}) {
  const f = fake(scripts);
  const opened: string[] = [];
  const views: LoginView[] = [];
  const login = new ClaudeLogin({
    executable: () => ('executable' in extra ? extra.executable : '/Applications/rauha.app/claude'),
    env: async () => ({ PATH: '', CLAUDE_CONFIG_DIR: '/home/kim/.claude-work', ELECTRON_RUN_AS_NODE: '1' }),
    openExternal: async (url) => void opened.push(url),
    onChange: (v) => views.push(v),
    spawn: f.spawn,
    timeoutMs: extra.timeoutMs ?? 5000,
    statusTimeoutMs: 50,
  });
  return { ...f, login, opened, views };
}

const LOGGED_IN = { stdout: '{"loggedIn": true}' };

describe('ClaudeLogin', () => {
  it('앱 안 실행 파일을 계정의 설정 폴더로 auth login 하고, 출력의 https 주소를 브라우저로 연다', async () => {
    const s = setup({ login: { stdout: 'Visit https://claude.ai/oauth/authorize?x=1 to sign in\n' }, status: LOGGED_IN });
    const done = await s.login.start();
    expect(done).toEqual({ state: 'success', message: null });
    expect(s.calls[0]).toMatchObject({ file: '/Applications/rauha.app/claude', args: ['auth', 'login'] });
    expect(s.calls[0]!.env['CLAUDE_CONFIG_DIR']).toBe('/home/kim/.claude-work');
    expect(s.calls[0]!.env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
    expect(s.opened).toEqual(['https://claude.ai/oauth/authorize?x=1']);
  });

  it('같은 주소가 여러 번 나와도 브라우저는 한 번만 연다', async () => {
    const s = setup({ login: { stdout: 'https://claude.ai/a\nhttps://claude.ai/a\n', stderr: 'https://claude.ai/a' }, status: LOGGED_IN });
    await s.login.start();
    expect(s.opened).toHaveLength(1);
  });

  it('http 주소는 열지 않는다', async () => {
    const s = setup({ login: { stdout: 'http://evil.example/login\n' }, status: LOGGED_IN });
    await s.login.start();
    expect(s.opened).toEqual([]);
  });

  it('진행 중 → 성공 순서로 상태를 알린다', async () => {
    const s = setup({ login: {}, status: LOGGED_IN });
    await s.login.start();
    expect(s.views.map((v) => v.state)).toEqual(['running', 'success']);
  });

  it('로그인이 끝나도 로그인 상태가 확인되지 않으면 실패로 알린다', async () => {
    const s = setup({ login: {}, status: { stdout: '{"loggedIn": false}' } });
    const done = await s.login.start();
    expect(done.state).toBe('failed');
    expect(done.message).toContain('확인하지 못');
  });

  it('종료 코드가 0이 아니면 출력의 마지막 줄을 실패 이유로 보인다', async () => {
    const s = setup({ login: { stderr: 'Error: access_denied\n', code: 1 } });
    expect(await s.login.start()).toEqual({ state: 'failed', message: 'Error: access_denied' });
  });

  it('실행 파일이 없으면 PATH의 claude를 찾지 않고 이유를 알린다', async () => {
    const s = setup({}, { executable: undefined });
    const done = await s.login.start();
    expect(done).toEqual({ state: 'failed', message: '앱에 들어 있는 Claude 실행 파일을 찾지 못했어요.' });
    expect(s.calls).toHaveLength(0);
  });

  it('실행에 실패하면(error) 실패로 알린다', async () => {
    const s = setup({ login: { error: true } });
    expect((await s.login.start()).state).toBe('failed');
  });

  it('오래 걸리면 프로세스를 멈추고 시간 초과로 알린다', async () => {
    const s = setup({ login: { hang: true } }, { timeoutMs: 30 });
    const done = await s.login.start();
    expect(done.state).toBe('failed');
    expect(done.message).toContain('시간이 지나');
    expect(s.killed).toContain('login');
  });

  it('취소하면 프로세스를 멈추고 취소 상태가 된다', async () => {
    const s = setup({ login: { hang: true } });
    const started = s.login.start();
    await new Promise((r) => setTimeout(r, 20));
    s.login.cancel();
    expect(await started).toEqual({ state: 'cancelled', message: null });
    expect(s.killed).toContain('login');
  });

  it('돌고 있을 때 다시 시작해도 두 번 띄우지 않는다', async () => {
    const s = setup({ login: { hang: true } });
    const first = s.login.start();
    await new Promise((r) => setTimeout(r, 20));
    expect((await s.login.start()).state).toBe('running');
    s.login.cancel();
    await first;
    expect(s.calls.filter((c) => c.args[1] === 'login')).toHaveLength(1);
  });

  it('로그인 상태는 auth status로 읽는다(토큰 파일은 읽지 않는다)', async () => {
    const s = setup({ status: LOGGED_IN });
    expect(await s.login.status()).toBe(true);
    expect(s.calls[0]).toMatchObject({ args: ['auth', 'status'] });
  });

  it('상태를 못 읽거나 실행 파일이 없으면 모른다(null)고 한다', async () => {
    expect(await setup({ status: { error: true } }).login.status()).toBeNull();
    expect(await setup({ status: { hang: true } }).login.status()).toBeNull();
    expect(await setup({}, { executable: undefined }).login.status()).toBeNull();
  });
});
