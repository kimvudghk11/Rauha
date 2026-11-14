import { describe, expect, it } from 'vitest';
import { logMatches } from './git-lists.js';

const row = { hash: '3f2a9c1d00000000000000000000000000000000', short: '3f2a9c1', author: 'Kim', at: 0, subject: 'feat(git): repo bar', refs: ['HEAD -> main', 'origin/main'], parents: [] };

describe('히스토리 찾기', () => {
  it('빈 찾기는 모두 맞다', () => {
    expect(logMatches(row, '  ')).toBe(true);
  });
  it('제목·작성자는 대소문자 없이, 해시는 앞부분으로, 브랜치 이름으로도 찾는다', () => {
    expect(logMatches(row, 'REPO bar')).toBe(true);
    expect(logMatches(row, 'kim')).toBe(true);
    expect(logMatches(row, '3f2a9')).toBe(true);
    expect(logMatches(row, 'origin/main')).toBe(true);
    expect(logMatches(row, '9c1d')).toBe(false);
  });
  it('띄어 쓴 낱말은 모두 들어 있어야 한다', () => {
    expect(logMatches(row, 'feat kim')).toBe(true);
    expect(logMatches(row, 'feat lee')).toBe(false);
  });
});
