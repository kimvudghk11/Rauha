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
    const view = approvalView({ id: 'p1', jobId: 'j1', at: '2026-11-08T00:00:00.000Z', request: { role: 'implementer', tool: 'Bash', detail: 'git push origin main', reason: '푸시' }, ask: null });
    expect(view.roleName).toBe('구현 팀원');
    expect(view.detail).toBe('git push origin main');
    expect(view.summary.protectedBranch).toBe('main');
  });
});

describe('answerFor — 질문 카드', () => {
  it('고른 방향은 번호와 이유와 "설계까지 이어 가기"를 그대로 전한다', () => {
    expect(answerFor({ kind: 'pick', id: ' b ', reason: ' 락이 단순하다 ', goOn: true })).toEqual({ kind: 'pick', id: 'b', reason: '락이 단순하다', goOn: true });
    expect(answerFor({ kind: 'pick', id: 'a', reason: '', goOn: false })).toEqual({ kind: 'pick', id: 'a' });
  });

  it('직접 쓴 방향은 앞뒤 공백을 떼고 전한다', () => {
    expect(answerFor({ kind: 'custom', text: '  새로 만든다 ', reason: '', goOn: false })).toEqual({ kind: 'custom', text: '새로 만든다' });
  });

  it('비어 있는 방향이나 이유가 너무 긴 글은 도메인 상한 안으로 자르거나 무시한다', () => {
    expect(answerFor({ kind: 'custom', text: '   ', reason: '', goOn: false })).toEqual({ kind: 'ignore' });
    expect(answerFor({ kind: 'pick', id: '', reason: '', goOn: false })).toEqual({ kind: 'ignore' });
    const long = answerFor({ kind: 'custom', text: 'x'.repeat(900), reason: 'y'.repeat(900), goOn: false });
    expect(long.kind === 'custom' && long.text.length).toBe(400);
    expect(long.kind === 'custom' && long.reason?.length).toBe(200);
  });

  it('화면이 이상한 값을 보내도 무시한다', () => {
    expect(answerFor({ kind: 'hack' } as never)).toEqual({ kind: 'ignore' });
    expect(answerFor({ kind: 'pick', id: 5, reason: null, goOn: 'yes' } as never)).toEqual({ kind: 'ignore' });
  });

  it('이대로 고치기와 그만두기를 전한다', () => {
    expect(answerFor({ kind: 'proceed' })).toEqual({ kind: 'proceed' });
    expect(answerFor({ kind: 'stop' })).toEqual({ kind: 'stop' });
  });
});

describe('approvalView — 질문 카드', () => {
  const card = {
    runId: 'r1',
    title: '결제가 왜 두 번 깎여?',
    symptom: '두 번 깎인다',
    options: [
      { id: 'a', title: '멱등 키', summary: 's', pros: ['단순'], cons: [], risk: 'r', reversibility: 'easy' as const, touches: [] },
      { id: 'b', title: '락', summary: 's', pros: [], cons: ['느림'], risk: 'r', reversibility: 'hard' as const, touches: [] },
    ],
    recommendedId: 'a',
    recommendedReason: '쉽다',
    canGoOn: true,
    docPath: 'docs/analysis/a.md',
  };
  const pending = { id: 'p1', jobId: 'j1', at: '2026-11-08T00:00:00.000Z', request: { role: 'debugger' as const, tool: 'rauha:ask', detail: card.title, reason: '고칠 방향을 골라 주세요' } };

  it('방향 카드는 AI 추천을 표시하고 되돌리기를 한글로 바꾼다', () => {
    const view = approvalView({ ...pending, ask: { kind: 'directions', card } });
    expect(view.ask).toMatchObject({ kind: 'directions', canGoOn: true, docPath: 'docs/analysis/a.md' });
    expect(view.ask?.kind === 'directions' && view.ask.options.map((o) => [o.id, o.recommended, o.reversibility])).toEqual([['a', true, '쉬움'], ['b', false, '어려움']]);
    expect(view.summary.headline).toContain('고칠 방향을 골라 주세요');
  });

  it('승인 카드는 목표와 단계를 담는다', () => {
    const view = approvalView({ ...pending, request: { ...pending.request, role: 'designer' }, ask: { kind: 'approval', card: { runId: 'r1', title: '결제', chosen: '멱등 키', goal: '한 번만', steps: [{ number: 1, title: '키' }], risks: ['PG 정책'], docPath: null } } });
    expect(view.ask).toMatchObject({ kind: 'approval', chosen: '멱등 키', goal: '한 번만', steps: [{ number: 1, title: '키' }] });
  });

  it('허락 요청에는 질문 카드 칸이 없다', () => {
    expect(approvalView({ ...pending, request: { role: 'implementer', tool: 'Bash', detail: 'git push', reason: '푸시' }, ask: null }).ask).toBeNull();
  });
});
