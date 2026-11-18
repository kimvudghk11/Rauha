import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionsClient } from './actions-client.js';
import { ciLog, ciRuns } from './ci-facts.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(remote: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'rauha-ci-'));
  dirs.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  if (remote !== null) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
  return root;
}

const run = (id: number, verdict: 'success' | 'failure') => ({ id, workflow: 'ci', title: 't', event: 'push', branch: 'main', sha: 'abc1234', number: id, attempt: 1, verdict, startedAt: '2026-11-18', durationSec: 10, url: '', actor: 'me' });

const client: ActionsClient = {
  runs: async () => ({ runs: [run(2, 'failure'), run(1, 'success')], signedIn: true }),
  jobs: async () => [
    { id: 10, name: 'test', verdict: 'failure', durationSec: 5, url: '', steps: [] },
    { id: 11, name: 'lint', verdict: 'success', durationSec: 5, url: '', steps: [] },
  ],
  log: async (_r, id) => ({ lines: [{ text: `job ${id}: expected 1`, error: true }], needsLogin: false }),
};

describe('CI 사실', () => {
  it('GitHub 저장소는 최근 실행을, 아닌 저장소는 이름으로 남긴다', async () => {
    const got = await ciRuns(client, [{ name: 'shop', root: repo('git@github.com:me/shop.git') }, { name: 'local', root: repo(null) }]);
    expect(got.runs.map((r) => `${r.repo}#${r.id}:${r.verdict}`)).toEqual(['shop#2:failure', 'shop#1:success']);
    expect(got.notGithub).toEqual(['local']);
  });

  it('실패한 작업만 로그 끝부분을 읽는다', async () => {
    const logs = await ciLog(client, { name: 'shop', root: repo('https://github.com/me/shop') }, 2);
    expect(logs).toEqual([{ job: 'test', lines: ['job 10: expected 1'] }]);
  });
});
