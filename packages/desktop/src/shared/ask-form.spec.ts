import { describe, expect, it } from 'vitest';
import { customChoice, needLabel, pickChoice, reversibilityTone, reviseChoice } from './ask-form.js';

describe('질문 카드 화면 규칙', () => {
  it('되돌리기 쉬움 칩은 쉬우면 초록, 어려우면 빨강, 그 밖에는 노랑이다', () => {
    expect(reversibilityTone('쉬움')).toBe('green');
    expect(reversibilityTone('어려움')).toBe('red');
    expect(reversibilityTone('보통')).toBe('yellow');
    expect(reversibilityTone('모름')).toBe('yellow');
  });

  it('방향을 고르면 이유 한 줄과 "설계까지 이어 가기"를 함께 보낸다', () => {
    expect(pickChoice('b', '  락이 더 단순하다 ', true)).toEqual({ kind: 'pick', id: 'b', reason: '락이 더 단순하다', goOn: true });
    expect(pickChoice('a', '', false)).toEqual({ kind: 'pick', id: 'a', reason: '', goOn: false });
  });

  it('너무 긴 이유는 200자에서 자른다', () => {
    const choice = pickChoice('a', 'y'.repeat(500), false);
    expect(choice.kind === 'pick' && choice.reason.length).toBe(200);
  });

  it('직접 쓴 방향이 비어 있으면 보낼 수 없고, 400자에서 자른다', () => {
    expect(customChoice('   ', '', false)).toBeNull();
    expect(customChoice(' 새로 만든다 ', '이유', false)).toEqual({ kind: 'custom', text: '새로 만든다', reason: '이유', goOn: false });
    const long = customChoice('x'.repeat(900), '', false);
    expect(long?.kind === 'custom' && long.text.length).toBe(400);
  });

  it('고칠 점이 비어 있으면 보낼 수 없다', () => {
    expect(reviseChoice(' ')).toBeNull();
    expect(reviseChoice(' 테스트를 더 잘게 ')).toEqual({ kind: 'revise', note: '테스트를 더 잘게' });
  });

  it('질문 카드만 떠 있으면 "선택 필요", 허락이 하나라도 섞이면 "허락 필요"다', () => {
    expect(needLabel([{ ask: {} }, { ask: {} }])).toBe('선택 필요');
    expect(needLabel([{ ask: {} }, { ask: null }])).toBe('허락 필요');
    expect(needLabel([])).toBe('허락 필요');
  });
});
