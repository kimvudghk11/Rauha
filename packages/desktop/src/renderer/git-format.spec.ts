import { describe, expect, it } from 'vitest';
import { ago, syncChips } from './git-format.js';

describe('ago', () => {
  const now = 1_700_000_000;
  it('가까운 시각은 방금·분·시간·일 전으로 쓴다', () => {
    expect(ago(now - 20, now)).toBe('just now');
    expect(ago(now - 5 * 60, now)).toBe('5m ago');
    expect(ago(now - 3 * 3600, now)).toBe('3h ago');
    expect(ago(now - 86400 - 10, now)).toBe('yesterday');
    expect(ago(now - 4 * 86400, now)).toBe('4d ago');
  });
  it('한 달이 넘으면 날짜로 쓴다', () => {
    expect(ago(now - 90 * 86400, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('syncChips', () => {
  it('앞섬·뒤처짐을 칩 글자로 만든다', () => {
    expect(syncChips(3, 2)).toEqual(['Ahead 3', 'Behind 2']);
    expect(syncChips(0, 0)).toEqual(['In sync']);
    expect(syncChips(null, null)).toEqual(['No remote']);
  });
});
