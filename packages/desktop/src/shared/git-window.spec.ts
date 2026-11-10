import { describe, expect, it } from 'vitest';
import { DIFF_FIRST_LINES, DIFF_MORE_LINES, FILE_FIRST, FILE_MORE, moreLabel, nextLimit } from './git-window.js';

describe('큰 목록 나눠 그리기', () => {
  it('처음에는 정해진 만큼만 그린다', () => {
    expect(FILE_FIRST).toBe(200);
    expect(DIFF_FIRST_LINES).toBe(600);
  });

  it('더 보기를 누르면 한 번에 정해진 만큼 늘고 전체를 넘지 않는다', () => {
    expect(nextLimit(200, 3501, FILE_MORE)).toBe(200 + FILE_MORE);
    expect(nextLimit(3400, 3501, FILE_MORE)).toBe(3501);
    expect(nextLimit(600, 20000, DIFF_MORE_LINES)).toBe(600 + DIFF_MORE_LINES);
  });

  it('남은 개수를 쉬운 말로 알린다(다음에 보일 만큼과 전체 남은 수)', () => {
    expect(moreLabel(2, 3501, FILE_MORE)).toBe('Show 200 more (3499 left)');
    expect(moreLabel(3400, 3501, FILE_MORE)).toBe('Show 101 more (101 left)');
  });
});
