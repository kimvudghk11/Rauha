import { describe, expect, it } from 'vitest';
import { isRepeatPress, isRepeatExempt, REPEAT_MS } from './click-guard.js';

describe('같은 버튼 연속 누름', () => {
  const a = new EventTarget();
  const b = new EventTarget();
  it('같은 버튼을 짧은 시간 안에 또 누르면 한 번으로 본다', () => {
    expect(isRepeatPress({ target: a, at: 1000 }, a, 1000 + REPEAT_MS - 1)).toBe(true);
  });
  it('시간이 지났거나 다른 버튼이면 새 누름이다', () => {
    expect(isRepeatPress({ target: a, at: 1000 }, a, 1000 + REPEAT_MS)).toBe(false);
    expect(isRepeatPress({ target: a, at: 1000 }, b, 1100)).toBe(false);
    expect(isRepeatPress(null, a, 1100)).toBe(false);
  });
});

describe('연타 막기 예외', () => {
  it('Send가 Cancel로 바뀌는 단추처럼 data-repeat-ok 가 붙은 단추는 바로 다시 눌러도 삼키지 않는다', () => {
    expect(isRepeatExempt({ hasAttribute: (n: string) => n === 'data-repeat-ok' })).toBe(true);
    expect(isRepeatExempt({ hasAttribute: () => false })).toBe(false);
  });
});
