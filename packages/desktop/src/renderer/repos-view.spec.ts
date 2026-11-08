import { describe, expect, it } from 'vitest';
import { syncText } from './repos-view.js';

describe('syncText', () => {
  it('앞섬·뒤처짐을 화살표로 쓴다', () => {
    expect(syncText(2, 1)).toBe('↑2 ↓1');
    expect(syncText(0, 3)).toBe('↓3');
    expect(syncText(4, 0)).toBe('↑4');
  });

  it('같으면 같다고, 원격이 없으면 없다고 쓴다', () => {
    expect(syncText(0, 0)).toBe('원격과 같음');
    expect(syncText(null, null)).toBe('원격 없음');
  });
});
