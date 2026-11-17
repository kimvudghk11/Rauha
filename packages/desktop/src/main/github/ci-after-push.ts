import { ciFixTodo, pushedSha } from '../../shared/ci-watch.js';
import { GithubRepo } from '../../shared/gh-actions.js';
import { NOTE_LIMIT, TITLE_LIMIT } from '../../shared/todo-list.js';
import { runGit } from '../git/git-run.js';
import type { ActionsClient } from './actions-client.js';
import { CI_TIMING, watchCi, type CiWatchTiming } from './ci-watcher.js';

const out = async (cwd: string, args: readonly string[]): Promise<string | null> => {
  const r = await runGit(cwd, args).catch(() => null);
  return r !== null && r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
};

/** 지금 브랜치의 원격 추적 커밋(@{u}). 없으면 null */
export function upstreamOf(cwd: string): Promise<string | null> {
  return out(cwd, ['rev-parse', '--verify', '--quiet', '@{u}']);
}

export interface CiFollowDeps {
  readonly client: ActionsClient;
  /** 실패를 할 일로 남긴다(사용자가 팀에 넘길 수 있게). 스스로 고치기 시작하지 않는다 */
  readonly addTodo: (title: string, note: string) => Promise<void>;
  readonly notify: (title: string, body: string) => void;
  readonly timing?: CiWatchTiming;
}

export interface PushedCommit {
  readonly repo: GithubRepo;
  readonly sha: string;
  readonly branch: string;
}

/** 이 작업이 github.com 저장소에 push 한 커밋. 작업 폴더(worktree)가 정리되기 전에 읽는다. push 하지 않았으면 null */
export async function pushedCommit(cwd: string, upstreamBefore: string | null): Promise<PushedCommit | null> {
  const [upstreamAfter, head, branch, upstreamName] = await Promise.all([upstreamOf(cwd), out(cwd, ['rev-parse', 'HEAD']), out(cwd, ['branch', '--show-current']), out(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])]);
  const sha = pushedSha({ upstreamBefore, upstreamAfter, head });
  if (sha === null || branch === null || upstreamName === null) return null;
  const remoteName = upstreamName.split('/')[0] ?? 'origin';
  const url = await out(cwd, ['remote', 'get-url', remoteName]);
  const repo = url === null ? null : GithubRepo.fromRemote(url);
  return repo === null ? null : { repo, sha, branch };
}

/**
 * push 한 커밋의 GitHub Actions 를 뒤에서 지켜본다. 실패하면 실패한 작업·로그 끝부분을 담은 "CI 실패 고치기" 할 일을 만들고 알린다.
 * 돌려주는 글: 무엇을 했는지(확인용).
 */
export async function followCi(pushed: PushedCommit, deps: CiFollowDeps): Promise<string> {
  const { repo, sha, branch } = pushed;
  const result = await watchCi(
    {
      runs: async (r) => (await deps.client.runs(r)).runs,
      jobs: (r, id) => deps.client.jobs(r, id),
      log: (r, id) => deps.client.log(r, id),
      sleep: (ms) => new Promise((done) => setTimeout(done, ms).unref?.()),
      now: () => Date.now(),
    },
    repo,
    sha,
    branch,
    deps.timing ?? CI_TIMING,
  );
  if (result.kind !== 'failed') return `CI ${result.kind}`;
  const todo = ciFixTodo(result.failure, NOTE_LIMIT);
  await deps.addTodo(todo.title.slice(0, TITLE_LIMIT), todo.note);
  deps.notify('CI 가 실패했어요', `${todo.title}. 할 일에 넣어 두었어요. 팀에 넘기면 고쳐요.`);
  return todo.title;
}
