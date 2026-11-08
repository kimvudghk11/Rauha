import { describe, expect, it } from 'vitest';
import { TestRun } from './test-run.js';
import { Verification, type CheckResult } from './verification.js';

const check = (name: CheckResult['name'], status: CheckResult['status'], failures: string[] = []): CheckResult => ({
  name,
  status,
  failures,
  command: status === 'skip' ? null : `run ${name}`,
  summary: status,
});

const lockedPass = check('locked-tests', 'pass');

describe('Verification', () => {
  it('팀원에게 알려 줄 검사 명령은 실제로 있는 검사만 적는다', () => {
    const note = Verification.of([check('tests', 'pass'), check('typecheck', 'fail'), check('lint', 'skip')]).commandsNote();
    expect(note).toBe('- tests: run tests\n- typecheck: run typecheck');
  });

  it('잠긴 테스트가 통과하지 않으면 검증 실패', () => {
    expect(Verification.of([check('locked-tests', 'fail', ['a'])]).judge(null).isPassing()).toBe(false);
    expect(Verification.of([check('locked-tests', 'skip')]).judge(null).isPassing()).toBe(false);
    expect(Verification.of([lockedPass]).judge(null).isPassing()).toBe(true);
  });

  it('기준선에 없던 새 실패만 실패로 친다', () => {
    const baseline = Verification.of([check('tests', 'fail', ['a'])]);
    const worse = Verification.of([lockedPass, check('tests', 'fail', ['a', 'b'])]).judge(baseline);
    const tests = worse.checks.find((c) => c.name === 'tests');
    expect(tests?.newFailures).toEqual(['b']);
    expect(tests?.ok).toBe(false);
    expect(worse.isPassing()).toBe(false);

    const same = Verification.of([lockedPass, check('tests', 'fail', ['a'])]).judge(baseline);
    expect(same.checks.find((c) => c.name === 'tests')?.preexisting).toEqual(['a']);
    expect(same.isPassing()).toBe(true);
  });

  it('기준선이 없으면 모든 실패를 실패로 친다', () => {
    expect(Verification.of([lockedPass, check('typecheck', 'fail', ['a.ts:TS2322'])]).judge(null).isPassing()).toBe(false);
  });

  it('이름을 비교할 수 없는 실패는 기준선이 통과였을 때만 판정에 쓴다', () => {
    const now = Verification.of([lockedPass, check('lint', 'fail')]);
    expect(now.judge(Verification.of([check('lint', 'fail')])).isPassing()).toBe(true);
    expect(now.judge(Verification.of([check('lint', 'pass')])).isPassing()).toBe(false);
  });

  it('건너뛴 검사는 통과로 본다', () => {
    expect(Verification.of([lockedPass, check('lint', 'skip'), check('tests', 'skip')]).judge(null).isPassing()).toBe(true);
  });

  it('검증이 실패하면 잠긴 테스트가 통과했어도 실패한 TestRun을 만든다', () => {
    const locked = TestRun.of({ passed: 3, failed: 0 });
    const ok = Verification.of([lockedPass]).judge(null);
    expect(ok.toTestRun(locked)).toBe(locked);

    const bad = Verification.of([lockedPass, check('typecheck', 'fail', ['src/a.ts:TS2322'])]).judge(null);
    const run = bad.toTestRun(locked);
    expect(run.isGreen()).toBe(false);
    expect(run.failedNames).toContain('typecheck: src/a.ts:TS2322');
    expect(bad.toFailureNote()).toMatch(/typecheck/);
  });
});

describe('Verification.lockedTests', () => {
  it('잠긴 테스트 실행 결과를 검사 결과로 바꾼다', () => {
    expect(Verification.lockedTests(TestRun.of({ passed: 4, failed: 0 }), 'npx vitest run a')).toEqual({
      name: 'locked-tests',
      status: 'pass',
      failures: [],
      command: 'npx vitest run a',
      summary: '통과 4 / 실패 0',
    });
    expect(Verification.lockedTests(TestRun.of({ passed: 1, failed: 1, failedNames: ['x'] }), 'c').status).toBe('fail');
  });
});

describe('VerificationVerdict.failureDetail', () => {
  it('실패한 검사의 실제 메시지를 다음 시도에 넘길 만큼만 모은다', () => {
    const verdict = Verification.of([
      { name: 'locked-tests', status: 'fail', failures: ['a'], command: 'c', summary: '실패 1', detail: 'a: expected 899 to be 900\n  at money.spec.ts:12' },
      { name: 'typecheck', status: 'fail', failures: ['src/money.ts:TS2322'], command: 'tsc', summary: '타입 에러 1개', detail: "src/money.ts(3,7): error TS2322: Type 'string' is not assignable" },
      { name: 'tests', status: 'pass', failures: [], command: 't', summary: '통과', detail: 'should not appear' },
    ]).judge(null);
    const detail = verdict.failureDetail(12);
    expect(detail).toContain('[locked-tests] a: expected 899 to be 900');
    expect(detail).toContain('[typecheck] src/money.ts(3,7): error TS2322');
    expect(detail).not.toContain('should not appear');
    expect(verdict.failureDetail(2).split('\n')).toHaveLength(2);
  });
});

describe('VerificationVerdict.needsFullConfirmation', () => {
  const passing = () => Verification.of([check('locked-tests', 'pass'), check('tests', 'pass')]).judge(null);

  it('좁혀 돌린 검사가 통과하면 리뷰 직전에 전체 검사를 한 번 더 돌려야 한다', () => {
    expect(passing().needsFullConfirmation(true)).toBe(true);
  });

  it('전체로 돌린 검사가 통과하면 더 돌릴 필요가 없다', () => {
    expect(passing().needsFullConfirmation(false)).toBe(false);
  });

  it('좁혀 돌린 검사가 실패하면 전체 검사 없이 바로 고치러 돌아간다', () => {
    const failing = Verification.of([check('locked-tests', 'pass'), check('tests', 'fail', ['x'])]).judge(null);
    expect(failing.needsFullConfirmation(true)).toBe(false);
  });
});
