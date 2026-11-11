import { describe, expect, it } from 'vitest';
import { MemberContinue } from './member-continue.js';

describe('팀원 호출 이어 하기 — 한도에 닿아도 멈추지 않는다', () => {
  it('턴 한도에 닿으면 하던 일을 이어서 하라고 다시 부른다', () => {
    const next = MemberContinue.after({ endReason: 'error_max_turns', hasOutput: false, done: 0 });
    expect(next?.kind).toBe('resume-work');
    expect(next?.prompt).toContain('이어서');
    expect(MemberContinue.after({ endReason: 'max_turns', hasOutput: false, done: 1 })?.kind).toBe('resume-work');
  });

  it('일은 끝났는데 결과를 정해진 형식으로 못 냈으면 결과만 다시 정리하라고 부른다', () => {
    expect(MemberContinue.after({ endReason: 'success', hasOutput: false, done: 0 })?.kind).toBe('format-only');
    expect(MemberContinue.after({ endReason: 'error_max_structured_output_retries', hasOutput: false, done: 0 })?.kind).toBe('format-only');
    expect(MemberContinue.after({ endReason: 'success', hasOutput: false, done: 0 })?.prompt).toContain('형식');
  });

  it('결과가 있으면 다시 부르지 않는다', () => {
    expect(MemberContinue.after({ endReason: 'success', hasOutput: true, done: 0 })).toBeNull();
  });

  it('두 번 이어 한 뒤에는 더 부르지 않는다(끝없이 돌지 않게)', () => {
    expect(MemberContinue.after({ endReason: 'error_max_turns', hasOutput: false, done: 2 })).toBeNull();
    expect(MemberContinue.after({ endReason: 'success', hasOutput: false, done: 2 })).toBeNull();
  });

  it('사용 한도·로그인·알 수 없는 오류는 다시 불러도 같으므로 이어 하지 않는다', () => {
    for (const endReason of ['error', 'error_during_execution', 'error_max_budget_usd', 'usage_limit', '']) {
      expect(MemberContinue.after({ endReason, hasOutput: false, done: 0 })).toBeNull();
    }
  });
});
