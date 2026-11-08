import { describe, expect, it } from 'vitest';
import { SessionBudget } from '../../orchestration/domain/session-budget.js';
import { DomainError } from '../../shared/domain-error.js';
import { AnalysisReach } from './analysis-reach.js';
import { AnalysisRun } from './analysis-run.js';
import { Blueprint } from './blueprint.js';
import { DirectionSet } from './direction.js';
import { Investigation } from './investigation.js';

const investigation = (paths: string[] = ['packages/api/src/pay/retry.ts:42']) =>
  Investigation.of({ symptom: '두 번 깎인다', facts: paths.map((p, i) => ({ text: `사실 ${i}`, evidence: p })), causes: [], unknowns: [] });

const directions = () =>
  DirectionSet.of(
    [
      { id: 'a', title: '멱등 키', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'easy', touches: [] },
      { id: 'b', title: '락', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'medium', touches: [] },
    ],
    'a',
    '되돌리기 쉽다',
  );

const blueprint = () =>
  Blueprint.of({
    goal: '한 번만 결제',
    nonGoals: [],
    changes: [{ where: 'packages/api/src/pay', what: '키' }],
    flow: [],
    edgeCases: [],
    rejected: [],
    testStrategy: 't',
    steps: [{ title: '키', testFirst: '두 번 요청해도 한 번', files: ['a.ts'], verify: 'yarn test' }],
    risks: [],
  });

const start = (reach: 'investigate' | 'compare' | 'plan' = 'plan') => AnalysisRun.start({ id: 'run-1', request: '결제가 왜 두 번 깎여?', reach: AnalysisReach.of(reach, ''), date: '2026-11-08' });

describe('AnalysisRun', () => {
  it('조사 → 방향 비교 → 고르기 → 설계·계획 → 승인 → 구현 순서로 다음 할 일을 알려 준다', () => {
    const run = start();
    expect(run.next()).toBe('investigate');
    run.recordInvestigation(investigation());
    expect(run.next()).toBe('compare');
    run.offerDirections(directions());
    expect(run.next()).toBe('choose');
    run.choose({ kind: 'pick', id: 'a' });
    expect(run.next()).toBe('blueprint');
    run.recordBlueprint(blueprint());
    expect(run.next()).toBe('approve');
    run.approve();
    expect(run.next()).toBe('implement');
    run.markImplemented();
    expect(run.next()).toBe('done');
  });

  it('범위가 조사까지면 조사 뒤에 끝난다', () => {
    const run = start('investigate');
    run.recordInvestigation(investigation());
    expect(run.next()).toBe('done');
  });

  it('범위가 방향 비교까지면 고른 뒤에 끝나고, 사용자가 이어 가자고 하면 설계로 간다', () => {
    const stays = start('compare');
    stays.recordInvestigation(investigation());
    stays.offerDirections(directions());
    stays.choose({ kind: 'pick', id: 'a' });
    expect(stays.next()).toBe('done');

    const goes = start('compare');
    goes.recordInvestigation(investigation());
    goes.offerDirections(directions());
    goes.choose({ kind: 'pick', id: 'b', goOn: true });
    expect(goes.next()).toBe('blueprint');
  });

  it('순서를 건너뛰는 호출은 거절한다', () => {
    const run = start();
    expect(() => run.offerDirections(directions())).toThrow(DomainError);
    expect(() => run.approve()).toThrow(DomainError);
    expect(() => run.recordBlueprint(blueprint())).toThrow(DomainError);
    run.recordInvestigation(investigation());
    expect(() => run.recordInvestigation(investigation())).toThrow(DomainError);
    expect(() => run.choose({ kind: 'pick', id: 'a' })).toThrow(DomainError);
  });

  it('고른 결과가 기록 탭에 넘길 선택으로 남는다', () => {
    const run = start();
    run.recordInvestigation(investigation());
    run.offerDirections(directions());
    const choice = run.choose({ kind: 'pick', id: 'b', reason: '락이 더 단순하다' });
    expect(run.choice).toBe(choice);
    expect(choice.divergedFromAi()).toBe(true);
  });

  it('고칠 점을 말하면 설계·계획을 다시 쓰게 하고, 세 번을 넘으면 멈춘다', () => {
    const run = start();
    run.recordInvestigation(investigation());
    run.offerDirections(directions());
    run.choose({ kind: 'pick', id: 'a' });
    for (let i = 1; i <= 3; i += 1) {
      run.recordBlueprint(blueprint());
      run.reviseBlueprint(`고칠 점 ${i}`);
      expect(run.next()).toBe('blueprint');
      expect(run.revisionNote).toBe(`고칠 점 ${i}`);
    }
    run.recordBlueprint(blueprint());
    run.reviseBlueprint('또 고쳐 줘');
    expect(run.next()).toBe('done');
    expect(run.stopped?.reason).toBe('revisions');
  });

  it('멈추면 이유가 남고 더 할 일이 없다', () => {
    const run = start();
    run.recordInvestigation(investigation());
    run.stop('timeout');
    expect(run.next()).toBe('done');
    expect(run.stopped?.reason).toBe('timeout');
    expect(run.stopNote()).toContain('기다');
  });

  it('이미 멈춘 분석은 이유를 덮어쓰지 않는다', () => {
    const run = start();
    run.stop('blocked', '한도에 걸렸어요');
    run.stop('user');
    expect(run.stopped?.reason).toBe('blocked');
  });

  it('사용자를 기다리던 사이 한도가 90%를 넘었으면 다음 단계로 가지 않고 멈춘다', () => {
    const run = start();
    run.recordInvestigation(investigation());
    run.offerDirections(directions());
    run.choose({ kind: 'pick', id: 'a' });
    expect(run.pauseIfTight(SessionBudget.fromWindows([{ percent: 80, resetsAt: null }]))).toBe(false);
    expect(run.pauseIfTight(SessionBudget.fromWindows([{ percent: 93, resetsAt: '2026-11-08T12:00:00Z' }]))).toBe(true);
    expect(run.stopped?.reason).toBe('budget');
    expect(run.next()).toBe('done');
  });

  it('설계 모델은 기본 sonnet이고, 영역이 셋 이상이거나 여러 저장소이거나 기능 요청이면 opus로 올린다', () => {
    const small = start();
    small.recordInvestigation(investigation());
    expect(small.designTier({ routedFeature: false, repos: 1, budget: SessionBudget.ample() })).toBe('sonnet');
    expect(small.designTier({ routedFeature: true, repos: 1, budget: SessionBudget.ample() })).toBe('opus');
    expect(small.designTier({ routedFeature: false, repos: 2, budget: SessionBudget.ample() })).toBe('opus');

    const wide = start();
    wide.recordInvestigation(investigation(['packages/a/src/x.ts', 'packages/b/src/y.ts', 'docs/z.md']));
    expect(wide.designTier({ routedFeature: false, repos: 1, budget: SessionBudget.ample() })).toBe('opus');
  });

  it('한도가 빠듯하면(70% 이상) 큰 변경이어도 opus로 올리지 않는다', () => {
    const run = start();
    run.recordInvestigation(investigation(['packages/a/x.ts', 'packages/b/y.ts', 'docs/z.md']));
    expect(run.designTier({ routedFeature: true, repos: 3, budget: SessionBudget.fromWindows([{ percent: 72, resetsAt: null }]) })).toBe('sonnet');
  });
});
