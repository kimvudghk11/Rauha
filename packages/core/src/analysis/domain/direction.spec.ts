import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { DirectionSet, type DirectionOptionInput } from './direction.js';

const option = (id: string, title = `방향 ${id}`): DirectionOptionInput => ({
  id,
  title,
  summary: `${title} 요약`,
  pros: ['단순하다'],
  cons: ['범위가 넓다'],
  risk: '기존 호출부가 깨질 수 있다',
  reversibility: 'easy',
  touches: ['packages/api/src/pay'],
});

const three = [option('a'), option('b'), option('c')];

describe('DirectionSet', () => {
  it('방향은 2개에서 4개까지다', () => {
    expect(() => DirectionSet.of([option('a')], 'a', '이유')).toThrow(DomainError);
    expect(() => DirectionSet.of([option('a'), option('b'), option('c'), option('d'), option('e')], 'a', '이유')).toThrow(DomainError);
    expect(DirectionSet.of([option('a'), option('b')], 'a', '이유').options).toHaveLength(2);
  });

  it('AI 추천은 보여 준 방향 중 정확히 하나다', () => {
    expect(() => DirectionSet.of(three, 'z', '이유')).toThrow(DomainError);
    expect(DirectionSet.of(three, 'b', '이유').recommended().id).toBe('b');
  });

  it('방향 번호는 겹치지 않는다', () => {
    expect(() => DirectionSet.of([option('a'), option('a')], 'a', '이유')).toThrow(DomainError);
  });

  it('추천 이유가 비어 있으면 만들 수 없다', () => {
    expect(() => DirectionSet.of(three, 'a', ' ')).toThrow(DomainError);
  });

  it('추천을 그대로 고르면 AI와 같은 선택이고 이유는 AI의 추천 이유를 쓴다', () => {
    const set = DirectionSet.of(three, 'b', '되돌리기 쉽다');
    const choice = set.choose({ kind: 'pick', id: 'b' });
    expect(choice.divergedFromAi()).toBe(false);
    expect(choice.recommended).toBe('방향 b');
    expect(choice.chosen).toBe('방향 b');
    expect(choice.reason).toBe('되돌리기 쉽다');
  });

  it('다른 방향을 고르면 AI 추천과 다르게 고른 것으로 남고, 이유는 내가 적은 것이다', () => {
    const set = DirectionSet.of(three, 'b', '되돌리기 쉽다');
    const choice = set.choose({ kind: 'pick', id: 'c', reason: '다음 주에 어차피 갈아엎는다' });
    expect(choice.divergedFromAi()).toBe(true);
    expect(choice.chosen).toBe('방향 c');
    expect(choice.reason).toBe('다음 주에 어차피 갈아엎는다');
  });

  it('다른 방향을 이유 없이 고르면 이유는 비워 둔다(AI의 이유를 내 이유처럼 쓰지 않는다)', () => {
    const choice = DirectionSet.of(three, 'b', '되돌리기 쉽다').choose({ kind: 'pick', id: 'a' });
    expect(choice.reason).toBeNull();
  });

  it('내가 직접 쓴 방향도 고를 수 있고 AI 추천과 다른 것으로 본다', () => {
    const choice = DirectionSet.of(three, 'b', '이유').choose({ kind: 'custom', text: '  결제 모듈을 통째로 새로 만든다  ' });
    expect(choice.custom).toBe(true);
    expect(choice.chosen).toBe('결제 모듈을 통째로 새로 만든다');
    expect(choice.divergedFromAi()).toBe(true);
  });

  it('직접 쓴 방향이 비어 있거나 너무 길면 거절한다', () => {
    const set = DirectionSet.of(three, 'b', '이유');
    expect(() => set.choose({ kind: 'custom', text: '  ' })).toThrow(DomainError);
    expect(() => set.choose({ kind: 'custom', text: 'x'.repeat(401) })).toThrow(DomainError);
  });

  it('보여 주지 않은 방향 번호를 고르면 거절한다', () => {
    expect(() => DirectionSet.of(three, 'b', '이유').choose({ kind: 'pick', id: 'q' })).toThrow(DomainError);
  });

  it('되돌리기 쉬움은 쉬움·보통·어려움 중 하나다', () => {
    expect(() => DirectionSet.of([{ ...option('a'), reversibility: 'never' as never }, option('b')], 'a', '이유')).toThrow(DomainError);
  });
});
