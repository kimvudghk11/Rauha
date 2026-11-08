import type { MenuItemConstructorOptions } from 'electron';
import { isTahoeOrNewer, titleBarHeight, trafficLightPosition } from '../../shared/title-bar.js';

/** 메뉴에서 앱이 직접 처리하는 항목의 id */
export const MENU_OPEN_SETTINGS = 'open-settings';

/**
 * macOS 앱 메뉴: 앱 이름 · 편집 · 보기 · 창. 단축키는 role이 정하는 Cmd 조합이다(Cmd+Q 종료, Cmd+W 창 닫기, Cmd+C/V 편집).
 * "설정…"은 Cmd+,로 설정 탭을 연다. macOS가 아니면 메뉴를 만들지 않는다(null) — Windows는 메뉴 막대를 숨긴다.
 */
export function appMenuTemplate(platform: NodeJS.Platform, appName: string, openSettings: () => void = () => undefined): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null;
  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `${appName} 정보` },
        { type: 'separator' },
        { id: MENU_OPEN_SETTINGS, label: '설정…', accelerator: 'Command+,', click: openSettings },
        { type: 'separator' },
        { role: 'hide', label: `${appName} 가리기` },
        { role: 'hideOthers', label: '다른 앱 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: `${appName} 종료` },
      ],
    },
    {
      label: '편집',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '보기',
      submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'toggleDevTools' }],
    },
    {
      label: '창',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
    },
  ];
}

/** 창 테두리 옵션: macOS는 제목 막대를 숨기고, 화면 안 제목줄(shared/title-bar)의 세로 가운데에 신호등 버튼을 둔다. */
export function windowChrome(platform: NodeJS.Platform, darwinRelease = ''): { titleBarStyle?: 'hiddenInset'; trafficLightPosition?: { x: number; y: number } } {
  return platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: trafficLightPosition(titleBarHeight(platform, false), isTahoeOrNewer(darwinRelease)) } : {};
}

/** 창이 모두 닫히면 앱을 끝낼지. macOS는 Dock에 남겨 둔다(Cmd+Q로 끝낸다). */
export const quitWhenAllClosed = (platform: NodeJS.Platform): boolean => platform !== 'darwin';

/** 화면에 적는 조합 키 이름 */
export const modKeyName = (platform: NodeJS.Platform): 'Cmd' | 'Ctrl' => (platform === 'darwin' ? 'Cmd' : 'Ctrl');
