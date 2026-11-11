import { describe, expect, it } from 'vitest';
import { fallbackSearchFor, groupLocations, isTsLikePath, lineColToOffset, offsetToLineCol, wordAt, type NavLocation } from './ts-nav.js';

describe('정의로 이동·참조 찾기의 순수 규칙', () => {
  it('TypeScript·JavaScript 계열 확장자만 언어 도구 대상이다', () => {
    for (const p of ['a.ts', 'a.tsx', 'x/y.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.mts', 'a.cts', 'A.TS']) expect(isTsLikePath(p)).toBe(true);
    for (const p of ['a.json', 'a.d.ts.map', 'a.py', 'Makefile', 'a.tsx.bak']) expect(isTsLikePath(p)).toBe(false);
  });

  it('커서 아래의 식별자를 뽑는다(앞뒤 기호는 뺀다)', () => {
    const text = 'const fooBar = baz.qux_1($x);';
    expect(wordAt(text, 8)).toBe('fooBar');
    expect(wordAt(text, 6)).toBe('fooBar');
    expect(wordAt(text, 12)).toBe('fooBar');
    expect(wordAt(text, 18)).toBe('baz');
    expect(wordAt(text, 22)).toBe('qux_1');
    expect(wordAt(text, 26)).toBe('$x');
  });

  it('식별자가 없는 자리와 숫자만의 낱말은 null 이다', () => {
    expect(wordAt('a  b', 2)).toBeNull();
    expect(wordAt('x = 123;', 5)).toBeNull();
    expect(wordAt('', 0)).toBeNull();
  });

  it('한글 식별자도 낱말로 본다', () => {
    expect(wordAt('const 이름 = 1', 8)).toBe('이름');
  });

  it('줄·칸과 글자 위치를 서로 바꾼다(1부터)', () => {
    const text = 'ab\ncde\n\nf';
    expect(offsetToLineCol(text, 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineCol(text, 4)).toEqual({ line: 2, column: 2 });
    expect(offsetToLineCol(text, 8)).toEqual({ line: 4, column: 1 });
    expect(lineColToOffset(text, 2, 2)).toBe(4);
    expect(lineColToOffset(text, 4, 1)).toBe(8);
    expect(lineColToOffset(text, 9, 1)).toBeNull();
    expect(lineColToOffset(text, 1, 99)).toBe(2);
  });

  it('언어 도구가 없을 때의 대체는 낱말 단위·대소문자 구분 검색이다', () => {
    expect(fallbackSearchFor('fooBar')).toEqual({ query: 'fooBar', caseSensitive: true, regex: false, wholeWord: true });
  });

  it('위치 목록을 파일별로 묶고 상한을 지킨다', () => {
    const loc = (path: string, line: number): NavLocation => ({ path, line, column: 1, preview: 'x', start: 0, end: 1 });
    const grouped = groupLocations([loc('b.ts', 3), loc('a.ts', 9), loc('a.ts', 2), loc('b.ts', 1)], 10);
    expect(grouped.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(grouped.files[0]?.hits.map((h) => h.line)).toEqual([2, 9]);
    expect(grouped.truncated).toBe(false);
    const capped = groupLocations([loc('a.ts', 1), loc('a.ts', 2), loc('a.ts', 3)], 2);
    expect(capped.files[0]?.hits).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it('같은 자리가 두 번 오면 한 번만 쓴다', () => {
    const loc: NavLocation = { path: 'a.ts', line: 1, column: 1, preview: 'x', start: 0, end: 1 };
    expect(groupLocations([loc, { ...loc }], 10).files[0]?.hits).toHaveLength(1);
  });
});
