import { describe, expect, it } from 'vitest';
import { installPlan, installStateText, MAC_SWAP_SCRIPT, type InstallState } from './update-install.js';

describe('업데이트 설치 계획', () => {
  it('Windows는 앱이 꺼질 시간을 둔 뒤 설치 파일을 조용히 돌리고 앱을 다시 켠다', () => {
    const plan = installPlan({ platform: 'win32', installerPath: 'C:\\Temp\\rauha-Setup-0.1.4-x64.exe', appExe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Rauha\\Rauha.exe', pid: 100 });
    expect(plan?.command).toBe('cmd.exe');
    expect(plan?.windowsVerbatimArguments).toBe(true);
    const line = plan?.args.join(' ') ?? '';
    expect(line).toContain('"C:\\Temp\\rauha-Setup-0.1.4-x64.exe" /S');
    expect(line).toContain('start "" "C:\\Users\\a\\AppData\\Local\\Programs\\Rauha\\Rauha.exe"');
    expect(line.indexOf('/S')).toBeLessThan(line.indexOf('start ""'));
  });

  it('Windows 경로에 따옴표나 명령 이음 글자가 있으면 만들지 않는다', () => {
    expect(installPlan({ platform: 'win32', installerPath: 'C:\\a" & calc & "b.exe', appExe: 'C:\\r.exe', pid: 1 })).toBeNull();
    expect(installPlan({ platform: 'win32', installerPath: 'C:\\a.exe', appExe: 'C:\\r.exe & calc', pid: 1 })).toBeNull();
  });

  it('맥은 경로를 스크립트 글에 끼우지 않고 인자로 넘긴다(주입 방지)', () => {
    const plan = installPlan({ platform: 'darwin', installerPath: '/tmp/x; rm -rf ~/y.dmg', appBundle: '/Applications/Rauha.app', pid: 42 });
    expect(plan?.command).toBe('sh');
    expect(plan?.args[0]).toBe('-c');
    expect(plan?.args[1]).toBe(MAC_SWAP_SCRIPT);
    expect(plan?.args.slice(3)).toEqual(['/tmp/x; rm -rf ~/y.dmg', '/Applications/Rauha.app', '42']);
    expect(MAC_SWAP_SCRIPT).not.toContain('/tmp');
  });

  it('맥 스크립트는 앱이 꺼지길 기다리고, 덮어쓴 뒤 격리 표시를 빼고 다시 연다', () => {
    expect(MAC_SWAP_SCRIPT).toContain('kill -0');
    expect(MAC_SWAP_SCRIPT).toContain('hdiutil attach');
    expect(MAC_SWAP_SCRIPT).toContain('xattr -dr com.apple.quarantine');
    expect(MAC_SWAP_SCRIPT).toContain('open ');
    expect(MAC_SWAP_SCRIPT.indexOf('cp -R')).toBeLessThan(MAC_SWAP_SCRIPT.indexOf('xattr'));
  });

  it('맥 앱 폴더가 .app으로 끝나지 않으면 만들지 않는다', () => {
    expect(installPlan({ platform: 'darwin', installerPath: '/tmp/a.dmg', appBundle: '/Applications', pid: 1 })).toBeNull();
  });

  it('지원하지 않는 OS는 만들지 않는다', () => {
    expect(installPlan({ platform: 'linux', installerPath: '/tmp/a', pid: 1 })).toBeNull();
  });

  it('진행 상태는 한 줄 글로 보인다', () => {
    const t = (s: InstallState) => installStateText(s);
    expect(t({ phase: 'downloading', percent: 42 })).toBe('내려받는 중 42%');
    expect(t({ phase: 'downloading', percent: null })).toBe('내려받는 중…');
    expect(t({ phase: 'installing', percent: null })).toBe('설치하고 다시 켜는 중…');
    expect(t({ phase: 'failed', percent: null })).toBe('설치하지 못했어요. 브라우저로 내려받아 설치해 주세요');
    expect(t({ phase: 'idle', percent: null })).toBe('');
  });
});
