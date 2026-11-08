import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ClaudeLogin } from '../auth/claude-login.js';
import { DiagnosticReport, Redactor } from '../../shared/diagnostics.js';
import { collectSnapshot, type CollectDeps } from './collect.js';

const HOME = '/Users/kimpyeonghwa';

/** 가짜 Claude 실행 파일: `auth status`에 정해 둔 JSON을 낸다. 진짜 Claude는 부르지 않는다. */
function fakeClaude(stdout: string, code = 0): ClaudeLogin {
  const spawn = (() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(stdout));
      setImmediate(() => child.emit('close', code));
    });
    return child;
  }) as never;
  return new ClaudeLogin({ executable: () => '/Applications/Rauha.app/claude', env: async () => ({ CLAUDE_CONFIG_DIR: `${HOME}/.claude`, HOME }), openExternal: async () => undefined, onChange: () => undefined, spawn, statusTimeoutMs: 200 });
}

function deps(patch: Partial<CollectDeps> = {}): CollectDeps {
  const files = new Set(['/Applications/Rauha.app/claude', `${HOME}/work`, '/opt/homebrew/bin/git', '/usr/bin/node']);
  return {
    now: () => new Date('2026-11-09T01:02:03.000Z'),
    app: { version: '0.1.4', packaged: true },
    os: { platform: 'darwin', version: '15.1', arch: 'arm64', chip: 'Apple M1' },
    runtime: { electron: '45.2.3', node: '24.1.0', chrome: '140.0.0.0' },
    workFolder: `${HOME}/work`,
    fs: { exists: (p) => files.has(p), executable: (p) => files.has(p) },
    repoCount: async () => 3,
    claudePath: '/Applications/Rauha.app/claude',
    auth: () => fakeClaude('{"loggedIn": true, "email": "kimpyeonghwa@example.com", "orgName": "ACME"}').check(),
    pathEnv: '/opt/homebrew/bin:/usr/bin',
    env: {},
    tools: ['git', 'aws', 'gh', 'node'],
    usage: () => ({ readAt: Date.parse('2026-11-09T01:00:00.000Z'), failure: null }),
    update: () => ({ current: '0.1.4', checkedAt: '2026-11-09T00:59:00.000Z', latest: '0.1.5', newer: true, showBanner: true, hasDownload: true, checking: false, failed: false, canInstall: true, install: { phase: 'idle', percent: null } }),
    logs: () => [],
    window: () => ({ width: 1280, height: 820, displays: 1 }),
    mac: () => ({ titleBarStyle: 'hiddenInset', trafficLight: { x: 14, y: 12 }, fullScreen: false }),
    timeoutMs: 200,
    ...patch,
  };
}

describe('진단 정보 모으기', () => {
  it('앱·작업 폴더·Claude 실행 파일·도구·한도·업데이트를 한 묶음으로 모은다', async () => {
    const s = await collectSnapshot(deps());
    expect(s.app).toEqual({ version: '0.1.4', packaged: true });
    expect(s.workFolder).toEqual({ path: `${HOME}/work`, exists: true });
    expect(s.repoCount).toBe(3);
    expect(s.claude).toEqual({ path: '/Applications/Rauha.app/claude', exists: true, executable: true });
    expect(s.tools).toEqual([
      { name: 'git', path: '/opt/homebrew/bin/git' },
      { name: 'aws', path: null },
      { name: 'gh', path: null },
      { name: 'node', path: '/usr/bin/node' },
    ]);
    expect(s.usage).toEqual({ lastReadAt: '2026-11-09T01:00:00.000Z', failure: null });
    expect(s.update).toMatchObject({ latest: '0.1.5', newer: true, failed: false });
  });

  it('가짜 실행 파일의 로그인 상태를 읽어 마크다운에 이메일 없이 보인다', async () => {
    const md = DiagnosticReport.of(await collectSnapshot(deps()), Redactor.of(HOME, 'kimpyeonghwa')).toMarkdown();
    expect(md).toContain('로그인됨 (ki***)');
    expect(md).not.toContain('example.com');
    expect(md).not.toContain('kimpyeonghwa');
  });

  it('가짜 실행 파일이 오류로 끝나면 "확인 못 함"과 이유 한 줄', async () => {
    const auth = () => fakeClaude('', 1).check();
    const md = DiagnosticReport.of(await collectSnapshot(deps({ auth })), Redactor.of(HOME, 'kimpyeonghwa')).toMarkdown();
    expect(md).toContain('확인 못 함');
  });

  it('로그아웃 상태도 그대로 보인다', async () => {
    const md = DiagnosticReport.of(await collectSnapshot(deps({ auth: () => fakeClaude('{"loggedIn": false}').check() })), Redactor.of(HOME, 'kimpyeonghwa')).toMarkdown();
    expect(md).toContain('로그인 안 됨');
  });

  it('Claude 실행 파일이 없으면 없다고 기록한다', async () => {
    const s = await collectSnapshot(deps({ claudePath: undefined }));
    expect(s.claude).toEqual({ path: null, exists: false, executable: false });
    const gone = await collectSnapshot(deps({ claudePath: '/nope/claude' }));
    expect(gone.claude).toEqual({ path: '/nope/claude', exists: false, executable: false });
  });

  it('레포 세기가 오래 걸리면 기다리지 않고 모름으로 둔다', async () => {
    const s = await collectSnapshot(deps({ repoCount: () => new Promise(() => undefined), timeoutMs: 30 }));
    expect(s.repoCount).toBeNull();
  });

  it('일부를 읽다 던져도 나머지는 모은다', async () => {
    const s = await collectSnapshot(deps({ repoCount: async () => Promise.reject(new Error('x')), auth: async () => Promise.reject(new Error('y')), window: () => { throw new Error('z'); } }));
    expect(s.repoCount).toBeNull();
    expect(s.auth?.state.kind).toBe('unknown');
    expect(s.window).toBeNull();
    expect(s.app.version).toBe('0.1.4');
  });

  it('작업 폴더를 안 골랐으면 경로는 null', async () => {
    const s = await collectSnapshot(deps({ workFolder: null }));
    expect(s.workFolder).toEqual({ path: null, exists: null });
  });

  it('한도를 한 번도 못 읽었으면 시각은 null이고 실패 이유를 담는다', async () => {
    const s = await collectSnapshot(deps({ usage: () => ({ readAt: null, failure: '값을 받지 못했어요' }) }));
    expect(s.usage).toEqual({ lastReadAt: null, failure: '값을 받지 못했어요' });
  });
});
