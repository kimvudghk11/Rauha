import { describe, expect, it } from 'vitest';
import { GlobFilter } from './search-glob.js';

const glob = (text: string, ci = false): GlobFilter => {
  const r = GlobFilter.from(text, ci);
  if (!r.ok) throw new Error(r.reason);
  return r.filter;
};

describe('검색 포함·제외 글롭', () => {
  it('빈 글은 아무것도 지정하지 않은 것이다', () => {
    expect(glob('').isEmpty).toBe(true);
    expect(glob(' , ,').isEmpty).toBe(true);
  });

  it('슬래시 없는 패턴은 어느 깊이의 파일이든 이름으로 맞는다', () => {
    expect(glob('*.ts').matches('src/a/b.ts')).toBe(true);
    expect(glob('*.ts').matches('b.ts')).toBe(true);
    expect(glob('*.ts').matches('b.tsx')).toBe(false);
  });

  it('폴더 이름을 쓰면 그 폴더 아래 전부 맞는다(어느 깊이든)', () => {
    expect(glob('src').matches('src/a.ts')).toBe(true);
    expect(glob('src').matches('pkg/src/deep/a.ts')).toBe(true);
    expect(glob('src').matches('source/a.ts')).toBe(false);
  });

  it('슬래시가 든 패턴은 작업 폴더 기준이다', () => {
    expect(glob('src/**').matches('src/a/b.ts')).toBe(true);
    expect(glob('src/**').matches('lib/src/a.ts')).toBe(false);
    expect(glob('src/*.ts').matches('src/a.ts')).toBe(true);
    expect(glob('src/*.ts').matches('src/x/a.ts')).toBe(false);
  });

  it('앞의 ./ 와 / 는 작업 폴더 기준이라는 뜻이다', () => {
    expect(glob('./docs').matches('docs/a.md')).toBe(true);
    expect(glob('/docs').matches('docs/a.md')).toBe(true);
    expect(glob('/docs').matches('x/docs/a.md')).toBe(false);
  });

  it('중간의 ** 는 폴더 0개 이상이다', () => {
    expect(glob('src/**/x.ts').matches('src/x.ts')).toBe(true);
    expect(glob('src/**/x.ts').matches('src/a/b/x.ts')).toBe(true);
    expect(glob('src/**/x.ts').matches('lib/x.ts')).toBe(false);
  });

  it('? 는 글자 하나(슬래시 제외)다', () => {
    expect(glob('a?.ts').matches('ab.ts')).toBe(true);
    expect(glob('a?.ts').matches('a.ts')).toBe(false);
    expect(glob('src?a').matches('src/a')).toBe(false);
  });

  it('쉼표로 여러 개를 쓰고 중괄호 안의 쉼표는 나누지 않는다', () => {
    const g = glob('*.{ts,tsx}, docs');
    expect(g.matches('a/b.tsx')).toBe(true);
    expect(g.matches('a/b.ts')).toBe(true);
    expect(g.matches('docs/readme.md')).toBe(true);
    expect(g.matches('a/b.js')).toBe(false);
  });

  it('대소문자 무시를 켜면 대소문자를 가리지 않는다', () => {
    expect(glob('*.TS', true).matches('a.ts')).toBe(true);
    expect(glob('*.TS', false).matches('a.ts')).toBe(false);
  });

  it('.. 이 든 패턴, 너무 많거나 긴 패턴은 거절한다', () => {
    expect(GlobFilter.from('../x', false)).toEqual({ ok: false, reason: 'bad-glob' });
    expect(GlobFilter.from(Array.from({ length: 30 }, (_, i) => `a${i}`).join(','), false)).toEqual({ ok: false, reason: 'bad-glob' });
    expect(GlobFilter.from('a'.repeat(300), false)).toEqual({ ok: false, reason: 'bad-glob' });
    expect(GlobFilter.from('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}{o,p}', false)).toEqual({ ok: false, reason: 'bad-glob' });
  });

  it('별이 많은 패턴도 시간이 폭발하지 않는다', () => {
    const g = glob('*a*a*a*a*a*a*a*a*a*a*a*a*b');
    const started = Date.now();
    expect(g.matches('a'.repeat(200))).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
