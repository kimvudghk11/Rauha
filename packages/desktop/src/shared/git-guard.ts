/** 화면·IPC에서 온 값이 git 인자로 안전하지 않을 때 던진다. message는 사용자에게 그대로 보인다. */
export class GitInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitInputError';
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const BAD_BRANCH = /[\s~^:?*[\\]|\.\.|@\{|\/\/|\.lock(\/|$)/;

/** 브랜치 이름 값 객체. 옵션처럼 읽히거나(앞의 -) git이 거절할 이름은 만들 수 없다. */
export class BranchName {
  private constructor(readonly value: string) {}

  static parse(input: string): BranchName {
    if (CONTROL.test(input)) throw new GitInputError('브랜치 이름에 쓸 수 없는 문자가 있어요.');
    const v = input.trim();
    if (v === '' || v.startsWith('-') || v.startsWith('/') || v.endsWith('/') || v.startsWith('.') || v.endsWith('.') || v === '@' || BAD_BRANCH.test(v) || v.split('/').some((p) => p.startsWith('.'))) {
      throw new GitInputError(`브랜치 이름을 쓸 수 없어요: ${v === '' ? '(비어 있음)' : v}`);
    }
    return new BranchName(v);
  }

  /** "origin/feature/x"에서 "feature/x"만 */
  withoutRemote(remote: string): string {
    return this.value.startsWith(`${remote}/`) ? this.value.slice(remote.length + 1) : this.value;
  }
}

/** 보호 브랜치 목록. main·qa·release 같은 이름과 `release/*` 같은 패턴을 받는다. */
export class ProtectedBranches {
  private constructor(private readonly patterns: readonly string[]) {}

  static of(patterns: readonly string[]): ProtectedBranches {
    return new ProtectedBranches(patterns.map((p) => p.trim()).filter((p) => p !== ''));
  }

  has(branch: string): boolean {
    const names = [branch, branch.replace(/^(origin|upstream)\//, '')];
    return this.patterns.some((p) => names.some((n) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : n === p)));
  }
}

/** 레포 안의 상대 경로 값 객체. 밖으로 나가는 경로·옵션처럼 읽히는 경로·.git 안쪽은 만들 수 없다. */
export class RepoPath {
  private constructor(readonly value: string) {}

  static parse(input: string): RepoPath {
    const v = input.replace(/\\/g, '/');
    const parts = v.split('/');
    if (v === '' || v.startsWith('/') || /^[A-Za-z]:/.test(v) || v.startsWith('-') || v.includes('\0') || parts.some((p) => p === '..' || p.toLowerCase() === '.git')) {
      throw new GitInputError(`이 경로는 쓸 수 없어요: ${input}`);
    }
    return new RepoPath(v);
  }
}

/** 원격 주소에서 GitHub 비교 주소를 만든다. GitHub가 아니면 null. */
export function compareUrl(remote: string, base: string, branch: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote.trim());
  if (m === null) return null;
  const enc = (name: string) => name.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${m[1]}/${m[2]}/compare/${enc(base)}...${enc(branch)}?expand=1`;
}
