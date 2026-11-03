import { describe, expect, it } from 'vitest';
import { displayWidth, fitLines, truncateWidth } from './text-width.js';

describe('fitLines', () => {
  it('"이름  설명" 줄이 접히면 다음 줄을 설명 시작 칸에 맞춘다 (/help·/team 표)', () => {
    expect(fitLines('  /review   내 변경을 리뷰어가 검토해요', 30)).toEqual(['  /review   내 변경을 리뷰어가', '            검토해요']);
  });

  it('⚠·✓·✗ 표시가 붙은 줄이 접히면 표시 뒤에 맞춘다', () => {
    expect(fitLines('  ⚠ 로그인되어 있지 않아요 다시 와 주세요', 20)).toEqual(['  ⚠ 로그인되어 있지', '    않아요 다시 와', '    주세요']);
  });

  it('줄마다 너비를 넘지 않게 접고, 원래 줄바꿈도 지킨다', () => {
    expect(fitLines('가나다라\nabcde', 4)).toEqual(['가나', '다라', 'abcd', 'e']);
  });

  it('색 코드는 칸을 차지하지 않고 중간에 쪼개지지 않는다', () => {
    const lines = fitLines(`\x1b[38;5;117m${'a'.repeat(6)}\x1b[0m`, 4);
    expect(lines).toHaveLength(2);
    expect(lines.map(displayWidth)).toEqual([4, 2]);
    expect(lines.join('')).toBe(`\x1b[38;5;117m${'a'.repeat(6)}\x1b[0m`);
  });

  it('띄어쓰기에서 줄을 바꾸고 단어 가운데서는 자르지 않는다', () => {
    expect(fitLines('패치와 스케일링을 합니다', 12)).toEqual(['패치와', '스케일링을', '합니다']);
  });

  it('한 단어가 줄보다 길면 그 단어만 글자 단위로 자른다', () => {
    expect(fitLines('a abcdefgh', 4)).toEqual(['a', 'abcd', 'efgh']);
  });

  it('줄 앞 들여쓰기는 남긴다', () => {
    expect(fitLines('  - 가나 다라', 9)).toEqual(['  - 가나', '    다라']);
  });

  it('목록 줄이 접히면 다음 줄을 글머리 뒤에 맞춘다', () => {
    expect(fitLines('  - 가나 다라 마바', 12)).toEqual(['  - 가나', '    다라', '    마바']);
    expect(fitLines('■ 관리 주체가 다릅니다', 12)).toEqual(['■ 관리', '  주체가', '  다릅니다']);
  });

  it('빈 줄도 한 줄로 남는다', () => {
    expect(fitLines('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });
});

describe('truncateWidth', () => {
  it('너비 안이면 그대로 둔다', () => {
    expect(truncateWidth('접수 > 구현', 20)).toBe('접수 > 구현');
  });

  it('너비를 넘으면 끝을 …로 줄여 한 줄에 맞춘다', () => {
    const cut = truncateWidth('접수 > 테스트 > 구현 > 테스트(2) > 구현(2)', 14);
    expect(cut.endsWith('…')).toBe(true);
    expect(displayWidth(cut)).toBeLessThanOrEqual(14);
  });
});
