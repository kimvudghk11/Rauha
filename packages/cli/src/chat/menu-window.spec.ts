import { describe, expect, it } from 'vitest';
import { menuWindow } from './menu-window.js';

describe('menuWindow', () => {
  it('후보가 적으면 다 보여 준다', () => {
    expect(menuWindow(5, 0, 8)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
  });

  it('후보가 많으면 고른 것이 보이는 만큼만 보여 주고 위·아래에 남은 수를 센다', () => {
    expect(menuWindow(17, 0, 8)).toEqual({ start: 0, end: 8, above: 0, below: 9 });
    expect(menuWindow(17, 10, 8)).toEqual({ start: 3, end: 11, above: 3, below: 6 });
    expect(menuWindow(17, 16, 8)).toEqual({ start: 9, end: 17, above: 9, below: 0 });
  });

  it('후보가 없으면 빈 창이다', () => {
    expect(menuWindow(0, 0, 8)).toEqual({ start: 0, end: 0, above: 0, below: 0 });
  });
});
