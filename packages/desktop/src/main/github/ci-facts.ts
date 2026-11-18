import type { CiJobLog, CiRun, WorkspaceRepo } from '@rauha/core';
import { GithubRepo } from '../../shared/gh-actions.js';
import { runGit } from '../git/git-run.js';
import type { ActionsClient } from './actions-client.js';

const RUNS_PER_REPO = 8;

/** 저장소의 GitHub 주소(origin 먼저, 없으면 첫 원격). GitHub 이 아니면 null */
export async function githubOf(root: string): Promise<GithubRepo | null> {
  const remotes = await runGit(root, ['remote']).catch(() => null);
  const names = remotes !== null && remotes.code === 0 ? remotes.stdout.split('\n').map((n) => n.trim()).filter((n) => n !== '') : [];
  const pick = names.includes('origin') ? 'origin' : names[0];
  if (pick === undefined) return null;
  const url = await runGit(root, ['remote', 'get-url', pick]).catch(() => null);
  return url !== null && url.code === 0 ? GithubRepo.fromRemote(url.stdout.trim()) : null;
}

/** 저장소마다 최근 Actions 실행. GitHub 이 아니거나 읽지 못한 저장소는 notGithub 에 이름으로 남긴다 */
export async function ciRuns(client: ActionsClient, repos: readonly WorkspaceRepo[]): Promise<{ runs: CiRun[]; notGithub: string[]; signedIn: boolean }> {
  let signedIn = true;
  const notGithub: string[] = [];
  const per = await Promise.all(
    repos.map(async (repo): Promise<CiRun[]> => {
      const gh = await githubOf(repo.root);
      if (gh === null) {
        notGithub.push(repo.name);
        return [];
      }
      try {
        const got = await client.runs(gh);
        signedIn &&= got.signedIn;
        return got.runs.slice(0, RUNS_PER_REPO).map((r) => ({ repo: repo.name, id: r.id, workflow: r.workflow, title: r.title, branch: r.branch, sha: r.sha, verdict: r.verdict, startedAt: r.startedAt, url: r.url }));
      } catch {
        notGithub.push(`${repo.name}(읽기 실패)`);
        return [];
      }
    }),
  );
  return { runs: per.flat(), notGithub, signedIn };
}

/** 실행 하나의 실패한 작업과 그 로그 끝부분 */
export async function ciLog(client: ActionsClient, repo: WorkspaceRepo, runId: number): Promise<CiJobLog[]> {
  const gh = await githubOf(repo.root);
  if (gh === null) return [];
  const failed = (await client.jobs(gh, runId)).filter((j) => j.verdict === 'failure');
  return Promise.all(
    failed.map(async (j) => {
      const log = await client.log(gh, j.id).catch(() => ({ lines: [], needsLogin: false }));
      return { job: j.name, lines: log.lines.map((l) => l.text) };
    }),
  );
}
