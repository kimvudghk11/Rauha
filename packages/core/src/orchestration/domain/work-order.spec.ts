import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { Difficulty } from './difficulty.js';
import { TestRun } from './test-run.js';
import { WorkOrder } from './work-order.js';

const red = TestRun.of({ passed: 0, failed: 1, failureKind: 'assertion' });
const green = TestRun.of({ passed: 3, failed: 0 });
const fail = TestRun.of({ passed: 2, failed: 1 });

function openAtGreen(grade: 'S' | 'M' | 'L' = 'M', sensitive = false): WorkOrder {
  const order = WorkOrder.open({
    id: 'wo-1',
    title: '로그인 실패 제한',
    difficulty: Difficulty.of(grade),
    sensitive,
    scope: ['src/auth/**'],
  });
  order.approveScenario({ happyPaths: 1, errorPaths: 1 });
  if (order.stage === 'design') order.completeDesign();
  order.recordRed(red);
  return order;
}

describe('WorkOrder 파이프라인', () => {
  it('S·M급은 시나리오 → Red로 바로 간다', () => {
    const order = WorkOrder.open({
      id: 'wo-1',
      title: 't',
      difficulty: Difficulty.of('S'),
      sensitive: false,
      scope: ['src/**'],
    });
    expect(order.nextAssignment()).toEqual({ role: 'planner', tier: 'haiku' });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    expect(order.stage).toBe('red');
  });

  it('L급은 시나리오 확정 뒤 설계 단계가 생기기 전까지 바로 시니어 테스트 팀원에게 간다', () => {
    const order = WorkOrder.open({
      id: 'wo-1',
      title: 't',
      difficulty: Difficulty.of('L'),
      sensitive: false,
      scope: ['src/**'],
    });
    expect(order.nextAssignment()).toEqual({ role: 'planner', tier: 'sonnet' });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    expect(order.stage).toBe('red');
    expect(order.nextAssignment()).toEqual({ role: 'tester', tier: 'sonnet' });
  });

  it('무효 Red가 세 번 쌓이면(주니어 두 번 + 시니어 한 번) 멈추지 않고 테스트 없이 구현으로 간다', () => {
    const order = WorkOrder.open({ id: 'w', title: 't', difficulty: Difficulty.of('S'), sensitive: false, scope: ['src/**'] });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    const invalid = TestRun.of({ passed: 0, failed: 1, failureKind: 'import' });
    for (let i = 0; i < 2; i += 1) order.recordRed(invalid);
    expect(order.stage).toBe('red');
    expect(order.testsWaived).toBe(false);
    order.recordRed(invalid);
    expect(order.stage).toBe('green');
    expect(order.haltReason).toBeNull();
    expect(order.testsLocked).toBe(false);
    expect(order.testsWaived).toBe(true);
    expect(order.nextAssignment()).toEqual({ role: 'implementer', tier: 'haiku' });
  });

  it('예외 경로가 없는 시나리오는 넘기지 않는다', () => {
    const order = WorkOrder.open({
      id: 'wo-1',
      title: 't',
      difficulty: Difficulty.of('S'),
      sensitive: false,
      scope: ['src/**'],
    });
    expect(() => order.approveScenario({ happyPaths: 2, errorPaths: 0 })).toThrow(DomainError);
  });

  it('시나리오를 2번 반려하면 기획이 시니어로 바뀐다', () => {
    const order = WorkOrder.open({
      id: 'wo-1',
      title: 't',
      difficulty: Difficulty.of('S'),
      sensitive: false,
      scope: ['src/**'],
    });
    order.rejectScenario();
    order.rejectScenario();
    expect(order.nextAssignment()).toEqual({ role: 'planner', tier: 'sonnet' });
  });

  it('import 실패는 Red로 인정하지 않고, 2번 반복되면 테스트 팀이 시니어로 바뀐다', () => {
    const order = WorkOrder.open({
      id: 'wo-1',
      title: 't',
      difficulty: Difficulty.of('S'),
      sensitive: false,
      scope: ['src/**'],
    });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    const broken = TestRun.of({ passed: 0, failed: 1, failureKind: 'import' });
    order.recordRed(broken);
    order.recordRed(broken);
    expect(order.stage).toBe('red');
    expect(order.testsLocked).toBe(false);
    expect(order.nextAssignment()).toEqual({ role: 'tester', tier: 'sonnet' });
  });

  it('올바른 Red 뒤에는 테스트가 잠기고 주니어 구현으로 간다', () => {
    const order = openAtGreen();
    expect(order.testsLocked).toBe(true);
    expect(order.nextAssignment()).toEqual({ role: 'implementer', tier: 'haiku' });
  });

  it('테스트가 통과하면 리뷰 → 문서 → 완료', () => {
    const order = openAtGreen();
    order.recordGreen(green);
    expect(order.nextAssignment()).toEqual({ role: 'reviewer', tier: 'sonnet' });
    order.recordReview('pass');
    expect(order.nextAssignment()).toEqual({ role: 'writer', tier: 'haiku' });
    order.completeDocs();
    expect(order.stage).toBe('done');
    expect(order.nextAssignment()).toBeNull();
  });

  it('민감 작업의 리뷰는 Opus가 맡는다', () => {
    const order = openAtGreen('L', true);
    order.recordGreen(green);
    expect(order.nextAssignment()).toEqual({ role: 'reviewer', tier: 'opus' });
  });
});

