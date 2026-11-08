import type { TurnOutcome } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { describeOutcome } from './describe-outcome.js';

const work = (over: Record<string, unknown> = {}): TurnOutcome =>
  ({
    kind: 'work',
    outcome: {
      status: 'complete',
      title: '결제 타임아웃 고침',
      guide: { stopMessage: () => null },
      changedInRun: [{ path: 'src/pay.ts', kind: 'modified' }],
      assumptions: [{ question: '시간 단위', chosen: '초', confirmed: false }],
      facts: { unconfirmed: [{ text: '재시도 횟수는 확인 못 함' }] },
      costUsd: 1.23,
      ...over,
    },
  }) as unknown as TurnOutcome;

describe('describeOutcome', () => {
  it('끝난 작업은 제목, 고친 파일, 알아서 정한 것, 확인이 필요한 것을 쓴다', () => {
    const text = describeOutcome(work());
    expect(text).toContain('끝냈어요: 결제 타임아웃 고침');
    expect(text).toContain('src/pay.ts');
    expect(text).toContain('시간 단위 → 초');
    expect(text).toContain('재시도 횟수는 확인 못 함');
  });

  it('돈(달러)은 보이지 않는다', () => {
    expect(describeOutcome(work())).not.toMatch(/\$|1\.23/);
  });

  it('멈춘 작업은 멈춘 이유를 알린다', () => {
    const text = describeOutcome(work({ status: 'stopped', guide: { stopMessage: () => '로그인이 필요해요' } }));
    expect(text).toContain('멈췄어요');
    expect(text).toContain('로그인이 필요해요');
  });

  it('답은 답 글만 돌려준다', () => {
    expect(describeOutcome({ kind: 'answer', answer: ' 네, 맞아요 ', checked: [], costUsd: 0.5, durationMs: 1, basis: null })).toBe('네, 맞아요');
  });

  it('분석은 요약을 그대로 보이고, 승인해서 구현했으면 그 작업 결과를 이어 붙인다', () => {
    const analysis = { kind: 'analysis', title: 't', path: 'docs/analysis/a.md', summary: '분석: 결제\n문서: docs/analysis/a.md', stopped: false, choice: null, durationMs: 1 } as const;
    expect(describeOutcome({ ...analysis, implemented: null })).toBe('분석: 결제\n문서: docs/analysis/a.md');
    const worked = work();
    const text = describeOutcome({ ...analysis, implemented: worked.kind === 'work' ? worked.outcome : null });
    expect(text).toContain('문서: docs/analysis/a.md');
    expect(text).toContain('끝냈어요: 결제 타임아웃 고침');
  });

  it('계정 문제로 막히면 그 안내를 그대로 쓴다', () => {
    expect(describeOutcome({ kind: 'blocked', reason: 'login', message: '로그인해 주세요' })).toBe('로그인해 주세요');
  });
});
