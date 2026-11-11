import { DomainError } from '../../shared/domain-error.js';

/**
 * 실패 원인. Red 단계에서는 assertion 실패만 "올바른 이유로 실패"로 인정한다.
 * compile / import 실패는 테스트가 아직 제대로 쓰이지 않았다는 뜻이다.
 */
export type FailureKind = 'assertion' | 'compile' | 'import' | 'timeout' | 'no-runner';

/** 테스트 실행 결과 값 객체. 판정은 모델이 아니라 이 객체의 메서드가 한다. */
export class TestRun {
  private constructor(
    readonly passed: number,
    readonly failed: number,
    readonly failureKind: FailureKind | null,
    readonly failedNames: readonly string[],
  ) {}

  static of(props: {
    passed: number;
    failed: number;
    failureKind?: FailureKind | null;
    failedNames?: readonly string[];
  }): TestRun {
    const { passed, failed } = props;
    if (![passed, failed].every((n) => Number.isInteger(n) && n >= 0)) {
      throw new DomainError('INVALID_TEST_RUN', '통과·실패 수는 0 이상의 정수여야 합니다.');
    }
    const failureKind = failed > 0 ? (props.failureKind ?? 'assertion') : null;
    return new TestRun(passed, failed, failureKind, [...(props.failedNames ?? [])]);
  }

  isGreen(): boolean {
    return this.failed === 0 && this.passed > 0;
  }

  /** 이 프로젝트에서 테스트를 실행할 방법 자체가 없어서(test 스크립트·실행 파일 없음) 못 돌린 것인지. 테스트를 아무리 고쳐도 해결되지 않는다. */
  cannotRun(): boolean {
    return this.failureKind === 'no-runner';
  }

  /** 올바른 Red가 아니면 테스트 팀원에게 다시 맡길 때 붙일 설명. 올바른 Red면 null. */
  redProblem(): string | null {
    if (this.isValidRed()) return null;
    if (this.failed === 0 && this.passed === 0) return '실행된 테스트가 없습니다. 테스트 파일이 실제로 테스트를 담고 있는지 확인하세요.';
    if (this.cannotRun()) return '이 프로젝트에서는 테스트를 실행할 방법이 없습니다(test 스크립트나 테스트 도구가 없음).';
    if (this.failed === 0) return '테스트가 모두 통과했습니다. 아직 없는 동작을 검사해야 Red가 됩니다(구현까지 하지 마세요).';
    return `assertion이 아닌 이유(${this.failureKind})로 실패했습니다. 테스트가 로드·실행되도록 고치세요.`;
  }

  /** 테스트가 실행은 됐고, 기대값이 달라서 실패했는지. */
  isValidRed(): boolean {
    return this.failed > 0 && this.failureKind === 'assertion';
  }
}
