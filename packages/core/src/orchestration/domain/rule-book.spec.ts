import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { Rule, RuleBook, type RuleProps } from './rule-book.js';

const rule = (over: Partial<RuleProps> = {}) =>
  Rule.create({ id: 'r1', text: 'git push는 묻지 않아도 돼', bucket: 'allow', scope: { kind: 'global' }, match: { tools: ['Bash'], includes: ['git push'] }, ...over });

describe('Rule.create', () => {
  it('글이 비어 있으면 만들 수 없다', () => {
    expect(() => rule({ text: '  ' })).toThrow(DomainError);
  });

  it('묻지 않음·허락 규칙은 찾을 글이 하나는 있어야 한다', () => {
    expect(() => rule({ match: { tools: [], includes: [] } })).toThrow(/찾을 글/);
    expect(() => rule({ bucket: 'ask', match: { tools: [], includes: ['  '] } })).toThrow(DomainError);
  });

  it('항상 지킬 것은 글만 있어도 된다', () => {
    expect(rule({ bucket: 'always', text: '답은 한국어로', match: { tools: [], includes: [] } }).bucket).toBe('always');
  });
});

describe('Rule.appliesIn', () => {
  it('전체 규칙은 어느 폴더에서나 적용된다', () => {
    expect(rule().appliesIn('C:/any')).toBe(true);
  });

  it('폴더 규칙은 그 폴더와 그 아래에서만 적용되고 이름만 비슷한 폴더는 아니다', () => {
    const r = rule({ scope: { kind: 'folder', path: 'C:\\work\\api-server' } });
    expect(r.appliesIn('c:/work/api-server')).toBe(true);
    expect(r.appliesIn('C:/work/api-server/src')).toBe(true);
    expect(r.appliesIn('C:/work/api-server-old')).toBe(false);
    expect(r.appliesIn('C:/work/docs')).toBe(false);
  });
});

describe('Rule.matches', () => {
  it('도구와 글이 모두 맞아야 맞는다(대소문자 무시)', () => {
    const r = rule({ match: { tools: ['Bash'], includes: ['GIT', 'push'] } });
    expect(r.matches('Bash', 'git push origin feature')).toBe(true);
    expect(r.matches('Write', 'git push')).toBe(false);
    expect(r.matches('Bash', 'git pull')).toBe(false);
  });

  it('도구를 비우면 어느 도구에나 맞는다', () => {
    expect(rule({ match: { tools: [], includes: ['.env'] } }).matches('Read', 'C:/x/.env')).toBe(true);
  });
});

describe('RuleBook', () => {
  it('같은 id를 두 번 넣으면 거절한다', () => {
    expect(() => RuleBook.of([rule(), rule()])).toThrow(DomainError);
  });

  it('규칙을 지워도 원래 모음은 그대로다', () => {
    const book = RuleBook.of([rule()]);
    expect(book.remove('r1').rules).toEqual([]);
    expect(book.rules.length).toBe(1);
  });

  it('규칙에 안 맞으면 판정하지 않는다(기본 위험 규칙에 맡긴다)', () => {
    expect(RuleBook.of([rule()]).verdictFor('Bash', 'ls', 'C:/w')).toBeNull();
  });

  it('묻지 않음 규칙에 맞으면 allow다', () => {
    expect(RuleBook.of([rule()]).verdictFor('Bash', 'git push origin x', 'C:/w')).toBe('allow');
  });

  it('같은 호출이 묻지 않음과 허락 규칙에 모두 맞으면 허락(ask)이 앞선다', () => {
    const book = RuleBook.of([rule(), rule({ id: 'r2', bucket: 'ask', text: 'main push는 꼭 묻기', match: { tools: ['Bash'], includes: ['git push', 'main'] } })]);
    expect(book.verdictFor('Bash', 'git push origin main', 'C:/w')).toBe('ask');
    expect(book.verdictFor('Bash', 'git push origin fix', 'C:/w')).toBe('allow');
  });

  it('범위 밖 폴더의 규칙은 판정에 쓰지 않는다', () => {
    const book = RuleBook.of([rule({ scope: { kind: 'folder', path: 'C:/work/a' } })]);
    expect(book.verdictFor('Bash', 'git push', 'C:/work/b')).toBeNull();
  });

  it('항상 지킬 것은 이 폴더에 적용되는 것만 글로 모아 준다', () => {
    const book = RuleBook.of([
      rule({ id: 'a', bucket: 'always', text: '답은 한국어로', match: { tools: [], includes: [] } }),
      rule({ id: 'b', bucket: 'always', text: '이 폴더만', scope: { kind: 'folder', path: 'C:/x' }, match: { tools: [], includes: [] } }),
    ]);
    expect(book.alwaysTexts('C:/y')).toEqual(['답은 한국어로']);
    expect(book.alwaysTexts('C:/x/sub')).toEqual(['답은 한국어로', '이 폴더만']);
  });
});
