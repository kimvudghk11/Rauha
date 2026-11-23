import { describe, expect, it } from 'vitest';
import { systemPromptFor } from './agent-sdk-team-member.js';

describe('메인 채팅 Claude 의 시스템 프롬프트', () => {
  it('메인 채팅 Claude 는 Claude Code 와 같은 시스템 프롬프트에 rauha 글(결과 모양·사용자 규칙)만 덧붙인다', () => {
    expect(systemPromptFor('direct', 'RAUHA')).toEqual({ type: 'preset', preset: 'claude_code', append: 'RAUHA' });
  });

  it('다른 팀원은 자기 프롬프트 그대로 쓴다', () => {
    expect(systemPromptFor('answerer', 'A')).toBe('A');
    expect(systemPromptFor('implementer', 'M')).toBe('M');
  });
});
