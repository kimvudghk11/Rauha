import { describe, expect, it } from 'vitest';
import type { PixelCharacter } from '../characters-data.js';
import { resolveCharacter, setProblems } from './resolve.js';

const make = (name: string, animal: string): PixelCharacter => ({ name, animal, colors: { B: '#fff' }, frames: Array.from({ length: 5 }, () => ['BB', 'BB']) });
const sea = make('바다', '고래');
const wood = make('숲', '여우');
const mine = make('내것', '곰');

describe('resolveCharacter', () => {
  it('사용자가 고른 캐릭터가 현재 세트보다 먼저다', () => {
    expect(resolveCharacter('tester', mine, { tester: wood }, { tester: sea })).toBe(mine);
  });
  it('고른 게 없으면 현재 세트의 그 역할을 쓴다', () => {
    expect(resolveCharacter('tester', undefined, { tester: wood }, { tester: sea })).toBe(wood);
  });
  it('현재 세트에 그 역할이 없으면 기본 세트의 그 역할로 되돌아간다', () => {
    expect(resolveCharacter('tester', undefined, {}, { tester: sea })).toBe(sea);
  });
  it('prototype 이름 같은 역할은 없는 것으로 본다', () => {
    expect(resolveCharacter('constructor', undefined, {}, {})).toBeUndefined();
  });
});

describe('setProblems', () => {
  it('비어 있는 세트는 흠이 없다', () => {
    expect(setProblems({})).toEqual([]);
  });
  it('이름이나 동물이 겹치면 알려 준다', () => {
    expect(setProblems({ a: wood, b: make('숲', '토끼') }).join()).toContain('이름 겹침');
    expect(setProblems({ a: wood, b: make('나무', '여우') }).join()).toContain('동물 겹침');
  });
  it('프레임이 다섯이 아니거나 크기가 다르거나 팔레트에 없는 글자를 쓰면 알려 준다', () => {
    expect(setProblems({ a: { ...wood, frames: [['BB']] } }).join()).toContain('프레임이 1개');
    expect(setProblems({ a: { ...wood, frames: [...wood.frames.slice(1), ['B', 'B']] } }).join()).toContain('줄 길이');
    expect(setProblems({ a: { ...wood, frames: [...wood.frames.slice(1), ['BX', 'BB']] } }).join()).toContain("'X'");
  });
  it('멀쩡한 세트는 흠이 없다', () => {
    expect(setProblems({ a: wood, b: sea })).toEqual([]);
  });
});
