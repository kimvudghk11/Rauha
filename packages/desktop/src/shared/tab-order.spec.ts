import { describe, expect, it } from 'vitest';
import { mergeTabOrder, moveTab } from './tab-order.js';

const D = ['chat', 'code', 'todo', 'api'];

describe('탭 순서', () => {
  it('저장된 것이 없으면 기본 순서를 쓴다', () => {
    expect(mergeTabOrder(D, null)).toEqual(D);
    expect(mergeTabOrder(D, 'x')).toEqual(D);
  });
  it('저장된 순서를 따르고 빠진 새 탭은 뒤에 붙는다', () => {
    expect(mergeTabOrder(D, ['todo', 'chat'])).toEqual(['todo', 'chat', 'code', 'api']);
  });
  it('없어진 탭, 중복, 문자열이 아닌 값은 버린다', () => {
    expect(mergeTabOrder(D, ['gone', 'api', 'api', 3, 'chat'])).toEqual(['api', 'chat', 'code', 'todo']);
  });
  it('저장본이 오염되어도(객체·숫자·중첩 배열·__proto__ 같은 이름·엄청 큰 목록) 기본 탭이 빠지거나 겹치지 않는다', () => {
    const defaults = ['chat', 'code', 'git'];
    const junk: unknown[] = [{ 0: 'git' }, 7, 'null', true, JSON.parse('{"__proto__":1}'), ['git'], '__proto__', 'constructor', 'toString', 'git', 'git', ...Array.from({ length: 100_000 }, (_, i) => `ghost${i}`)];
    expect(mergeTabOrder(defaults, junk)).toEqual(['git', 'chat', 'code']);
    for (const saved of [{ 0: 'git', length: 1 }, 'git', 42, null, undefined, true, 'chat,code,git', new Set(['git'])]) {
      expect(mergeTabOrder(defaults, saved)).toEqual(defaults);
    }
  });
  it('저장본에 맨 아래 고정 탭 id 가 있어도 위쪽 순서에 끼어들지 못한다', () => {
    expect(mergeTabOrder(['chat', 'code'], ['settings', 'code', 'chat'])).toEqual(['code', 'chat']);
  });
  it('탭을 다른 탭 앞으로 옮긴다', () => {
    expect(moveTab(D, 'api', 'chat', false)).toEqual(['api', 'chat', 'code', 'todo']);
  });
  it('탭을 다른 탭 뒤로 옮긴다', () => {
    expect(moveTab(D, 'chat', 'todo', true)).toEqual(['code', 'todo', 'chat', 'api']);
  });
  it('같은 탭이거나 모르는 탭이면 그대로 둔다', () => {
    expect(moveTab(D, 'chat', 'chat', true)).toEqual(D);
    expect(moveTab(D, 'zzz', 'chat', true)).toEqual(D);
  });
});
