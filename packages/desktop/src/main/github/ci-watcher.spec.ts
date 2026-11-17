import { describe, expect, it } from 'vitest';
import { GithubRepo, type JobView, type RunView } from '../../shared/gh-actions.js';
import { watchCi, type CiWatcherDeps } from './ci-watcher.js';

const repo = GithubRepo.fromRemote('https://github.com/o/r.git')!;
const run = (over: Partial<RunView>): RunView => ({ id: 1, workflow: 'test', title: 't', event: 'push', branch: 'main', sha: 'abc', number: 3, attempt: 1, verdict: 'running', startedAt: '', durationSec: 1, url: 'https://github.com/o/r/actions/runs/1', actor: 'me', ...over });
const job = (over: Partial<JobView>): JobView => ({ id: 10, name: 'yarn test', verdict: 'failure', durationSec: 1, url: '', steps: [], ...over });
const timing = { pollMs: 10, appearMs: 30, timeoutMs: 100 };

function deps(sequence: (readonly RunView[] | Error)[], extra: Partial<CiWatcherDeps> = {}): CiWatcherDeps & { slept: number } {
  let clock = 0;
  let i = 0;
  const d = {
    slept: 0,
    runs: async () => {
      const next = sequence[Math.min(i++, sequence.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
    jobs: async () => [job({}), job({ id: 11, name: 'lint', verdict: 'success' })],
    log: async () => ({ lines: [{ text: 'FAIL money.spec.ts', error: true }], needsLogin: false }),
    sleep: async (ms: number) => {
      clock += ms;
      d.slept += 1;
    },
    now: () => clock,
    ...extra,
  };
  return d;
}

describe('CI 지켜보기', () => {
  it('도는 동안 기다렸다가 끝나면 판정한다(통과)', async () => {
    const d = deps([[run({})], [run({})], [run({ verdict: 'success' })]]);
    expect(await watchCi(d, repo, 'abc', 'main', timing)).toEqual({ kind: 'passed' });
    expect(d.slept).toBe(2);
  });

  it('실패하면 실패한 작업의 로그 끝부분까지 모은다(성공한 작업은 빼고)', async () => {
    const r = await watchCi(deps([[run({ verdict: 'failure' })]]), repo, 'abc', 'feat/x', timing);
    expect(r.kind).toBe('failed');
    if (r.kind !== 'failed') return;
    expect(r.failure.branch).toBe('feat/x');
    expect(r.failure.jobs).toEqual([{ run: 'test', job: 'yarn test', tail: ['FAIL money.spec.ts'] }]);
  });

  it('로그인이 없어 로그를 못 읽어도 실패는 알린다', async () => {
    const r = await watchCi(deps([[run({ verdict: 'failure' })]], { log: async () => ({ lines: [], needsLogin: true }) }), repo, 'abc', 'main', timing);
    expect(r.kind === 'failed' && r.failure.jobs).toEqual([]);
  });

  it('그 커밋의 실행이 한동안 안 생기면 CI 가 없는 것으로 본다', async () => {
    expect(await watchCi(deps([[run({ sha: 'other' })]]), repo, 'abc', 'main', timing)).toEqual({ kind: 'none' });
  });

  it('묻다 실패해도 다음 간격에 다시 묻고, 시간이 다 되면 그만 본다', async () => {
    expect(await watchCi(deps([new Error('net'), [run({ verdict: 'success' })]]), repo, 'abc', 'main', timing)).toEqual({ kind: 'passed' });
    expect(await watchCi(deps([[run({})]]), repo, 'abc', 'main', timing)).toEqual({ kind: 'timeout' });
  });
});
