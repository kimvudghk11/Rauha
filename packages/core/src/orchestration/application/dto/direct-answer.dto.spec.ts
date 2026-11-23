import { describe, expect, it } from 'vitest';
import { DirectAnswerDto } from './direct-answer.dto.js';

describe('메인 채팅 Claude 결과 읽기', () => {
  it('answer 글을 그대로(앞뒤 공백만 빼고) 읽는다', () => {
    expect(DirectAnswerDto.read({ answer: '  **확인했어요**\n- a  ' })).toBe('**확인했어요**\n- a');
  });

  it('없거나 빈 글이거나 모양이 틀리면 null', () => {
    for (const bad of [null, undefined, 'x', {}, { answer: '  ' }, { answer: 3 }]) expect(DirectAnswerDto.read(bad)).toBeNull();
  });
});
