import { describe, expect, it } from 'vitest';
import { failureText, InstallFailure, installPlan, installStateText, isInstallBusy, MAC_SWAP_SCRIPT, SWAP_FAILURES, type InstallState } from './update-install.js';

const LOG = { logPath: '/u/logs/update-swap.log', resultPath: '/u/update-swap.result' };

describe('업데이트 설치 계획', () => {
  it('Windows는 앱이 꺼질 시간을 둔 뒤 설치 프로그램이 끝나길 기다려 결과를 남기고 앱을 다시 켠다', () => {
    const plan = installPlan({ platform: 'win32', installerPath: 'C:\\Temp\\rauha-Setup-0.1.4-x64.exe', appExe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Rauha\\Rauha.exe', pid: 100, logPath: 'C:\\u\\logs\\update-swap.log', resultPath: 'C:\\u\\update-swap.result' });
    expect(plan?.command).toBe('cmd.exe');
    expect(plan?.windowsVerbatimArguments).toBe(true);
    const line = plan?.args.join(' ') ?? '';
    expect(line).toContain('start "" /wait "C:\\Temp\\rauha-Setup-0.1.4-x64.exe" /S');
    expect(line).toContain('echo ok>"C:\\u\\update-swap.result"');
    expect(line).toContain('echo fail>"C:\\u\\update-swap.result"');
    expect(line).toContain('>>"C:\\u\\logs\\update-swap.log"');
    expect(line).toContain('start "" "C:\\Users\\a\\AppData\\Local\\Programs\\Rauha\\Rauha.exe"');
    expect(line.indexOf('/S')).toBeLessThan(line.indexOf('start "" "C:\\Users'));
  });

  it('Windows 경로에 따옴표나 명령 이음 글자가 있으면 만들지 않는다', () => {
    expect(installPlan({ platform: 'win32', installerPath: 'C:\\a" & calc & "b.exe', appExe: 'C:\\r.exe', pid: 1, ...LOG })).toBeNull();
    expect(installPlan({ platform: 'win32', installerPath: 'C:\\a.exe', appExe: 'C:\\r.exe & calc', pid: 1, ...LOG })).toBeNull();
    expect(installPlan({ platform: 'win32', installerPath: 'C:\\a.exe', appExe: 'C:\\r.exe', pid: 1, logPath: 'C:\\x & y.log', resultPath: 'C:\\r' })).toBeNull();
  });

  it('로그·결과 파일 경로가 없으면 만들지 않는다(소리 없는 실패를 막는다)', () => {
    expect(installPlan({ platform: 'darwin', installerPath: '/tmp/a.dmg', appBundle: '/Applications/Rauha.app', pid: 1 })).toBeNull();
    expect(installPlan({ platform: 'win32', installerPath: 'C:\\a.exe', appExe: 'C:\\r.exe', pid: 1 })).toBeNull();
  });

  it('맥은 경로를 스크립트 글에 끼우지 않고 인자로 넘긴다(주입 방지)', () => {
    const plan = installPlan({ platform: 'darwin', installerPath: '/tmp/x; rm -rf ~/y.dmg', appBundle: '/Applications/Rauha.app', pid: 42, ...LOG });
    expect(plan?.command).toBe('sh');
    expect(plan?.args[0]).toBe('-c');
    expect(plan?.args[1]).toBe(MAC_SWAP_SCRIPT);
    expect(plan?.args.slice(3)).toEqual(['/tmp/x; rm -rf ~/y.dmg', '/Applications/Rauha.app', '42', '/u/logs/update-swap.log', '/u/update-swap.result']);
    expect(MAC_SWAP_SCRIPT).not.toContain('/tmp');
    expect(MAC_SWAP_SCRIPT).not.toContain('/Applications');
  });

  it('맥 스크립트는 앱이 꺼지길 60초까지 기다리고, 안 꺼지면 덮어쓰지 않고 실패로 남긴다', () => {
    expect(MAC_SWAP_SCRIPT).toContain('kill -0');
    expect(MAC_SWAP_SCRIPT).toContain('-lt 120');
    expect(MAC_SWAP_SCRIPT).toContain('fail app-running');
    expect(MAC_SWAP_SCRIPT.indexOf('fail app-running')).toBeLessThan(MAC_SWAP_SCRIPT.indexOf('hdiutil attach'));
  });

  it('맥 스크립트는 새 앱을 옆에 먼저 복사한 뒤 바꿔 끼우고, 그 뒤 격리 표시를 빼고 다시 연다', () => {
    expect(MAC_SWAP_SCRIPT).toContain('hdiutil attach');
    expect(MAC_SWAP_SCRIPT).toContain('hdiutil detach');
    expect(MAC_SWAP_SCRIPT.indexOf('cp -R')).toBeLessThan(MAC_SWAP_SCRIPT.indexOf('mv "$app" "$old"'));
    expect(MAC_SWAP_SCRIPT.indexOf('mv "$stage" "$app"')).toBeLessThan(MAC_SWAP_SCRIPT.indexOf('xattr -dr com.apple.quarantine'));
    expect(MAC_SWAP_SCRIPT.lastIndexOf('open "$app"')).toBeGreaterThan(MAC_SWAP_SCRIPT.indexOf('xattr'));
    // 바꿔 끼우다 실패하면 옛 앱을 되돌린다
    expect(MAC_SWAP_SCRIPT).toContain('mv "$old" "$app"');
  });

  it('맥 스크립트는 모든 실패에 이유 코드를 결과 파일에 남기고 로그에 쓴다', () => {
    for (const code of SWAP_FAILURES) expect(MAC_SWAP_SCRIPT).toContain(`fail ${code} `);
    expect(MAC_SWAP_SCRIPT).toContain(`printf 'fail %s\\n' "$1" > "$res"`);
    expect(MAC_SWAP_SCRIPT).toContain(`printf 'ok\\n' > "$res"`);
    expect(MAC_SWAP_SCRIPT).toContain('>> "$log"');
  });

  it('맥 앱 폴더가 .app으로 끝나지 않으면 만들지 않는다', () => {
    expect(installPlan({ platform: 'darwin', installerPath: '/tmp/a.dmg', appBundle: '/Applications', pid: 1, ...LOG })).toBeNull();
  });

  it('지원하지 않는 OS는 만들지 않는다', () => {
    expect(installPlan({ platform: 'linux', installerPath: '/tmp/a', pid: 1, ...LOG })).toBeNull();
  });

  it('진행 상태는 한 줄 글로 보인다', () => {
    const t = (s: InstallState) => installStateText(s);
    expect(t({ phase: 'downloading', percent: 42 })).toBe('Downloading 42%');
    expect(t({ phase: 'downloading', percent: null })).toBe('Downloading…');
    expect(t({ phase: 'checking', percent: null })).toBe('Checking…');
    expect(t({ phase: 'verifying', percent: null })).toBe('Verifying file…');
    expect(t({ phase: 'preparing', percent: null })).toBe('Preparing to install…');
    expect(t({ phase: 'installing', percent: null })).toBe('Installing and restarting…');
    expect(t({ phase: 'failed', percent: null })).toBe('Could not install. Download it in your browser and install it manually');
    expect(t({ phase: 'idle', percent: null })).toBe('');
  });

  it('진행 중인 단계에서는 새 설치를 시작하지 않는다', () => {
    for (const phase of ['checking', 'downloading', 'verifying', 'preparing', 'installing'] as const) expect(isInstallBusy({ phase, percent: null })).toBe(true);
    expect(isInstallBusy({ phase: 'idle', percent: null })).toBe(false);
    expect(isInstallBusy({ phase: 'failed', percent: null })).toBe(false);
  });

  it('실패 이유는 코드마다 한 줄이고, 모르는 오류도 빈 칸이 없다', () => {
    expect(failureText(new InstallFailure('http', '404'))).toContain('404');
    expect(failureText(new InstallFailure('stalled'))).toContain('30 seconds');
    expect(failureText(new InstallFailure('target-unwritable'))).toContain('Applications');
    expect(failureText(new Error('x'))).toBe('Stopped because of an unexpected error');
  });
});
