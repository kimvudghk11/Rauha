import type { KeyLike } from './bug-shortcut.js';

/** 맥은 Cmd, 그 밖에는 Ctrl이 "명령 키"다 */
const modOf = (e: KeyLike, platform: string): boolean => (platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/**
 * 앱 탭 전환 단축키: Ctrl+1~8(맥은 Cmd+1~8). 왼쪽 막대 순서의 몇 번째(0부터)인지, 아니면 null.
 * 한글 자판에서도 되도록 글자가 아니라 물리 키(DigitN)로 본다.
 */
export function tabShortcutIndex(e: KeyLike, platform: string): number | null {
  if (!modOf(e, platform) || e.shiftKey || e.altKey || e.isComposing === true) return null;
  const m = /^Digit([1-8])$/.exec(e.code);
  return m === null ? null : Number(m[1]) - 1;
}

/** 단축키 안내창: Ctrl+Shift+/(맥은 Cmd+Shift+/). Shift 없는 Ctrl+/ 는 편집기의 주석 전환이라 쓰지 않는다. */
export const isShortcutSheetKey = (e: KeyLike, platform: string): boolean => e.code === 'Slash' && modOf(e, platform) && e.shiftKey && !e.altKey && e.isComposing !== true;
