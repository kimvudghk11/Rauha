import { relativeToRoot, toPosixPath } from '../../shared/path-pattern.js';

export interface NamedRoot {
  readonly name: string;
  readonly root: string;
}

/** 경로가 가리킬 수 있는 레포와, 그 레포에 넘겨 읽을 경로 */
export interface RepoPathHit {
  readonly name: string;
  readonly path: string;
}

const ABSOLUTE = /^([a-zA-Z]:\/|\/)/;

const hasParentStep = (posix: string) => posix.split('/').includes('..');

/**
 * 팀원이 말한 파일 경로가 어느 레포(작업 폴더) 소속인지 정하는 순수 규칙.
 * 읽기는 하지 않는다. 루트 밖으로 나가는 `..`는 어디도 가리키지 못한다.
 */
export class RepoPaths {
  /**
   * 경로가 속할 수 있는 레포를 가능성 높은 순으로. 절대 경로는 루트 아래의 레포 하나,
   * 상대 경로는 `<레포 이름>/…`로 읽은 것을 먼저, 그다음 모든 레포를 후보로 든다.
   */
  static ownersOf(path: string, repos: readonly NamedRoot[]): RepoPathHit[] {
    const posix = toPosixPath(path.trim());
    if (posix === '' || hasParentStep(posix)) return [];
    if (ABSOLUTE.test(posix)) {
      return repos
        .filter((r) => (relativeToRoot(r.root, posix) ?? '') !== '')
        .sort((a, b) => b.root.length - a.root.length)
        .map((r) => ({ name: r.name, path: posix }));
    }
    const prefixed = repos.filter((r) => posix.startsWith(`${r.name}/`)).map((r) => ({ name: r.name, path: posix.slice(r.name.length + 1) }));
    return [...prefixed, ...repos.map((r) => ({ name: r.name, path: posix }))];
  }

  /**
   * 작업 폴더 기준 상대 경로. 폴더 밖(다른 레포, `..`)이거나 폴더 자체면 null.
   * root가 null이면(폴더를 모를 때) 이미 상대 경로인 것만 받는다.
   */
  static relativeIn(root: string | null, path: string): string | null {
    const posix = toPosixPath(path.trim());
    if (posix === '' || hasParentStep(posix)) return null;
    if (root === null) return ABSOLUTE.test(posix) ? null : posix.replace(/^(\.\/)+/, '');
    const rel = relativeToRoot(root, posix);
    return rel === null || rel === '' ? null : rel;
  }
}