describe('WorkOrder 승격 여부', () => {
  it('주니어 단계는 승격되지 않은 업무, 시니어 단계부터 승격된 업무다', () => {
    const order = openAtGreen('S');
    expect(order.isEscalated()).toBe(false);
    order.recordGreen(fail);
    order.recordGreen(fail);
    expect(order.isEscalated()).toBe(true);
  });
});

describe('WorkOrder 테스트 없이 진행', () => {
  it('테스트를 실행할 수 없는 프로젝트면 Red를 건너뛰고 구현으로 가며 테스트는 잠기지 않는다', () => {
    const order = WorkOrder.open({ id: 'w', title: 't', difficulty: Difficulty.of('S'), sensitive: false, scope: ['src/**'] });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    order.proceedWithoutTests();
    expect(order.stage).toBe('green');
    expect(order.testsLocked).toBe(false);
    expect(order.nextAssignment()).toEqual({ role: 'implementer', tier: 'haiku' });
  });

  it('Red 단계가 아니면 테스트 없이 진행할 수 없다', () => {
    const order = openAtGreen();
    expect(() => order.proceedWithoutTests()).toThrow(DomainError);
  });
});

describe('WorkOrder 승격 사다리', () => {
  it('주니어 2회 실패 → 시니어 → 디버깅 → 설계 자문 → 가장 높은 모델로 마지막 한 번 → 그래도 실패하면 중단', () => {
    const order = openAtGreen();

    order.recordGreen(fail, '첫 시도: 잠금 시간 계산 누락');
    expect(order.rung).toBe('junior');
    order.recordGreen(fail, '두 번째: 카운터 초기화 위치 오류');
    expect(order.nextAssignment()).toEqual({ role: 'implementer', tier: 'sonnet' });

    order.recordGreen(fail);
    expect(order.nextAssignment()).toEqual({ role: 'debugger', tier: 'sonnet' });
    expect(() => order.recordGreen(green)).toThrow(DomainError);
    order.resolveSupport();
    expect(order.rung).toBe('senior-after-debug');

    order.recordGreen(fail);
    expect(order.nextAssignment()).toEqual({ role: 'architect', tier: 'opus' });
    order.resolveSupport();
    expect(order.nextAssignment()).toEqual({ role: 'implementer', tier: 'sonnet' });

    order.recordGreen(fail);
    expect(order.stage).toBe('green');
    expect(order.rung).toBe('final');
    expect(order.nextAssignment()).toEqual({ role: 'implementer', tier: 'opus' });

    order.recordGreen(fail);
    expect(order.stage).toBe('halted');
    expect(order.haltReason).toBe('escalation-exhausted');
  });

  it('마지막 시도에서 테스트가 통과하면 리뷰로 간다', () => {
    const order = openAtGreen();
    for (let i = 0; i < 5; i += 1) {
      if (order.pendingSupport) order.resolveSupport();
      order.recordGreen(fail);
    }
    if (order.pendingSupport) order.resolveSupport();
    expect(order.rung).toBe('final');
    order.recordGreen(green);
    expect(order.stage).toBe('review');
  });

  it('승격 시 넘기는 실패 요약은 최근 5줄까지만', () => {
    const order = openAtGreen();
    for (let i = 1; i <= 7; i += 1) {
      if (order.pendingSupport) order.resolveSupport();
      if (order.isFinished()) break;
      order.recordGreen(fail, `시도 ${i}`);
    }
    expect(order.handoffNote().split('\n').length).toBeLessThanOrEqual(5);
  });

  it('승격 중 어느 단계에서든 테스트가 통과하면 리뷰로 간다', () => {
    const order = openAtGreen();
    order.recordGreen(fail);
    order.recordGreen(fail);
    order.recordGreen(green);
    expect(order.stage).toBe('review');
  });

  it('리뷰 수정 요청이 2번이면 멈추지 않고, 마지막 지적을 한 번 더 고친 뒤 다시 리뷰하지 않고 마친다', () => {
    const order = openAtGreen();
    order.recordGreen(green);
    order.recordReview('changes');
    expect(order.stage).toBe('green');
    expect(order.reviewWaived).toBe(false);
    order.recordGreen(green);
    order.recordReview('changes');
    expect(order.stage).toBe('green');
    expect(order.haltReason).toBeNull();
    expect(order.reviewWaived).toBe(true);
    order.recordGreen(green);
    expect(order.stage).toBe('docs');
  });

  it('리뷰를 건너뛰기로 한 뒤에도 구현이 실패하면 사다리대로 다시 시도한다', () => {
    const order = openAtGreen();
    order.recordGreen(green);
    order.recordReview('changes');
    order.recordGreen(green);
    order.recordReview('changes');
    order.recordGreen(fail);
    expect(order.stage).toBe('green');
  });
});

