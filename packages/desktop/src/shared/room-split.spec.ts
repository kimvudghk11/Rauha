import { describe, expect, it } from 'vitest';
import { roomSplit } from './room-split.js';

describe('작업자 칸 비율', () => {
  it('작업자가 없으면 메인만 보인다', () => {
    expect(roomSplit(0)).toBe('0');
    expect(roomSplit(Number.NaN)).toBe('0');
  });
  it('1~2명은 7:3, 3~4명은 6:4, 5명부터는 5:5 단계다', () => {
    expect([1, 2].map(roomSplit)).toEqual(['a', 'a']);
    expect([3, 4].map(roomSplit)).toEqual(['b', 'b']);
    expect([5, 9].map(roomSplit)).toEqual(['c', 'c']);
  });
});
