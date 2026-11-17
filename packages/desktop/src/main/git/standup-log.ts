import type { StandupRepo } from '@rauha/core';
import { runGit } from './git-run.js';

const MAX_COMMITS = 40;
const SEP = '\x1f';

/**
 * 스탠드업용: 저장소마다 since(YYYY-MM-DD, 이 컴퓨터 시각 0시)부터의 "내" 커밋(그 저장소 git config user.email 이 쓴 것, 모든 브랜치, 병합 제외),
 * 지금 브랜치, 커밋 안 한 변경 수. 읽기만 한다. 이메일이 없는 저장소는 남의 커밋을 섞지 않으려고 커밋을 넣지 않는다.
 */
export async function standupLog(repos: readonly { readonly name: string; readonly root: string }[], since: string): Promise<StandupRepo[]> {
  return Promise.all(
    repos.map(async (repo): Promise<StandupRepo> => {
      const out = async (args: readonly string[]): Promise<string> => {
        const r = await runGit(repo.root, args).catch(() => null);
        return r !== null && r.code === 0 ? r.stdout.trim() : '';
      };
      const [email, branch, status] = await Promise.all([out(['config', 'user.email']), out(['branch', '--show-current']), out(['status', '--porcelain'])]);
      const log =
        email === ''
          ? ''
          : await out(['log', '--all', '--no-merges', `--since=${since} 00:00`, `--author=${email}`, '--date=format:%Y-%m-%d %H:%M', `--format=%h${SEP}%ad${SEP}%s`, '-n', String(MAX_COMMITS)]);
      const commits = log === '' ? [] : log.split('\n').flatMap((line) => {
        const [hash, at, subject] = line.split(SEP);
        return hash !== undefined && at !== undefined && subject !== undefined ? [{ hash, at, subject }] : [];
      });
      return { name: repo.name, branch: branch === '' ? null : branch, dirty: status === '' ? 0 : status.split('\n').length, commits };
    }),
  );
}
