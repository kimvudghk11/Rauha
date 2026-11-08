import { TestRun } from './test-run.js';

export type CheckName = 'locked-tests' | 'tests' | 'typecheck' | 'lint';
export type CheckStatus = 'pass' | 'fail' | 'skip';

/** 검사 명령 하나의 결과. failures는 비교할 수 있는 실패 식별자(테스트 이름, 파일:코드). */
export interface CheckResult {
  readonly name: CheckName;
  readonly status: CheckStatus;
  readonly failures: readonly string[];
  readonly command: string | null;
  readonly summary: string;
  /** 실패했을 때의 실제 메시지(앞부분). 다음 시도에 넘긴다. */
  readonly detail?: string;
}

export interface CheckVerdict extends CheckResult {
  readonly ok: boolean;
  readonly newFailures: readonly string[];
  readonly preexisting: readonly string[];
}

/** 검증 묶음 결과 값 객체. 판정은 모델이 아니라 이 객체가 한다. */
export class Verification {
  private constructor(private readonly checks: readonly CheckResult[]) {}

  static of(results: readonly CheckResult[]): Verification {
    return new Verification([...results]);
  }

  /** 잠긴 테스트 실행 결과 → 검사 결과. 잠긴 테스트는 전부 통과해야만 pass다. */
  static lockedTests(run: TestRun, command: string, detail?: string): CheckResult {
    return {
      name: 'locked-tests',
      status: run.isGreen() ? 'pass' : 'fail',
      failures: [...run.failedNames],
      command,
      summary: `통과 ${run.passed} / 실패 ${run.failed}`,
      ...(detail !== undefined && detail !== '' ? { detail } : {}),
    };
  }

  get results(): readonly CheckResult[] {
    return this.checks;
  }

  /** 이 프로젝트에 실제로 있는 검사 명령 목록. 팀원이 package.json을 뒤져 찾는 턴을 없앤다. */
  commandsNote(): string {
    return this.checks
      .filter((c) => c.command !== null)
      .map((c) => `- ${c.name}: ${c.command}`)
      .join('\n');
  }

  /** 기준선(작업 시작 전 결과)과 비교해서 새로 생긴 실패만 실패로 친다. */
  judge(baseline: Verification | null): VerificationVerdict {
    return VerificationVerdict.of(this.checks.map((check) => judgeCheck(check, baseline?.find(check.name) ?? null)));
  }

  private find(name: CheckName): CheckResult | null {
    return this.checks.find((c) => c.name === name) ?? null;
  }
}

function judgeCheck(check: CheckResult, base: CheckResult | null): CheckVerdict {
  const verdict = (ok: boolean, newFailures: readonly string[], preexisting: readonly string[]): CheckVerdict => ({
    ...check,
    ok,
    newFailures,
    preexisting,
  });
  if (check.name === 'locked-tests') return verdict(check.status === 'pass', check.failures, []);
  if (check.status !== 'fail') return verdict(true, [], []);
  if (base === null || base.status !== 'fail') return verdict(false, check.failures, []);
  // 이름을 비교할 수 없는 실패(린트 출력 등)는 기준선도 실패였으면 판정에서 뺀다.
  if (check.failures.length === 0) return verdict(true, [], []);
  const before = new Set(base.failures);
  const fresh = check.failures.filter((f) => !before.has(f));
  return verdict(fresh.length === 0, fresh, check.failures.filter((f) => before.has(f)));
}

export class VerificationVerdict {
  private constructor(readonly checks: readonly CheckVerdict[]) {}

  static of(checks: readonly CheckVerdict[]): VerificationVerdict {
    return new VerificationVerdict([...checks]);
  }

  isPassing(): boolean {
    return this.checks.length > 0 && this.checks.every((c) => c.ok);
  }

  /** 좁혀서(바뀐 곳 관련만) 돌린 검사가 통과했으면, 리뷰로 넘어가기 전에 전체 검사로 한 번 확인해야 한다. */
  needsFullConfirmation(narrowed: boolean): boolean {
    return narrowed && this.isPassing();
  }

  /** 상태 머신의 recordGreen에 넘길 TestRun. 잠긴 테스트가 통과해도 검증이 실패하면 실패다. */
  toTestRun(locked: TestRun): TestRun {
    if (this.isPassing()) return locked;
    const extra = this.failed().flatMap((c) =>
      c.name === 'locked-tests' ? [] : c.newFailures.length > 0 ? c.newFailures.map((f) => `${c.name}: ${f}`) : [`${c.name}: 실패`],
    );
    return TestRun.of({
      passed: locked.passed,
      failed: Math.max(locked.failed, 1),
      failedNames: [...locked.failedNames, ...extra],
    });
  }

  /** 다음 시도에 넘길 한 줄 요약. */
  toFailureNote(): string {
    const parts = this.failed().map((c) => {
      const names = c.newFailures.length > 0 ? c.newFailures.slice(0, 3).join(', ') : c.summary;
      return `${c.name} 실패: ${names}`;
    });
    return parts.length > 0 ? parts.join(' / ') : '검증 통과';
  }

  /** 실패한 검사의 실제 메시지. 이름만으로는 다음 시도가 원인을 알 수 없어서 넘긴다. */
  failureDetail(maxLines = 12): string {
    return this.failed()
      .flatMap((c) =>
        (c.detail ?? c.summary)
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => l.trim() !== '')
          .map((l) => `[${c.name}] ${l.trim()}`),
      )
      .slice(0, maxLines)
      .join('\n');
  }

  private failed(): CheckVerdict[] {
    return this.checks.filter((c) => !c.ok);
  }
}
