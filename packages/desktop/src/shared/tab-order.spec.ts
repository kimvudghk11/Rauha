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
