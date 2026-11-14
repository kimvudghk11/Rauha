import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { AI_PROVIDERS, askArgs, cleanAnswer, limitMessage, LOGIN_ARGS, LOGOUT_ARGS, loginState, providerOf, STATUS_ARGS, type AiProviderId } from '../../shared/external-ai.js';
import type { AiResult, AiStatusView } from '../../shared/external-ai-ipc.js';

const PROMPT_MAX = 20_000;
const ASK_TIMEOUT_MS = 5 * 60_000;

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 실제로 실행할 파일과 앞 인자. Windows 의 codex 는 .cmd 라 셸 없이 못 돌리므로 node 로 그 JS 를 직접 연다 */
interface Exe {
  readonly file: string;
  readonly pre: readonly string[];
  /** 새 터미널 창에서 칠 명령 이름 */
  readonly shellName: string;
}

export interface ExternalAiDeps {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  /** 확인용 실행: 모델을 부르지 않고 정해 둔 답 */
  readonly fake: boolean;
}

function which(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const exts = platform === 'win32' ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of (env['PATH'] ?? env['Path'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function runFile(file: string, args: readonly string[], opts: { cwd?: string; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<Ran> {
  return new Promise((done) => {
    execFile(file, [...args], { cwd: opts.cwd, timeout: opts.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: opts.env, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1;
      done({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Kiro · Codex CLI 를 찾고 실행한다. 토큰은 읽지 않는다(로그인·저장은 각 CLI 몫). */
export class ExternalAiService {
  private constructor(private readonly deps: ExternalAiDeps) {}

  static create(deps: ExternalAiDeps): ExternalAiService {
    return new ExternalAiService(deps);
  }

  private exe(id: AiProviderId): Exe | null {
    const { env, platform } = this.deps;
    if (id === 'kiro') {
      const found = which('kiro-cli', env, platform) ?? (platform === 'win32' && env['LOCALAPPDATA'] !== undefined && existsSync(join(env['LOCALAPPDATA'], 'Kiro-Cli', 'kiro-cli.exe')) ? join(env['LOCALAPPDATA'], 'Kiro-Cli', 'kiro-cli.exe') : null);
      return found === null ? null : { file: found, pre: [], shellName: 'kiro-cli' };
    }
    if (platform !== 'win32') {
      const found = which('codex', env, platform);
      return found === null ? null : { file: found, pre: [], shellName: 'codex' };
    }
    const cmd = which('codex', env, platform);
    if (cmd === null) return null;
    const js = join(dirname(cmd), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const node = existsSync(join(dirname(cmd), 'node.exe')) ? join(dirname(cmd), 'node.exe') : which('node', env, platform);
    return existsSync(js) && node !== null ? { file: node, pre: [js], shellName: 'codex.cmd' } : null;
  }

  async status(): Promise<AiStatusView[]> {
    return Promise.all(
      AI_PROVIDERS.map(async ({ id }): Promise<AiStatusView> => {
        const exe = this.exe(id);
        if (exe === null) return { id, installed: false, signedIn: false, who: '' };
        const r = await runFile(exe.file, [...exe.pre, ...STATUS_ARGS[id]], { timeoutMs: 15_000, env: this.deps.env });
        return { id, installed: true, ...loginState(id, `${r.stdout}\n${r.stderr}`, r.code) };
      }),
    );
  }

  async ask(rawId: unknown, rawPrompt: unknown, cwd: string): Promise<AiResult<{ text: string; seconds: number }>> {
    const p = providerOf(rawId);
    if (p === null) return { ok: false, error: 'Unknown AI.' };
    if (typeof rawPrompt !== 'string' || rawPrompt.trim() === '') return { ok: false, error: 'Type a question first.' };
    if (rawPrompt.length > PROMPT_MAX) return { ok: false, error: `The question is too long (up to ${PROMPT_MAX} characters).` };
    if (this.deps.fake) return { ok: true, data: { text: `(${p.label} test answer) ${rawPrompt.slice(0, 40)}`, seconds: 0 } };
    const exe = this.exe(p.id);
    if (exe === null) return { ok: false, error: `${p.label} is not installed. ${p.install}` };
    const dir = await mkdtemp(join(tmpdir(), 'rauha-ai-'));
    const last = join(dir, 'last.txt');
    const t0 = Date.now();
    try {
      const r = await runFile(exe.file, [...exe.pre, ...askArgs(p.id, rawPrompt, last)], { cwd, timeoutMs: ASK_TIMEOUT_MS, env: this.deps.env });
      const all = `${r.stdout}\n${r.stderr}`;
      const limited = limitMessage(p.id, all);
      if (limited !== null) return { ok: false, error: limited };
      if (/not logged in|login required|please log in|sign in/i.test(all) && r.code !== 0) return { ok: false, error: `${p.label} is not signed in. Sign in from Extensions > AI accounts.` };
      const fromFile = p.id === 'codex' ? await readFile(last, 'utf8').catch(() => '') : '';
      const text = cleanAnswer(p.id, fromFile !== '' ? fromFile : r.stdout);
      if (r.code !== 0 && text === '') return { ok: false, error: `${p.label} stopped: ${cleanAnswer(p.id, r.stderr).split('\n').find((l) => l.trim() !== '') ?? `exit code ${r.code}`}` };
      return { ok: true, data: { text: text === '' ? '(no answer)' : text, seconds: Math.round((Date.now() - t0) / 1000) } };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** 새 터미널 창에서 로그인 명령을 연다. 명령과 인자는 고정이라 바깥 글이 섞이지 않는다 */
  async login(rawId: unknown): Promise<AiResult<null>> {
    const p = providerOf(rawId);
    if (p === null) return { ok: false, error: 'Unknown AI.' };
    const exe = this.exe(p.id);
    if (exe === null) return { ok: false, error: `${p.label} is not installed. ${p.install}` };
    const line = [exe.shellName, ...LOGIN_ARGS[p.id]].join(' ');
    try {
      if (this.deps.platform === 'win32') spawn('cmd.exe', ['/c', 'start', `rauha · ${p.label} sign-in`, 'cmd', '/k', line], { detached: true, stdio: 'ignore', windowsHide: false, env: this.deps.env }).unref();
      else if (this.deps.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script "${line}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
      else spawn('x-terminal-emulator', ['-e', line], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, data: null };
    } catch {
      return { ok: false, error: `Could not open a terminal. Run "${line}" in a terminal yourself.` };
    }
  }

  async logout(rawId: unknown): Promise<AiResult<null>> {
    const p = providerOf(rawId);
    if (p === null) return { ok: false, error: 'Unknown AI.' };
    const exe = this.exe(p.id);
    if (exe === null) return { ok: false, error: `${p.label} is not installed.` };
    const r = await runFile(exe.file, [...exe.pre, ...LOGOUT_ARGS[p.id]], { timeoutMs: 20_000, env: this.deps.env });
    return r.code === 0 ? { ok: true, data: null } : { ok: false, error: `${p.label} did not sign out: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}` };
  }
}
