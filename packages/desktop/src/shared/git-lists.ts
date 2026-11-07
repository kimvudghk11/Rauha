const US = '\x1f';
const RS = '\x1e';

/** `git log --format=`에 넘기는 형식. 필드는 \x1f, 커밋은 \x1e로 끊는다(제목에 무엇이 들어 있어도 안전하다). */
export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%D%x1e';
export const LOG_LIMIT = 200;

export interface LogRow {
  readonly hash: string;
  readonly short: string;
  readonly author: string;
  /** 초 단위 UNIX 시각 */
  readonly at: number;
  readonly subject: string;
  readonly refs: readonly string[];
}

export function parseLog(text: string): LogRow[] {
  return text
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((r) => {
      const [hash = '', short = '', author = '', at = '0', subject = '', refs = ''] = r.split(US);
      return { hash, short, author, at: Number(at), subject, refs: refs === '' ? [] : refs.split(', ') };
    });
}

/** `for-each-ref`에 넘기는 형식(refname, 짧은 이름, HEAD 표시, upstream, 앞섬/뒤처짐) */
export const BRANCH_FORMAT = '%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)';
const TEAM_PREFIX = 'rauha/job-';

export class BranchInfo {
  private constructor(
    readonly name: string,
    readonly remote: boolean,
    readonly current: boolean,
    readonly upstream: string | null,
    readonly track: string,
  ) {}

  static of(name: string, remote: boolean, current: boolean, upstream: string | null, track: string): BranchInfo {
    return new BranchInfo(name, remote, current, upstream, track);
  }

  /** rauha 팀원이 남긴 작업 브랜치(원격에 올라가 있으면 origin/ 이 붙는다) */
  isTeamJob(): boolean {
    return this.name.replace(/^[^/]+\//, (m) => (this.remote ? '' : m)).startsWith(TEAM_PREFIX);
  }
}

export interface BranchView {
  readonly name: string;
  readonly remote: boolean;
  readonly current: boolean;
  readonly upstream: string | null;
  readonly track: string;
  readonly team: boolean;
}

export function parseBranches(text: string): BranchInfo[] {
  const out: BranchInfo[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const [ref = '', short = '', head = '', upstream = '', track = ''] = line.split(US);
    if (ref.startsWith('refs/heads/')) out.push(BranchInfo.of(short, false, head === '*', upstream === '' ? null : upstream, track));
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) out.push(BranchInfo.of(short, true, false, null, ''));
  }
  return out;
}

export const branchView = (b: BranchInfo): BranchView => ({ name: b.name, remote: b.remote, current: b.current, upstream: b.upstream, track: b.track, team: b.isTeamJob() });
