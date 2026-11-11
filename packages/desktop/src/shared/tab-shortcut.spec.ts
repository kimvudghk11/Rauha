import { describe, expect, it } from 'vitest';
import { isShortcutSheetKey, tabShortcutIndex } from './tab-shortcut.js';

const key = (o: Partial<Parameters<typeof tabShortcutIndex>[0]> = {}) => ({ code: 'Digit1', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...o });

describe('탭 전환 단축키', () => {
  it('Windows에서 Ctrl+1은 첫 탭(0)이다', () => expect(tabShortcutIndex(key(), 'win32')).toBe(0));
  it('Ctrl+8은 여덟째 탭(7)이다', () => expect(tabShortcutIndex(key({ code: 'Digit8' }), 'win32')).toBe(7));
  it('맥에서는 Cmd+숫자이고 Ctrl+숫자는 무시한다', () => {
    expect(tabShortcutIndex(key({ ctrlKey: false, metaKey: true, code: 'Digit3' }), 'darwin')).toBe(2);
    expect(tabShortcutIndex(key(), 'darwin')).toBeNull();
  });
  it('Windows에서 Win(meta)+숫자는 무시한다', () => expect(tabShortcutIndex(key({ ctrlKey: false, metaKey: true }), 'win32')).toBeNull());
  it('Ctrl+9는 아홉째 탭(8)이다', () => expect(tabShortcutIndex(key({ code: 'Digit9' }), 'win32')).toBe(8));
  it('Ctrl+0은 열째 탭(9)이다', () => expect(tabShortcutIndex(key({ code: 'Digit0' }), 'win32')).toBe(9));
  it('Shift나 Alt가 같이 눌리면 무시한다', () => {
    expect(tabShortcutIndex(key({ shiftKey: true }), 'win32')).toBeNull();
    expect(tabShortcutIndex(key({ altKey: true }), 'win32')).toBeNull();
  });
  it('글자 조합 중에는 무시한다', () => expect(tabShortcutIndex(key({ isComposing: true }), 'win32')).toBeNull());
});

describe('단축키 안내 열기', () => {
  const sheet = (o: Partial<Parameters<typeof isShortcutSheetKey>[0]> = {}) => ({ code: 'Slash', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, ...o });
  it('Windows에서 Ctrl+Shift+/ 이면 열린다', () => expect(isShortcutSheetKey(sheet(), 'win32')).toBe(true));
  it('맥에서는 Cmd+Shift+/ 이다', () => {
    expect(isShortcutSheetKey(sheet({ ctrlKey: false, metaKey: true }), 'darwin')).toBe(true);
    expect(isShortcutSheetKey(sheet(), 'darwin')).toBe(false);
  });
  it('Shift 없는 Ctrl+/ 는 편집기 주석 단축키라 건드리지 않는다', () => expect(isShortcutSheetKey(sheet({ shiftKey: false }), 'win32')).toBe(false));
  it('글자 조합 중에는 무시한다', () => expect(isShortcutSheetKey(sheet({ isComposing: true }), 'win32')).toBe(false));
});
