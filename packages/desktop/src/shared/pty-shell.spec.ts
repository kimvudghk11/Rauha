import { describe, expect, it } from 'vitest';
import { chooseShell, clampSize, isTermId, ptyEnv } from './pty-shell.js';

const none = (): boolean => false;

describe('PTY 셸 고르기(main이 정한다)', () => {
  it('Windows는 pwsh가 PATH에 있으면 pwsh, 없으면 Windows PowerShell을 연다', () => {
    const env = { Path: 'C:\\tools;C:\\Program Files\\PowerShell\\7', SystemRoot: 'C:\\Windows' };
    const withPwsh = chooseShell('win32', env, (p) => p === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    expect(withPwsh).toEqual({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'], label: 'pwsh' });
    const legacy = chooseShell('win32', env, (p) => p === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(legacy.label).toBe('powershell');
    expect(legacy.args).toEqual(['-NoLogo']);
  });

  it('Windows에 PowerShell이 하나도 없으면 ComSpec(cmd)로 대신한다', () => {
    const s = chooseShell('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, none);
    expect(s).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [], label: 'cmd' });
  });

  it('맥은 $SHELL(zsh 같은 알려진 셸)을 로그인 셸(-l)로 연다', () => {
    expect(chooseShell('darwin', { SHELL: '/bin/zsh' }, () => true)).toEqual({ file: '/bin/zsh', args: ['-l'], label: 'zsh' });
    expect(chooseShell('darwin', { SHELL: '/opt/homebrew/bin/fish' }, () => true).args).toEqual(['-l']);
  });

  it('$SHELL이 없거나 절대 경로가 아니거나 모르는 프로그램이면 맥은 /bin/zsh, 리눅스는 /bin/bash', () => {
    expect(chooseShell('darwin', {}, () => true).file).toBe('/bin/zsh');
    expect(chooseShell('darwin', { SHELL: 'zsh' }, () => true).file).toBe('/bin/zsh');
    expect(chooseShell('darwin', { SHELL: '/tmp/evil' }, () => true).file).toBe('/bin/zsh');
    expect(chooseShell('linux', { SHELL: '/usr/bin/python3' }, () => true).file).toBe('/bin/bash');
  });

  it('$SHELL 파일이 실제로 없으면 기본 셸로 돌아간다', () => {
    expect(chooseShell('darwin', { SHELL: '/bin/bash' }, (p) => p !== '/bin/bash').file).toBe('/bin/zsh');
  });
});

describe('PTY 환경 변수', () => {
  it('rauha 내부 값(RAUHA_*)과 Electron 값(ELECTRON_*)은 넘기지 않는다', () => {
    const env = ptyEnv({ PATH: '/usr/bin', RAUHA_DATA_DIR: '/x', RAUHA_WORK_DIR: '/y', ELECTRON_RUN_AS_NODE: '1', ELECTRON_ENABLE_LOGGING: '1', HOME: '/h' });
    expect(env['RAUHA_DATA_DIR']).toBeUndefined();
    expect(env['RAUHA_WORK_DIR']).toBeUndefined();
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
    expect(env['ELECTRON_ENABLE_LOGGING']).toBeUndefined();
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/h');
  });

  it('색과 커서를 쓰는 프로그램이 알아보도록 TERM·COLORTERM을 정한다', () => {
    const env = ptyEnv({ TERM: 'dumb', NO_COLOR: '1' });
    expect(env['TERM']).toBe('xterm-256color');
    expect(env['COLORTERM']).toBe('truecolor');
    expect(env['NO_COLOR']).toBeUndefined();
    expect(env['TERM_PROGRAM']).toBe('rauha');
  });

  it('값이 없는(undefined) 변수는 빼서 문자열만 남긴다', () => {
    const env = ptyEnv({ A: undefined, B: 'b' });
    expect('A' in env).toBe(false);
    expect(env['B']).toBe('b');
  });
});

describe('PTY 입력 검증', () => {
  it('터미널 id는 UUID 모양만 받는다', () => {
    expect(isTermId('3f2b8c1e-5d4a-4b7e-9c1d-0a1b2c3d4e5f')).toBe(true);
    expect(isTermId('../etc')).toBe(false);
    expect(isTermId(42)).toBe(false);
    expect(isTermId('')).toBe(false);
  });

  it('크기는 정수로 맞추고 1~500열·1~200행 안으로 줄인다', () => {
    expect(clampSize(80, 24)).toEqual({ cols: 80, rows: 24 });
    expect(clampSize(0, 0)).toEqual({ cols: 1, rows: 1 });
    expect(clampSize(9999, 9999)).toEqual({ cols: 500, rows: 200 });
    expect(clampSize(80.7, 24.2)).toEqual({ cols: 80, rows: 24 });
  });

  it('숫자가 아닌 크기는 기본 80x24로 본다', () => {
    expect(clampSize(Number.NaN, 'x' as unknown as number)).toEqual({ cols: 80, rows: 24 });
  });
});
