import { describe, expect, it } from 'vitest';
import { SearchMatcher } from './text-search.js';

const matcher = (query: string, caseSensitive = false, regex = false): SearchMatcher => {
  const r = SearchMatcher.from({ query, caseSensitive, regex });
  if (!r.ok) throw new Error(r.reason);
  return r.matcher;
};

describe('파일 안 검색 맞추기', () => {
  it('줄마다 처음 맞은 곳의 줄·칸을 돌려준다', () => {
    const hits = matcher('foo').search('a\n  foo bar foo\nxx', 10);
    expect(hits).toEqual([{ line: 2, column: 3, preview: 'foo bar foo', start: 0, end: 3 }]);
  });

  it('기본은 대소문자를 가리지 않고, 켜면 가린다', () => {
    expect(matcher('FOO').search('foo', 5)).toHaveLength(1);
    expect(matcher('FOO', true).search('foo', 5)).toHaveLength(0);
  });

  it('일반 글 검색에서는 . * ( 같은 글자를 그대로 찾는다', () => {
    expect(matcher('a.b').search('axb\na.b', 5)).toEqual([expect.objectContaining({ line: 2 })]);
    expect(matcher('f(x)').search('f(x)', 5)).toHaveLength(1);
  });

  it('정규식 모드에서는 정규식으로 읽는다', () => {
    expect(matcher('a.b', false, true).search('axb', 5)).toHaveLength(1);
  });

  it('잘못된 정규식과 빈 검색어는 만들지 않는다', () => {
    expect(SearchMatcher.from({ query: '(', caseSensitive: false, regex: true })).toEqual({ ok: false, reason: 'bad-regex' });
    expect(SearchMatcher.from({ query: '', caseSensitive: false, regex: false })).toEqual({ ok: false, reason: 'empty' });
  });

  it('빈 글자에 맞는 정규식은 건너뛴다', () => {
    expect(matcher('x*', false, true).search('abc', 5)).toEqual([]);
  });

  it('한 파일에서 maxHits개까지만 모은다', () => {
    expect(matcher('a').search('a\na\na\na', 2)).toHaveLength(2);
  });

  it('너무 긴 줄(2000자 넘음)은 검사하지 않는다', () => {
    expect(matcher('a').search('a'.repeat(2001), 5)).toEqual([]);
  });

  it('긴 줄은 맞은 곳 주변만 보여 준다', () => {
    const hit = matcher('needle').search(`${'x'.repeat(500)}needle${'y'.repeat(500)}`, 1)[0]!;
    expect(hit.preview.length).toBeLessThanOrEqual(260);
    expect(hit.preview.slice(hit.start, hit.end)).toBe('needle');
    expect(hit.column).toBe(501);
  });

  it('CRLF 줄 끝은 지운다', () => {
    expect(matcher('a').search('a\r', 1)[0]?.preview).toBe('a');
  });
});
