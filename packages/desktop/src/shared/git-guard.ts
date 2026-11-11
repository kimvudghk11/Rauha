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

/** 글자 모양만 다른 .git 을 만드는 보이지 않는 글자(맥 HFS+ 가 무시한다) */
const INVISIBLE = /[​-‏‪-‮⁠-⁯﻿]/g;
/** Windows 짧은 이름(GIT~1 은 .git 폴더를 연다) */
const SHORT_GIT = /^git~\d+$/i;
/** Windows 예약 장치 이름(확장자가 붙어도 장치다) */
const DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

/** 이 이름이 .git 폴더를 가리킬 수 있는가(끝의 점·공백, 대체 데이터 스트림, 짧은 이름, 보이지 않는 글자, 대소문자) */
function pointsAtGit(part: string): boolean {
  const name = part.replace(INVISIBLE, '').replace(/:.*$/s, '').replace(/[. ]+$/, '');
  return name.toLowerCase() === '.git' || SHORT_GIT.test(name);
}

/**
 * 레포 안의 상대 경로 값 객체. 밖으로 나가는 경로·옵션처럼 읽히는 경로·.git 안쪽(Windows 가 같은 폴더로 여기는 이름 포함)·제어 문자는 만들 수 없다.
 * windows 가 true 면 콜론(대체 데이터 스트림·드라이브)과 예약 장치 이름(CON·NUL …)도 거절한다.
 */
export class RepoPath {
  private constructor(readonly value: string) {}

  static parse(input: string, windows: boolean = process.platform === 'win32'): RepoPath {
    const v = input.replace(/\\/g, '/');
    const reject = (): never => {
      throw new GitInputError(`This path cannot be used: ${CONTROL.test(input) ? '(control character)' : input}`);
    };
    if (v === '' || v.startsWith('/') || /^[A-Za-z]:/.test(v) || v.startsWith('-') || CONTROL.test(v)) return reject();
    for (const p of v.split('/')) {
      if (p === '' || p === '.' || p === '..' || pointsAtGit(p)) return reject();
      if (windows && (p.includes(':') || DEVICE.test(p.replace(/[. ]+$/, '')))) return reject();
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
