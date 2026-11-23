import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { AwsProfilesView, AwsResult, AwsWho } from '../../shared/aws-api.js';
import { AwsProfiles, callerOf } from '../../shared/aws-profiles.js';
import { terminalLine } from '../../shared/external-ai.js';

export interface AwsServiceDeps {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
}

const MAC_EXTRA = ['/opt/homebrew/bin', '/usr/local/bin'];

/** 로그인 만료·자격 없음처럼 "다시 로그인하면 되는" 실패 */
export function needsLogin(text: string): boolean {
  return /Token has expired|token.*(expired|invalid)|SSO session.*(expired|invalid)|Error loading SSO Token|Unable to locate credentials|ExpiredToken|The SSO session associated with this profile has expired/i.test(text);
}

/**
 * AWS 계정(프로필) 보기. 키·토큰은 읽지 않는다: 프로필 이름은 설정 파일에서, "누구인지"는 aws CLI(sts get-caller-identity, 읽기 전용)에서.
 * 로그인은 aws CLI 가 새 터미널에서 직접 한다(rauha 는 브라우저 로그인 결과를 만지지 않는다).
 */
export class AwsService {
  private constructor(private readonly deps: AwsServiceDeps) {}

  static create(deps: AwsServiceDeps): AwsService {
    return new AwsService(deps);
  }

  cli(): string | null {
    const { env, platform } = this.deps;
    const exts = platform === 'win32' ? ['.exe', '.cmd'] : [''];
    const dirs = [...(env['PATH'] ?? env['Path'] ?? '').split(delimiter), ...(platform === 'darwin' ? MAC_EXTRA : []), ...(platform === 'win32' ? [join(env['ProgramFiles'] ?? 'C:\\Program Files', 'Amazon', 'AWSCLIV2')] : [])];
    for (const dir of dirs) {
      if (dir === '') continue;
      for (const ext of exts) {
        const p = join(dir, `aws${ext}`);
        if (existsSync(p)) return p;
      }
    }
    return null;
  }

  private async read(): Promise<AwsProfiles> {
    const dir = join(this.deps.home, '.aws');
    const configPath = this.deps.env['AWS_CONFIG_FILE'] ?? join(dir, 'config');
    const credPath = this.deps.env['AWS_SHARED_CREDENTIALS_FILE'] ?? join(dir, 'credentials');
    const [config, cred] = await Promise.all([readFile(configPath, 'utf8').catch(() => ''), readFile(credPath, 'utf8').catch(() => '')]);
    return AwsProfiles.read(config, cred);
  }

  async profiles(): Promise<AwsProfilesView> {
    return { cli: this.cli(), profiles: (await this.read()).list() };
  }

  async who(profile: unknown): Promise<AwsResult<AwsWho>> {
    const all = await this.read();
    if (!all.has(profile)) return { ok: false, error: 'Unknown profile.' };
    const cli = this.cli();
    if (cli === null) return { ok: false, error: 'The AWS CLI is not installed.' };
    const r = await new Promise<{ code: number; out: string; err: string }>((done) => {
      execFile(cli, ['sts', 'get-caller-identity', '--profile', profile, '--output', 'json'], { timeout: 20_000, windowsHide: true, encoding: 'utf8', env: { ...this.deps.env, AWS_PAGER: '' } }, (e, stdout, stderr) => {
        done({ code: e === null ? 0 : 1, out: String(stdout ?? ''), err: String(stderr ?? '') });
      });
    });
    const who = r.code === 0 ? callerOf(r.out) : null;
    if (who !== null) return { ok: true, data: who };
    if (needsLogin(r.err)) return { ok: false, error: 'Signed out or the sign-in expired.', needsLogin: true };
    const line = r.err.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? 'unknown error';
    return { ok: false, error: line.slice(0, 240) };
  }

  async ssoLogin(profile: unknown): Promise<AwsResult<null>> {
    const all = await this.read();
    if (!all.has(profile)) return { ok: false, error: 'Unknown profile.' };
    return this.openTerminal(['sso', 'login', '--profile', profile], `AWS sign-in (${profile})`);
  }

  configureSso(): Promise<AwsResult<null>> {
    return this.openTerminal(['configure', 'sso'], 'AWS SSO setup');
  }

  /** 새 터미널 창에서 aws 명령. 인자는 고정이거나 목록에 있는 프로필 이름뿐이다 */
  private async openTerminal(args: readonly string[], title: string): Promise<AwsResult<null>> {
    const cli = this.cli();
    if (cli === null) return { ok: false, error: 'The AWS CLI is not installed.' };
    const line = terminalLine(this.deps.platform, [cli, ...args]);
    try {
      if (this.deps.platform === 'win32') {
        const bat = join(await mkdtemp(join(tmpdir(), 'rauha-aws-')), 'aws.cmd');
        await writeFile(bat, `@echo off\r\necho rauha: ${title}\r\n${line}\r\necho.\r\necho You can close this window.\r\n`, 'utf8');
        spawn('cmd.exe', ['/c', 'start', `rauha - ${title}`, 'cmd', '/k', bat], { detached: true, stdio: 'ignore', windowsHide: false, env: this.deps.env }).unref();
      } else if (this.deps.platform === 'darwin') {
        spawn('osascript', ['-e', `tell application "Terminal" to do script "${line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
      } else spawn('x-terminal-emulator', ['-e', line], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, data: null };
    } catch {
      return { ok: false, error: `Could not open a terminal. Run "${line}" yourself.` };
    }
  }
}
