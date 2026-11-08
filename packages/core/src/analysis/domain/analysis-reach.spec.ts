import { describe, expect, it } from 'vitest';
import { SessionBudget } from '../../orchestration/domain/session-budget.js';
import { AnalysisReach } from './analysis-reach.js';

describe('AnalysisReach', () => {
  it('분석·원인·비교 낱말이 있는 요청만 분석 흐름 대상이다', () => {
    expect(AnalysisReach.requested('결제가 왜 두 번 깎여?')).toBe(true);
    expect(AnalysisReach.requested('이 에러 원인 분석해줘')).toBe(true);
    expect(AnalysisReach.requested('캐시를 어떻게 고치는 게 좋을지 방향 비교해줘')).toBe(true);
    expect(AnalysisReach.requested('이 변경 위험한 거 없는지 점검해줘')).toBe(true);
  });

  it('낱말 없이 고치라고만 한 단순 수정 요청은 분석 흐름 대상이 아니다', () => {
    expect(AnalysisReach.requested('Money.add가 빼기를 해, 고쳐줘')).toBe(false);
    expect(AnalysisReach.requested('오타 고쳐줘')).toBe(false);
    expect(AnalysisReach.requested('이 함수에 null 체크 추가해줘')).toBe(false);
    expect(AnalysisReach.requested('안녕')).toBe(false);
  });

  it('라우터가 범위를 정했으면 그것을 따른다', () => {
    expect(AnalysisReach.of('compare', '결제가 왜 두 번 깎여?').value).toBe('compare');
    expect(AnalysisReach.of('plan', '원인이 뭐야').value).toBe('plan');
  });

  it('라우터 값이 없거나 이상하면 요청 글에서 어림한다', () => {
    expect(AnalysisReach.of(null, '결제가 왜 두 번 깎여?').value).toBe('investigate');
    expect(AnalysisReach.of('엉뚱', '어떻게 고치는 게 좋을까?').value).toBe('compare');
    expect(AnalysisReach.of(undefined, '분석하고 나서 고치는 계획까지 짜줘').value).toBe('plan');
  });

  it('더 먼 단계는 가까운 단계를 포함한다', () => {
    const plan = AnalysisReach.of('plan', 'x');
    expect(plan.includes('investigate') && plan.includes('compare') && plan.includes('plan')).toBe(true);
    const compare = AnalysisReach.of('compare', 'x');
    expect(compare.includes('compare')).toBe(true);
    expect(compare.includes('plan')).toBe(false);
  });

  it('한도가 90%를 넘으면 조사까지만 한다', () => {
    const tight = SessionBudget.fromWindows([{ percent: 95, resetsAt: null }]);
    expect(AnalysisReach.of('plan', 'x').limitedBy(tight).value).toBe('investigate');
  });

  it('한도가 넉넉하거나 70%대면 범위를 줄이지 않는다', () => {
    expect(AnalysisReach.of('plan', 'x').limitedBy(SessionBudget.ample()).value).toBe('plan');
    expect(AnalysisReach.of('plan', 'x').limitedBy(SessionBudget.fromWindows([{ percent: 75, resetsAt: null }])).value).toBe('plan');
  });

  it('조사까지만 하던 것을 사용자가 설계까지 늘릴 수 있고, 줄어들지는 않는다', () => {
    expect(AnalysisReach.of('compare', 'x').extendedTo('plan').value).toBe('plan');
    expect(AnalysisReach.of('plan', 'x').extendedTo('compare').value).toBe('plan');
  });
});
