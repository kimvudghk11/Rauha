import { describe, expect, it } from 'vitest';
import { termKeyAction, type KeyFacts } from './term-keys.js';

const key = (over: Partial<KeyFacts>): KeyFacts => ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

describe('터미널 안에서의 단축키 처리', () => {
  it('Windows·리눅스: 선택이 있을 때 Ctrl+C는 복사, 선택이 없으면 셸로 가는 Ctrl+C(중단)다', () => {
    const e = key({ key: 'c', code: 'KeyC', ctrlKey: true });
    expect(termKeyAction(e, 'win32', true)).toBe('copy');
    expect(termKeyAction(e, 'win32', false)).toBeNull();
  });

  it('Ctrl+Shift+C는 선택 여부와 관계없이 복사 키로 가로챈다(셸로 보내지 않는다)', () => {
    expect(termKeyAction(key({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('copy');
  });

  it('맥은 Cmd+C가 복사, Ctrl+C는 항상 셸로 간다', () => {
    expect(termKeyAction(key({ key: 'c', code: 'KeyC', metaKey: true }), 'darwin', true)).toBe('copy');
    expect(termKeyAction(key({ key: 'c', code: 'KeyC', ctrlKey: true }), 'darwin', true)).toBeNull();
  });

  it('붙여넣기(Ctrl/Cmd+V, Ctrl+Shift+V)는 xterm이 가로채지 않고 브라우저 붙여넣기로 보낸다', () => {
    expect(termKeyAction(key({ key: 'v', code: 'KeyV', ctrlKey: true }), 'win32', false)).toBe('paste');
    expect(termKeyAction(key({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }), 'linux', false)).toBe('paste');
    expect(termKeyAction(key({ key: 'v', code: 'KeyV', metaKey: true }), 'darwin', false)).toBe('paste');
  });

  it('Ctrl/Cmd+F는 터미널 찾기, Ctrl/Cmd+백틱은 칸 토글, +Shift는 새 터미널이다', () => {
    expect(termKeyAction(key({ key: 'f', code: 'KeyF', ctrlKey: true }), 'win32', false)).toBe('find');
    expect(termKeyAction(key({ key: '`', code: 'Backquote', ctrlKey: true }), 'win32', false)).toBe('toggle');
    expect(termKeyAction(key({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('new');
    expect(termKeyAction(key({ key: '`', code: 'Backquote', metaKey: true }), 'darwin', false)).toBe('toggle');
  });

  it('앱 탭 전환(Ctrl/Cmd+숫자, +쉼표)과 안내창 단축키는 셸로 보내지 않고 앱이 받게 둔다', () => {
    expect(termKeyAction(key({ key: '3', code: 'Digit3', ctrlKey: true }), 'win32', false)).toBe('app');
    expect(termKeyAction(key({ key: ',', code: 'Comma', ctrlKey: true }), 'win32', false)).toBe('app');
    expect(termKeyAction(key({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('app');
    expect(termKeyAction(key({ key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('app');
  });

  it('셸이 쓰는 Ctrl 조합(Ctrl+D·Ctrl+R·Ctrl+Z 등)과 일반 글자는 그대로 셸로 보낸다', () => {
    for (const k of ['d', 'r', 'z', 'a', 'e', 'l', 'u', 'w']) expect(termKeyAction(key({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: true }), 'win32', true)).toBeNull();
    expect(termKeyAction(key({ key: 'a', code: 'KeyA' }), 'win32', false)).toBeNull();
  });

  it('Alt가 함께 눌린 조합(AltGr 입력 등)은 건드리지 않는다', () => {
    expect(termKeyAction(key({ key: '3', code: 'Digit3', ctrlKey: true, altKey: true }), 'win32', false)).toBeNull();
  });
});
