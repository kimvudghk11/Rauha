import { describe, expect, it } from 'vitest';
import { Difficulty } from './difficulty.js';
import { RunScope } from './run-scope.js';
import { TestRun } from './test-run.js';
import { WorkOrder } from './work-order.js';

const scope = RunScope.minimalLoop();
const red = TestRun.of({ passed: 0, failed: 1, failureKind: 'assertion' });
const invalid = TestRun.of({ passed: 0, failed: 1, failureKind: 'import' });
const fail = TestRun.of({ passed: 1, failed: 1 });
const green = TestRun.of({ passed: 2, failed: 0 });

function openAtRed(grade: 'S' | 'M' | 'L' = 'S'): WorkOrder {
  const order = WorkOrder.open({ id: 'w', title: 't', difficulty: Difficulty.of(grade), sensitive: false, scope: ['src/**'] });
  order.approveScenario({ happyPaths: 1, errorPaths: 1 });
  return order;
}

describe('RunScope.minimalLoop', () => {
  it('L급은 시니어(sonnet)부터 시작하므로 haiku만 쓰는 1단계에서는 needs-senior로 멈춘다', () => {
    expect(scope.decide(openAtRed('L'))).toEqual({ kind: 'stop', reason: 'needs-senior' });
  });

  it('red 단계 haiku 테스트 팀원과 green 단계 haiku 구현 팀원만 이어서 부른다', () => {
    const order = openAtRed();
    expect(scope.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'tester', tier: 'haiku' } });
    order.recordRed(red);
    expect(scope.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'implementer', tier: 'haiku' } });
  });

  it('review 단계에 닿으면 1단계 완료', () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(green);
    expect(scope.decide(order)).toEqual({ kind: 'complete' });
  });

  it('구현이 sonnet으로 오르면 needs-senior', () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(fail);
    expect(scope.decide(order).kind).toBe('continue');
    order.recordGreen(fail);
    expect(scope.decide(order)).toEqual({ kind: 'stop', reason: 'needs-senior' });
  });

  it('테스트 팀원이 sonnet으로 올라도 needs-senior', () => {
    const order = openAtRed();
    order.recordRed(invalid);
    order.recordRed(invalid);
    expect(scope.decide(order)).toEqual({ kind: 'stop', reason: 'needs-senior' });
  });

  it('시나리오 단계는 1단계에서 다루지 않는다', () => {
    const order = WorkOrder.open({ id: 'w', title: 't', difficulty: Difficulty.of('S'), sensitive: false, scope: ['src/**'] });
    expect(scope.decide(order)).toEqual({ kind: 'stop', reason: 'unsupported-stage' });
  });
});

describe('RunScope.ladder', () => {
  const ladder = RunScope.ladder();

  it('구현 주니어가 두 번 실패하면 sonnet 구현 시니어를 부른다', () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(fail);
    order.recordGreen(fail);
    expect(ladder.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'implementer', tier: 'sonnet' } });
  });

  it('테스트 팀원이 무효 Red를 두 번 내면 sonnet 테스트 팀원을 부른다', () => {
    const order = openAtRed();
    order.recordRed(invalid);
    order.recordRed(invalid);
    expect(ladder.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'tester', tier: 'sonnet' } });
  });

  it('구현 시니어까지 실패하면 디버깅 지원이 필요해 멈춘다', () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(fail);
    order.recordGreen(fail);
    order.recordGreen(fail);
    expect(ladder.decide(order)).toEqual({ kind: 'stop', reason: 'needs-support' });
  });

  it('시니어가 통과시키면 review 단계에서 완료', () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(fail);
    order.recordGreen(fail);
    order.recordGreen(green);
    expect(ladder.decide(order)).toEqual({ kind: 'complete' });
  });

  it('L급도 돌려보내지 않고 시니어(sonnet) 테스트 팀원부터 시작한다', () => {
    expect(ladder.decide(openAtRed('L'))).toEqual({ kind: 'continue', assignment: { role: 'tester', tier: 'sonnet' } });
  });

  it('시니어로 시작한 L급은 주니어 기회를 건너뛴 만큼 시니어가 두 번 시도한 뒤에 멈춘다', () => {
    const order = openAtRed('L');
    order.recordRed(red);
    order.recordGreen(fail);
    expect(ladder.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'implementer', tier: 'sonnet' } });
    order.recordGreen(fail);
    expect(ladder.decide(order)).toEqual({ kind: 'stop', reason: 'needs-support' });
  });
});

