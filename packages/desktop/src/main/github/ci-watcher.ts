import { ciVerdict, type CiFailure } from '../../shared/ci-watch.js';
import type { GithubRepo, JobView, LogLine, RunView } from '../../shared/gh-actions.js';

export interface CiWatcherDeps {
  runs(repo: GithubRepo): Promise<readonly RunView[]>;
  jobs(repo: GithubRepo, runId: number): Promise<readonly JobView[]>;
  log(repo: GithubRepo, jobId: number): Promise<{ readonly lines: readonly LogLine[]; readonly needsLogin: boolean }>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface CiWatchTiming {
  /** 다시 묻는 간격 */
  readonly pollMs: number;
  /** 이 시간 안에 그 커밋의 실행이 안 생기면 CI 가 없는 것으로 본다 */
  readonly appearMs: number;
  /** 이 시간까지 끝나지 않으면 그만 본다 */
  readonly timeoutMs: number;
}

export const CI_TIMING: CiWatchTiming = { pollMs: 45_000, appearMs: 4 * 60_000, timeoutMs: 40 * 60_000 };
const JOBS_MAX = 3;
const TAIL_LINES = 40;

export type CiWatchResult = { readonly kind: 'passed' | 'none' | 'timeout' } | { readonly kind: 'failed'; readonly failure: CiFailure };

/**
 * push 한 커밋의 GitHub Actions 실행이 끝날 때까지 지켜본다(읽기만, 다시 실행·취소 없음).
 * 실패하면 실패한 작업(최대 3개)의 로그 끝부분까지 모은다. 로그는 GitHub CLI 로그인이 있을 때만 읽힌다.
 * 묻다 실패(네트워크·한도)해도 멈추지 않고 다음 간격에 다시 묻는다.
 */
export async function watchCi(deps: CiWatcherDeps, repo: GithubRepo, sha: string, branch: string, timing: CiWatchTiming = CI_TIMING): Promise<CiWatchResult> {
  const start = deps.now();
  while (deps.now() - start < timing.timeoutMs) {
    const runs = await deps.runs(repo).catch(() => null);
    const verdict = runs === null ? 'waiting' : ciVerdict(runs, sha);
    if (verdict === 'passed') return { kind: 'passed' };
    if (verdict === 'none' && deps.now() - start >= timing.appearMs) return { kind: 'none' };
    if (verdict === 'failed' && runs !== null) {
      const mine = runs.filter((r) => r.sha === sha);
      const jobs: { run: string; job: string; tail: string[] }[] = [];
      for (const r of mine.filter((x) => x.verdict === 'failure')) {
        const failedJobs = (await deps.jobs(repo, r.id).catch(() => [])).filter((j) => j.verdict === 'failure');
        for (const j of failedJobs) {
          if (jobs.length >= JOBS_MAX) break;
          const log = await deps.log(repo, j.id).catch(() => null);
          if (log === null || log.needsLogin) continue;
          jobs.push({ run: r.workflow, job: j.name, tail: log.lines.slice(-TAIL_LINES).map((l) => l.text) });
        }
      }
      return { kind: 'failed', failure: { branch, runs: mine, jobs } };
    }
    await deps.sleep(timing.pollMs);
  }
  return { kind: 'timeout' };
}
