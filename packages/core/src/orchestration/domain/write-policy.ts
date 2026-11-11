import { DomainError } from '../../shared/domain-error.js';
import { matchesPattern, toPosixPath } from '../../shared/path-pattern.js';
import type { TeamRole } from './team.js';

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * 역할별 쓰기 권한. 설계서의 팀별 「권한」 행을 코드로 옮겼다.
 * 경로는 저장소 루트 기준 상대 경로다.
 */
export class WritePolicy {
  private constructor(private readonly scope: readonly string[]) {}

  /** scope: 업무 지시서의 「범위」. 구현·리뷰 팀은 이 안에서만 쓸 수 있다. */
  static forScope(scope: readonly string[]): WritePolicy {
    return new WritePolicy(scope.map(toPosixPath));
  }

  static isTestFile(path: string): boolean {
    return TEST_FILE.test(toPosixPath(path));
  }

  allows(role: TeamRole, path: string, testsLocked: boolean): boolean {
    const p = toPosixPath(path);
    switch (role) {
      case 'planner':
        return matchesPattern('features/**', p);
      case 'architect':
        return matchesPattern('docs/adr/**', p);
      case 'tester':
        // 잠기기 전에는 범위 안 소스에 빈 시그니처(스텁)를 만들 수 있다. import 에러 없이
        // 올바른 Red를 만들기 위해서다. 구현까지 해 버리면 Red가 실패 0개라 무효가 된다.
        return !testsLocked && (WritePolicy.isTestFile(p) || this.inScope(p));
      case 'implementer':
        // 범위는 길잡이다: 요청을 끝내려면 범위 밖 파일을 고쳐야 할 때가 많고, 막으면 구현이 계속 실패해 작업이 멈춘다.
        // 잠긴 테스트만 지킨다(비밀 파일은 도구 검사가 따로 막는다). 테스트 없이 진행하는 업무에서는 테스트 파일도 고칠 수 있다.
        return !testsLocked || !WritePolicy.isTestFile(p);
      case 'reviewer':
        return !WritePolicy.isTestFile(p) && this.inScope(p);
      case 'writer':
        return matchesPattern('docs/**', p) || p === 'CHANGELOG.md' || p === 'README.md';
      case 'infra':
        return matchesPattern('infra/**', p);
      case 'lead':
      case 'debugger':
        return false;
    }
  }

  /** 거부된 경로가 하나라도 있으면 diff 전체를 거부한다. */
  assertDiff(role: TeamRole, paths: readonly string[], testsLocked: boolean): void {
    const denied = paths.filter((path) => !this.allows(role, path, testsLocked));
    if (denied.length > 0) {
      throw new DomainError(
        'WRITE_DENIED',
        `${role} 역할은 다음 파일을 바꿀 수 없습니다: ${denied.join(', ')}`,
      );
    }
  }

  /** 지시서 범위 안의 경로인지 */
  covers(path: string): boolean {
    return this.inScope(toPosixPath(path));
  }

  private inScope(path: string): boolean {
    return this.scope.some((pattern) => matchesPattern(pattern, path));
  }
}
