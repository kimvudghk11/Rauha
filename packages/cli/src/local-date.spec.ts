import { describe, expect, it } from 'vitest';
import { localDate } from './local-date.js';

describe('localDate', () => {
  it('컴퓨터 시계의 날짜로 YYYY-MM-DD를 돌려준다', () => {
    expect(localDate(new Date(2026, 10, 1, 0, 30))).toBe('2026-11-01');
  });

  it('자정 직후에도 UTC가 아니라 지금 있는 곳의 날짜다', () => {
    expect(localDate(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});
