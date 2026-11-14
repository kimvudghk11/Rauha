import { execFile } from 'node:child_process';
import { type GithubRepo, jobsFromApi, type JobView, logTail, type LogLine, runsFromApi, type RunView } from '../../shared/gh-actions.js';
import { GitFailure } from '../git/git-run.js';

/** Actions 화면이 main 에 묻는 것. 모두 읽기 전용이다(다시 실행·취소 없음). */
export interface ActionsClient {
  runs(repo: GithubRepo): Promise<{ runs: RunView[]; signedIn: boolean }>;
  jobs(repo: GithubRepo, runId: number): Promise<JobView[]>;
  log(repo: GithubRepo, jobId: number): Promise<{ lines: LogLine[]; needsLogin: boolean }>;
}

export interface ActionsDeps {
  readonly fetch: typeof fetch;
  /** GitHub CLI(gh)에 로그인돼 있으면 그 토큰, 아니면 null. 토큰은 main 안에서만 쓰고 화면에 넘기지 않는다. */
  readonly ghToken: () => Promise<string | null>;
  readonly userAgent: string;
}

const CACHE_MAX = 200;
const LOG_MAX_BYTES = 8 * 1024 * 1024;
const LOG_LINES = 120;

/** gh auth token 으로 GitHub CLI 의 로그인 토큰을 읽는다. gh 가 없거나 로그인 전이면 null */
export function ghCliToken(): Promise<string | null> {
  return new Promise((done) => {
    execFile('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const t = typeof stdout === 'string' ? stdout.trim() : '';
      done(err === null && /^[A-Za-z0-9_]{20,255}$/.test(t) ? t : null);
    });
  });
}

/**
 * api.github.com 을 읽는다. 로그인 없이도 공개 저장소는 보이지만 시간당 60번이라,
 * 같은 주소는 ETag 로 다시 물어(바뀐 게 없으면 304, 횟수에 안 들어감) 아낀다.
 */
export class GithubActionsClient implements ActionsClient {
  private readonly cache = new Map<string, { etag: string; body: unknown }>();
  private token: Promise<string | null> | null = null;

  private constructor(private readonly deps: ActionsDeps) {}

  static create(deps: ActionsDeps): GithubActionsClient {
    return new GithubActionsClient(deps);
  }

  private tok(): Promise<string | null> {
    return (this.token ??= this.deps.ghToken());
  }

  private headers(token: string | null, etag?: string): Record<string, string> {
    return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': this.deps.userAgent, ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(etag === undefined ? {} : { 'If-None-Match': etag }) };
  }

  private async refuse(res: Response, token: string | null): Promise<never> {
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const at = Number.isFinite(reset) ? new Date(reset * 1000).toLocaleTimeString() : 'a while';
      throw new GitFailure('BLOCKED', token === null ? `GitHub allows 60 checks an hour without signing in, and they are used up. Try again after ${at}, or sign in with the GitHub CLI (gh auth login).` : `GitHub's limit for this hour is used up. Try again after ${at}.`);
    }
    if (res.status === 404) throw new GitFailure('BLOCKED', token === null ? 'GitHub did not find this repo. If it is private, sign in with the GitHub CLI (gh auth login), then reopen this tab.' : 'GitHub did not find this repo or its Actions.');
    if (res.status === 401) throw new GitFailure('BLOCKED', 'The GitHub CLI login has expired. Run gh auth login again.');
    throw new GitFailure('FAILED', `GitHub answered ${res.status}.`);
  }

  private async get(path: string): Promise<unknown> {
    const token = await this.tok();
    const hit = this.cache.get(path);
    let res: Response;
    try {
      res = await this.deps.fetch(`https://api.github.com${path}`, { headers: this.headers(token, hit?.etag), signal: AbortSignal.timeout(15000) });
    } catch {
      throw new GitFailure('FAILED', 'Could not reach GitHub. Check your internet connection.');
    }
    if (res.status === 304 && hit !== undefined) return hit.body;
    if (!res.ok) return this.refuse(res, token);
    const body: unknown = await res.json();
    const etag = res.headers.get('etag');
    if (etag !== null) {
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(path, { etag, body });
    }
    return body;
  }

  async runs(repo: GithubRepo): Promise<{ runs: RunView[]; signedIn: boolean }> {
    const json = await this.get(`/repos/${repo.slug}/actions/runs?per_page=30`);
    return { runs: runsFromApi(json), signedIn: (await this.tok()) !== null };
  }

  async jobs(repo: GithubRepo, runId: number): Promise<JobView[]> {
    return jobsFromApi(await this.get(`/repos/${repo.slug}/actions/runs/${runId}/jobs?per_page=50`));
  }

  /** 작업 로그의 끝부분. GitHub 은 로그를 로그인한 사람에게만 주므로, 로그인이 없으면 needsLogin */
  async log(repo: GithubRepo, jobId: number): Promise<{ lines: LogLine[]; needsLogin: boolean }> {
    const token = await this.tok();
    if (token === null) return { lines: [], needsLogin: true };
    let res: Response;
    try {
      res = await this.deps.fetch(`https://api.github.com/repos/${repo.slug}/actions/jobs/${jobId}/logs`, { headers: this.headers(token), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    } catch {
      throw new GitFailure('FAILED', 'Could not reach GitHub. Check your internet connection.');
    }
    if (res.status === 410) throw new GitFailure('BLOCKED', 'This log has expired on GitHub.');
    if (!res.ok) return this.refuse(res, token);
    const size = Number(res.headers.get('content-length'));
    if (Number.isFinite(size) && size > LOG_MAX_BYTES) throw new GitFailure('BLOCKED', 'This log is too big to show here. Open it on GitHub.');
    const text = await res.text();
    return { lines: logTail(text.length > LOG_MAX_BYTES ? text.slice(-LOG_MAX_BYTES) : text, LOG_LINES), needsLogin: false };
  }
}