describe('WorkOrder 쓰기 권한', () => {
  it('구현 팀은 잠긴 테스트를 바꿀 수 없다', () => {
    const order = openAtGreen();
    expect(() => order.assertDiffAllowed('implementer', ['src/auth/login.ts', 'src/auth/login.spec.ts'])).toThrow(
      /login\.spec\.ts/,
    );
  });

  it('구현 팀은 필요하면 지시서 범위 밖 소스도 바꿀 수 있고, 범위 밖으로 나간 파일은 따로 알 수 있다', () => {
    const order = openAtGreen();
    expect(() => order.assertDiffAllowed('implementer', ['src/billing/pay.ts'])).not.toThrow();
    expect(() => order.assertDiffAllowed('implementer', ['src/auth/login.ts'])).not.toThrow();
    expect(order.allowsWrite('implementer', 'src/billing/pay.ts')).toBe(true);
    expect(order.outOfScope(['src/auth/login.ts', 'src/billing/pay.ts', 'src\\billing\\x.ts'])).toEqual(['src/billing/pay.ts', 'src\\billing\\x.ts']);
  });

  it('테스트 없이 진행하는 업무에서는 구현 팀이 테스트 파일도 고칠 수 있다', () => {
    const order = WorkOrder.open({ id: 'w', title: 't', difficulty: Difficulty.of('S'), sensitive: false, scope: ['src/**'] });
    order.approveScenario({ happyPaths: 1, errorPaths: 1 });
    order.proceedWithoutTests();
    expect(order.allowsWrite('implementer', 'src/a.spec.ts')).toBe(true);
    expect(() => order.assertDiffAllowed('implementer', ['tests/a.test.ts'])).not.toThrow();
  });

  it('테스트가 잠긴 뒤에는 테스트 팀도 테스트를 바꿀 수 없다', () => {
    const order = openAtGreen();
    expect(() => order.assertDiffAllowed('tester', ['tests/login.spec.ts'])).toThrow(DomainError);
  });

  it('Windows 경로도 같은 규칙으로 검사한다', () => {
    const order = openAtGreen();
    expect(() => order.assertDiffAllowed('implementer', ['src\\auth\\login.ts'])).not.toThrow();
    expect(() => order.assertDiffAllowed('implementer', ['tests\\login.spec.ts'])).toThrow(DomainError);
  });
});

describe('WorkOrder 쓰기 권한 미리 묻기', () => {
  it('팀원이 쓰기 전에 그 경로를 쓸 수 있는지 묻는다', () => {
    const order = openAtGreen();
    expect(order.allowsWrite('implementer', 'src/auth/login.ts')).toBe(true);
    expect(order.allowsWrite('implementer', 'src/auth/login.spec.ts')).toBe(false);
    expect(order.allowsWrite('tester', 'src/auth/login.spec.ts')).toBe(false);
  });
});