describe('RunScope.threePass', () => {
  const three = RunScope.threePass();
  const atReview = () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(green);
    return order;
  };

  it('3단 범위는 검증을 통과하면 리뷰어(sonnet)를 부른다', () => {
    expect(three.decide(atReview())).toEqual({ kind: 'continue', assignment: { role: 'reviewer', tier: 'sonnet' } });
  });

  it('민감한 업무(인증·결제)는 opus 리뷰어를 부른다 (멈추지 않는다)', () => {
    const order = WorkOrder.open({ id: 'w', title: 't', difficulty: Difficulty.of('L'), sensitive: true, scope: ['src/**'] });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    order.recordRed(red);
    order.recordGreen(green);
    expect(three.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'reviewer', tier: 'opus' } });
  });

  it('리뷰가 통과하면 완료', () => {
    const order = atReview();
    order.recordReview('pass');
    expect(three.decide(order)).toEqual({ kind: 'complete' });
  });

  it('리뷰 수정 요청이면 구현 팀원에게 돌아간다', () => {
    const order = atReview();
    order.recordReview('changes');
    expect(three.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'implementer', tier: 'haiku' } });
  });

  it('리뷰 수정 요청이 두 번이어도 멈추지 않고 구현 팀원이 마지막 지적을 고친 뒤 완료한다', () => {
    const order = atReview();
    order.recordReview('changes');
    order.recordGreen(green);
    order.recordReview('changes');
    expect(three.decide(order)).toMatchObject({ kind: 'continue', assignment: { role: 'implementer' } });
    order.recordGreen(green);
    expect(three.decide(order)).toEqual({ kind: 'complete' });
  });

  it('올바른 Red를 세 번 못 만들어도 멈추지 않고 테스트 없이 구현 팀원을 부른다', () => {
    const order = openAtRed();
    for (let i = 0; i < 3; i += 1) order.recordRed(invalid);
    expect(three.decide(order)).toMatchObject({ kind: 'continue', assignment: { role: 'implementer' } });
  });

  it('마지막 시도는 가장 높은 모델(opus) 구현 팀원이 맡는다', () => {
    const order = openAtRed();
    order.recordRed(red);
    while (order.rung !== 'final') {
      if (order.pendingSupport !== null) order.resolveSupport();
      else order.recordGreen(fail);
    }
    expect(three.decide(order)).toEqual({ kind: 'continue', assignment: { role: 'implementer', tier: 'opus' } });
  });

  it('구현 사다리를 다 올라도 실패하면 그 이유(escalation-exhausted)로 알린다', () => {
    const order = openAtRed();
    order.recordRed(red);
    while (!order.isFinished()) {
      if (order.pendingSupport !== null) order.resolveSupport();
      else order.recordGreen(fail);
    }
    expect(three.decide(order)).toEqual({ kind: 'stop', reason: 'escalation-exhausted' });
  });

  it('지원 팀(디버깅·자문)이 아직 없어서 지원 요청이 쌓이면 지원 없이 다시 시도하게 한다', () => {
    const order = openAtRed();
    order.recordRed(red);
    order.recordGreen(fail);
    order.recordGreen(fail);
    order.recordGreen(fail);
    expect(order.pendingSupport).toBe('debugger');
    expect(three.retriesWithoutSupport(order)).toBe(true);
    expect(RunScope.ladder().retriesWithoutSupport(order)).toBe(false);
  });

  it('지원 요청이 없으면 지원 없이 다시 시도할 것도 없다', () => {
    expect(three.retriesWithoutSupport(openAtRed())).toBe(false);
  });
});
