import { describe, expect, it } from 'vitest';
import { isBugShortcut } from './bug-shortcut.js';

const key = (o: Partial<Parameters<typeof isBugShortcut>[0]> = {}) => ({ code: 'KeyB', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, ...o });

describe('답답한 점 단축키', () => {
  it('Ctrl+Shift+B 이면 열린다', () => expect(isBugShortcut(key())).toBe(true));
  it('맥의 Cmd+Shift+B 이면 열린다', () => expect(isBugShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true));
  it('한글 자판이어도 물리 B 키면 열린다', () => expect(isBugShortcut({ ...key(), code: 'KeyB' })).toBe(true));
  it('Shift가 없으면 열리지 않는다', () => expect(isBugShortcut(key({ shiftKey: false }))).toBe(false));
  it('Ctrl이나 Cmd 없이 Shift+B는 열리지 않는다', () => expect(isBugShortcut(key({ ctrlKey: false }))).toBe(false));
  it('Alt가 같이 눌리면 열리지 않는다', () => expect(isBugShortcut(key({ altKey: true }))).toBe(false));
  it('다른 키는 열리지 않는다', () => expect(isBugShortcut(key({ code: 'KeyN' }))).toBe(false));
  it('글자 조합 중에는 열리지 않는다', () => expect(isBugShortcut(key({ isComposing: true }))).toBe(false));
});
