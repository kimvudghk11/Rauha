/** 저장소 하나의 지금 상태(rauha 가 git 으로 읽음) */
export interface RepoState {
  readonly name: string;
  readonly root: string;
  readonly branch: string | null;
  /** 추적하는 원격 브랜치. 없으면 null */
  readonly upstream: string | null;
  /** 원격보다 앞선(push 안 한) 커밋 수 */
  readonly ahead: number;
  /** 원격보다 뒤처진(pull 안 한) 커밋 수 */
  readonly behind: number;
  /** 커밋 안 한 파일(git status --porcelain 한 줄씩, 예: " M src/a.ts") */
  readonly changed: readonly string[];
  readonly stashes: number;
  /** 최근에 커밋된 로컬 브랜치(새것부터) */
  readonly branches: readonly { readonly name: string; readonly at: string; readonly subject: string }[];
}

/** 여러 저장소 코드 검색의 한 줄 */
export interface SearchHit {
  readonly repo: string;
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface CommitLine {
  readonly hash: string;
  readonly at: string;
  readonly author: string;
  readonly subject: string;
}

/** GitHub Actions 실행 하나 */
export interface CiRun {
  readonly repo: string;
  readonly id: number;
  readonly workflow: string;
  readonly title: string;
  readonly branch: string;
  readonly sha: string;
  readonly verdict: 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped';
  readonly startedAt: string;
  readonly url: string;
}

/** 실패한 작업 하나와 로그 끝부분 */
export interface CiJobLog {
  readonly job: string;
  readonly lines: readonly string[];
}

const CHANGED_SHOWN = 20;
const BRANCHES_SHOWN = 6;
const HIT_TEXT = 240;
const COMMIT_CHARS = 12_000;
const MARK: Readonly<Record<CiRun['verdict'], string>> = { success: '✓', failure: '✗', running: '…', queued: '…', cancelled: '–', skipped: '–' };

/**
 * rauha 작업 공간 도구가 팀원에게 돌려주는 글. 사실만 옮기고, 길면 줄이되 줄였다고 적는다(다 본 척하지 않게).
 */
export class WorkspaceText {
  private constructor() {}

  /** 저장소마다 push·pull 안 한 커밋, 커밋 안 한 파일, stash, 최근 브랜치 */
  static status(states: readonly RepoState[]): string {
    if (states.length === 0) return '작업 공간에 저장소가 없어요.';
    const clean = states.filter((s) => s.ahead === 0 && s.behind === 0 && s.changed.length === 0 && s.stashes === 0);
    const busy = states.filter((s) => !clean.includes(s));
    const sections = busy.map((s) => {
      const head = [`■ ${s.name} (${s.root})`, s.branch !== null ? `브랜치 ${s.branch}` : '브랜치 없음(detached)', s.upstream !== null ? `원격 ${s.upstream}` : '원격 추적 없음'].join(' · ');
      const facts = [
        s.ahead > 0 ? `push 안 한 커밋 ${s.ahead}개` : null,
        s.behind > 0 ? `pull 안 한 커밋 ${s.behind}개` : null,
        s.stashes > 0 ? `stash ${s.stashes}개` : null,
        s.changed.length > 0 ? `커밋 안 한 파일 ${s.changed.length}개` : null,
      ].filter((f) => f !== null);
      const files = s.changed.slice(0, CHANGED_SHOWN).map((c) => `  ${c}`);
      const more = s.changed.length > CHANGED_SHOWN ? [`  …(${s.changed.length - CHANGED_SHOWN}개 더)`] : [];
      const branches = s.branches.slice(0, BRANCHES_SHOWN).map((b) => `  - ${b.name} ${b.at} ${b.subject}`);
      return [head, facts.join(', '), ...files, ...more, ...(branches.length > 0 ? ['최근 브랜치:', ...branches] : [])].join('\n');
    });
    const tail = clean.length > 0 ? `\n깨끗한 저장소 ${clean.length}개(push·pull·커밋할 것 없음): ${clean.map((s) => s.name).join(', ')}` : '';
    return `저장소 ${states.length}개 상태(빠짐없이 전부):\n${sections.join('\n\n')}${tail}`;
  }

  /** 검색 결과. limit 개만 보이고 넘친 수를 적는다 */
  static hits(pattern: string, hits: readonly SearchHit[], searched: number, limit: number): string {
    if (hits.length === 0) return `저장소 ${searched}개에서 "${pattern}"을(를) 찾지 못했어요.`;
    const shown = hits.slice(0, limit);
    const repos = [...new Set(hits.map((h) => h.repo))];
    const lines = shown.map((h) => `${h.repo}/${h.path}:${h.line}: ${h.text.trim().slice(0, HIT_TEXT)}`);
    const more = hits.length > limit ? `\n…(${hits.length - limit}줄 더 있음. repos·glob 으로 좁혀 다시 찾으세요)` : '';
    return `저장소 ${searched}개 중 ${repos.length}개에서 ${hits.length}줄 찾음(${repos.join(', ')}):\n${lines.join('\n')}${more}`;
  }

  static history(repo: string, path: string, commits: readonly CommitLine[]): string {
    if (commits.length === 0) return `${repo} 에서 ${path} 를 바꾼 커밋이 없어요(경로가 맞는지 보세요).`;
    return `${repo}/${path} 를 바꾼 커밋 ${commits.length}개(새것부터, 이름 바뀜 따라감):\n${commits.map((c) => `- ${c.hash} ${c.at} ${c.author}: ${c.subject}`).join('\n')}`;
  }

  /** git show 결과. 길면 앞부분만 */
  static commit(repo: string, shown: string): string {
    const body = shown.length > COMMIT_CHARS ? `${shown.slice(0, COMMIT_CHARS)}\n…(diff 가 길어 ${shown.length - COMMIT_CHARS}자 생략)` : shown;
    return `■ ${repo}\n${body}`;
  }

  /** 저장소마다 최근 Actions 실행. 저장소가 GitHub 이 아니면 그렇다고 적는다 */
  static ci(runs: readonly CiRun[], notGithub: readonly string[], signedIn: boolean): string {
    const byRepo = new Map<string, CiRun[]>();
    for (const r of runs) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r]);
    const sections = [...byRepo].map(([repo, list]) => [`■ ${repo}`, ...list.map((r) => `- ${MARK[r.verdict]} ${r.verdict} #${r.id} ${r.workflow} · ${r.branch} · ${r.sha.slice(0, 7)} · ${r.startedAt} · ${r.title}`)].join('\n'));
    const parts = [sections.length > 0 ? sections.join('\n\n') : '최근 Actions 실행이 없어요.'];
    if (notGithub.length > 0) parts.push(`GitHub 저장소가 아니라 보지 못함: ${notGithub.join(', ')}`);
    if (!signedIn) parts.push('(GitHub CLI 로그인이 없어 공개 저장소만 보여요. 실패 로그는 로그인이 있어야 읽혀요.)');
    return parts.join('\n\n');
  }

  static ciLog(repo: string, runId: number, jobs: readonly CiJobLog[]): string {
    if (jobs.length === 0) return `${repo} 실행 #${runId} 에 실패한 작업이 없어요.`;
    return jobs.map((j) => `■ ${repo} #${runId} 실패한 작업: ${j.job}\n${j.lines.length > 0 ? j.lines.join('\n') : '(로그를 읽지 못했어요. GitHub CLI 로그인이 필요할 수 있어요.)'}`).join('\n\n');
  }
}
