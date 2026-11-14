import { describe, expect, it } from 'vitest';
import { GitIdentity } from './git-guard.js';
import { gitFixFor } from './git-toolbar.js';

describe('Git 이름·이메일 값 객체', () => {
  it('앞뒤 공백을 지운 이름과 이메일을 받는다', () => {
    const id = GitIdentity.parse({ name: '  김평화 ', email: ' me@example.com ' });
    expect([id.name, id.email]).toEqual(['김평화', 'me@example.com']);
  });
  it('비었거나, 줄바꿈 같은 제어 문자가 있거나, 옵션처럼 - 로 시작하면 거절한다', () => {
    expect(() => GitIdentity.parse({ name: '', email: 'a@b.c' })).toThrow();
    expect(() => GitIdentity.parse({ name: 'a\nb', email: 'a@b.c' })).toThrow();
    expect(() => GitIdentity.parse({ name: '--global', email: 'a@b.c' })).toThrow();
    expect(() => GitIdentity.parse({ name: 'Me', email: '-x@b.c' })).toThrow();
  });
  it('이메일은 @ 앞뒤가 있어야 하고 254자까지', () => {
    expect(() => GitIdentity.parse({ name: 'Me', email: 'no-at' })).toThrow();
    expect(() => GitIdentity.parse({ name: 'Me', email: `${'a'.repeat(250)}@b.cd` })).toThrow();
    expect(() => GitIdentity.parse({ name: 'x'.repeat(101), email: 'a@b.c' })).toThrow();
  });
});

describe('실패 줄 옆 "바로 고치기" 단추 고르기', () => {
  it('이름·이메일이 없으면 identity', () => {
    expect(gitFixFor('Git does not know your name and email yet. Run git config ...')).toBe('identity');
    expect(gitFixFor('*** Please tell me who you are.')).toBe('identity');
  });
  it('원격에 못 닿으면 retry', () => {
    expect(gitFixFor('Could not reach the remote. Check your internet connection.')).toBe('retry');
  });
  it('모르는 실패는 없음', () => {
    expect(gitFixFor('fatal: something odd')).toBeNull();
  });
});
