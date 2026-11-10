import { describe, expect, it } from 'vitest';
import { childEnv, resolveTarget, shellInvocation } from './shell-command.js';
import { Terminal } from './terminal.js';

describe('터미널 한 칸', () => {
  it('폴더를 옮기면 이전 폴더를 기억한다', () => {
    const t = Terminal.open('t1', '/w');
    t.movedTo('/w/src');
    expect(t.cwd).toBe('/w/src');
    expect(t.previous).toBe('/w');
  });

  it('명령이 돌고 있는 동안은 폴더를 옮기거나 새 명령을 시작하지 못한다', () => {
    const t = Terminal.open('t1', '/w');
    t.started();
    expect(t.isRunning()).toBe(true);
    expect(() => t.movedTo('/x')).toThrowError(/while a command is running/);
    expect(() => t.started()).toThrowError(/still running/);
    t.finished();
    expect(t.isRunning()).toBe(false);
    t.movedTo('/x');
    expect(t.cwd).toBe('/x');
  });
});

describe('셸 실행 방법', () => {
  it('macOS는 사용자 셸이 zsh·bash면 그걸 쓴다', () => {
    expect(shellInvocation('darwin', { SHELL: '/bin/bash' }, 'ls -la')).toEqual({ file: '/bin/bash', args: ['-c', 'ls -la'], label: 'bash' });
  });

  it('macOS에서 셸을 모르거나 fish 같은 다른 문법이면 /bin/zsh', () => {
    expect(shellInvocation('darwin', {}, 'ls').file).toBe('/bin/zsh');
    expect(shellInvocation('darwin', { SHELL: '/opt/homebrew/bin/fish' }, 'ls').file).toBe('/bin/zsh');
  });

  it('SHELL이 상대 경로이거나 이상하면 쓰지 않는다', () => {
    expect(shellInvocation('linux', { SHELL: 'bash' }, 'ls').file).toBe('/bin/bash');
  });

  it('Windows는 PowerShell에 명령을 base64(UTF-16LE)로 넘긴다', () => {
    const r = shellInvocation('win32', {}, 'echo "안녕" & x');
    expect(r.file).toBe('powershell.exe');
    expect(r.args.slice(0, 6)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand']);
    const script = Buffer.from(r.args[6] ?? '', 'base64').toString('utf16le');
    expect(script).toContain('echo "안녕" & x');
    expect(script).toContain('exit $LASTEXITCODE');
  });

  it('자식 환경: 색·페이저·비밀번호 창을 끄고 ELECTRON_RUN_AS_NODE는 뺀다', () => {
    const env = childEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' });
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
    expect(env).toMatchObject({ PATH: '/bin', TERM: 'dumb', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' });
  });
});

describe('cd 대상 풀기', () => {
  it('상대 경로는 지금 폴더 기준, ~ 는 홈', () => {
    expect(resolveTarget('linux', '/w/a', '../b', '/home/u', null)).toBe('/w/b');
    expect(resolveTarget('linux', '/w', '~/x', '/home/u', null)).toBe('/home/u/x');
    expect(resolveTarget('linux', '/w', null, '/home/u', null)).toBe('/home/u');
  });

  it('cd - 는 이전 폴더(없으면 null)', () => {
    expect(resolveTarget('linux', '/w', '-', '/h', '/before')).toBe('/before');
    expect(resolveTarget('linux', '/w', '-', '/h', null)).toBeNull();
  });

  it('Windows 경로도 푼다', () => {
    expect(resolveTarget('win32', 'C:\\w', 'src', 'C:\\Users\\u', null)).toBe('C:\\w\\src');
    expect(resolveTarget('win32', 'C:\\w', 'D:\\x', 'C:\\Users\\u', null)).toBe('D:\\x');
  });
});
