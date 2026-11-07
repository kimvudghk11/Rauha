import { describe, expect, it } from 'vitest';
import { modeOf, tierOf } from './layout.js';

describe('tierOf', () => {
  it.each([
    [2400, 'xl'], [1700, 'xl'], [1699, 'm'], [1100, 'm'], [1099, 's'], [720, 's'], [719, 'xs'], [480, 'xs'],
  ] as const)('창 너비 %i는 %s 단계다', (width, tier) => {
    expect(tierOf(width)).toBe(tier);
  });
});

describe('modeOf', () => {
  it('보통 너비에서는 사용자가 고른 배치 그대로다', () => {
    expect(modeOf('m', 'A')).toBe('side');
    expect(modeOf('m', 'B')).toBe('rows');
  });

  it('아주 넓으면 A에서 방을 2열로 깐다', () => {
    expect(modeOf('xl', 'A')).toBe('xl');
    expect(modeOf('xl', 'B')).toBe('rows');
  });

  it('좁으면 A를 골라도 위아래로 바뀐다', () => {
    expect(modeOf('s', 'A')).toBe('rows');
  });

  it('아주 좁으면 어느 배치를 골라도 메인만 보이고 방은 띠로 줄어든다', () => {
    expect(modeOf('xs', 'A')).toBe('xs');
    expect(modeOf('xs', 'B')).toBe('xs');
  });
});
