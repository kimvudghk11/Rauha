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
    if (CONTROL.test(input)) throw new GitInputError('The branch name has a character that is not allowed.');
    const v = input.trim();
    if (v === '' || v.startsWith('-') || v.startsWith('/') || v.endsWith('/') || v.startsWith('.') || v.endsWith('.') || v === '@' || BAD_BRANCH.test(v) || v.split('/').some((p) => p.startsWith('.'))) {
      throw new GitInputError(`That branch name cannot be used: ${v === '' ? '(empty)' : v}`);
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
      throw new GitInputError(`This path cannot be used: ${input}`);
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

const STASH_INDEX_MAX = 999;
const STASH_MESSAGE_MAX = 100;
const FULL_HASH = /^[0-9a-f]{40}$/;

/**
 * stash 한 줄을 가리키는 값 객체. 번호(stash@{N})와 그 stash 의 커밋 해시를 함께 받는다.
 * 해시는 "목록을 본 뒤 다른 stash 가 생기거나 지워져 번호가 밀린" 때 엉뚱한 stash 를 건드리지 않게 main 이 맞춰 본다.
 */
export class StashRef {
  private constructor(
    readonly index: number,
    readonly hash: string,
  ) {}

  static parse(input: { readonly index: unknown; readonly hash: unknown }): StashRef {
    const { index, hash } = input;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > STASH_INDEX_MAX) throw new GitInputError('That stash number is not valid.');
    const h = typeof hash === 'string' ? hash.toLowerCase() : '';
    if (!FULL_HASH.test(h)) throw new GitInputError('The stash id is not valid. Reload the list and try again.');
    return new StashRef(index, h);
  }

  /** git 에 넘기는 이름. 정수만 들어 있어 옵션처럼 읽힐 수 없다. */
  get name(): string {
    return `stash@{${this.index}}`;
  }
}

/** stash 메시지 값 객체. 빈 글이면 git 의 기본 메시지(WIP on 브랜치)를 쓴다. */
export class StashMessage {
  private constructor(readonly value: string) {}

  static parse(input: unknown): StashMessage {
    if (input === undefined) return new StashMessage('');
    if (typeof input !== 'string' || CONTROL.test(input)) throw new GitInputError('The stash message has a character that is not allowed.');
    const v = input.trim();
    if (v.length > STASH_MESSAGE_MAX) throw new GitInputError(`The stash message is too long (up to ${STASH_MESSAGE_MAX} characters).`);
    return new StashMessage(v);
  }
}
