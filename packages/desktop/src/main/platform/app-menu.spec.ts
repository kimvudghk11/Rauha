import { describe, expect, it } from 'vitest';
import { appMenuTemplate, MENU_OPEN_SETTINGS, modKeyName, quitWhenAllClosed, windowChrome } from './app-menu.js';

const flat = (platform: NodeJS.Platform) =>
  (appMenuTemplate(platform, 'rauha') ?? []).flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []));

describe('appMenuTemplate', () => {
  it('macOS 메뉴는 앱 이름·편집·보기·창 순서다', () => {
    expect(appMenuTemplate('darwin', 'rauha')!.map((m) => m.label)).toEqual(['rauha', '편집', '보기', '창']);
  });

  it('Cmd+Q 종료, Cmd+W 창 닫기, 복사·붙여넣기가 role로 들어 있다', () => {
    const roles = flat('darwin').map((i) => i.role);
    expect(roles).toEqual(expect.arrayContaining(['quit', 'close', 'copy', 'paste', 'cut', 'undo', 'selectAll']));
  });

  it('설정은 Cmd+,로 연다', () => {
    const item = flat('darwin').find((i) => i.id === MENU_OPEN_SETTINGS)!;
    expect(item.accelerator).toBe('Command+,');
  });

  it('macOS가 아니면 메뉴를 만들지 않는다', () => {
    expect(appMenuTemplate('win32', 'rauha')).toBeNull();
  });
});

describe('플랫폼별 창', () => {
  it('macOS는 제목 막대를 숨기고 신호등을 화면 제목줄의 세로 가운데에 둔다', () => {
    const chrome = windowChrome('darwin');
    expect(chrome.titleBarStyle).toBe('hiddenInset');
    expect(chrome.trafficLightPosition).toEqual({ x: 10, y: 9 });
    expect(windowChrome('darwin', '25.1.0').trafficLightPosition).toEqual({ x: 11, y: 10 });
    expect(windowChrome('win32')).toEqual({});
  });

  it('창을 모두 닫아도 macOS는 앱을 끝내지 않는다', () => {
    expect(quitWhenAllClosed('darwin')).toBe(false);
    expect(quitWhenAllClosed('win32')).toBe(true);
  });

  it('조합 키 이름은 macOS에서 Cmd, 그 밖엔 Ctrl이다', () => {
    expect(modKeyName('darwin')).toBe('Cmd');
    expect(modKeyName('win32')).toBe('Ctrl');
  });
});
