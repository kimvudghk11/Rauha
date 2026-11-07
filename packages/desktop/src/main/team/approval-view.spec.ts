import { describe, expect, it } from 'vitest';
import { answerFor, approvalView } from './approval-view.js';

describe('answerFor', () => {
  it('한 번만 허락은 allow, 이번 작업 동안 허락은 allow-always다', () => {
    expect(answerFor({ kind: 'once' })).toEqual({ kind: 'allow' });
    expect(answerFor({ kind: 'job' })).toEqual({ kind: 'allow-always' });
  });

  it('다르게 해 달라는 말은 거절과 함께 팀원에게 가고, 빈 말이면 그냥 거절이다', () => {
    expect(answerFor({ kind: 'revise', note: ' qa로 해 줘 ' })).toEqual({ kind: 'deny', note: 'qa로 해 줘' });
    expect(answerFor({ kind: 'revise', note: '  ' })).toEqual({ kind: 'deny', note: null });
  });

  it('거절은 말 없이 거절이다', () => {
    expect(answerFor({ kind: 'deny' })).toEqual({ kind: 'deny', note: null });
  });
});

describe('approvalView', () => {
  it('요청에 정리와 원본 명령을 함께 담고 팀원 이름을 붙인다', () => {
    const view = approvalView({ id: 'p1', jobId: 'j1', at: '2026-11-08T00:00:00.000Z', request: { role: 'implementer', tool: 'Bash', detail: 'git push origin main', reason: '푸시' } });
    expect(view.roleName).toBe('구현 팀원');
    expect(view.detail).toBe('git push origin main');
    expect(view.summary.protectedBranch).toBe('main');
  });
});
