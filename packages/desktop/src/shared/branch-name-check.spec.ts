import { describe, expect, it } from 'vitest';
import { checkBranchName } from './branch-name-check.js';

const why = (name: string, existing: readonly string[] = [], remotes: readonly string[] = []) => {
  const r = checkBranchName(name, existing, remotes);
  return r.ok ? null : r.reason;
};

describe('브랜치 이름 검사', () => {
  it('비어 있으면 이름을 입력하라고 알린다', () => {
    expect(why('')).toBe('이름을 입력해 주세요.');
    expect(why('   ')).toBe('이름을 입력해 주세요.');
  });
  it('feature/login-form 같은 이름은 통과한다', () => {
    expect(checkBranchName('feature/login-form', []).ok).toBe(true);
    expect(checkBranchName('fix/한글-이름', []).ok).toBe(true);
  });
  it('공백은 쓸 수 없고 -나 _로 바꾸라고 알린다', () => {
    expect(why('my branch')).toMatch(/공백/);
  });
  it('git이 금지하는 문자를 그 문자와 함께 알린다', () => {
    for (const c of ['~', '^', ':', '?', '*', '[', '\\']) expect(why(`a${c}b`)).toContain(c);
  });
  it('연속된 점(..)과 @{ 는 쓸 수 없다', () => {
    expect(why('a..b')).toMatch(/\.\./);
    expect(why('a@{b')).toMatch(/@\{/);
  });
  it('앞의 -, 앞뒤의 /, 앞의 ., 끝의 . 과 .lock 은 쓸 수 없다', () => {
    expect(why('-a')).toMatch(/-/);
    expect(why('/a')).toMatch(/\//);
    expect(why('a/')).toMatch(/\//);
    expect(why('.a')).toMatch(/\./);
    expect(why('a.')).toMatch(/\./);
    expect(why('a.lock')).toMatch(/\.lock/);
    expect(why('a/.b')).toMatch(/\./);
  });
  it('/ 가 두 번 이어지거나 @ 한 글자만이면 쓸 수 없다', () => {
    expect(why('a//b')).toMatch(/\/\//);
    expect(why('@')).toMatch(/@/);
  });
  it('이미 있는 이름은 막고, 원격에만 있는 이름도 알린다', () => {
    expect(why('main', ['main'])).toBe('이미 있는 브랜치 이름이에요.');
    expect(why('feature/x', [], ['origin/feature/x'])).toMatch(/원격/);
  });
  it('앞뒤 공백은 지우고 검사한다', () => {
    expect(checkBranchName('  fix/a  ', []).ok).toBe(true);
  });
  it('통과하면 정리된 이름을 돌려준다', () => {
    expect(checkBranchName(' fix/a ', [])).toEqual({ ok: true, name: 'fix/a' });
  });
});
