import { loadSecretPolicy, type CommitLine, type RepoState, type SearchHit, type WorkspaceRepo } from '@rauha/core';
import { runGit } from './git-run.js';

const SEP = '\x1f';
const BRANCHES = 6;
const HISTORY = 20;

async function out(root: string, args: readonly string[]): Promise<string | null> {
  const r = await runGit(root, args).catch(() => null);
  return r !== null && r.code === 0 ? r.stdout : null;
}

/** "## main...origin/main [ahead 2, behind 1]" → 브랜치·원격·앞섬·뒤처짐 */
export function parseBranchLine(line: string): { branch: string | null; upstream: string | null; ahead: number; behind: number } {
  const body = line.replace(/^##\s*/, '');
  const ahead = Number(/ahead (\d+)/.exec(body)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(body)?.[1] ?? 0);
  const names = body.replace(/\s*\[.*\]\s*$/, '');
  if (names.startsWith('HEAD (no branch)')) return { branch: null, upstream: null, ahead, behind };
  const [branch = '', upstream] = names.replace(/^No commits yet on /, '').split('...');
  return { branch: branch === '' ? null : branch, upstream: upstream ?? null, ahead, behind };
}

/** 저장소마다 push·pull 안 한 커밋, 커밋 안 한 파일, stash, 최근 브랜치. 읽기만 한다(fetch 하지 않으므로 원격 기준은 마지막 fetch 때). */
export async function repoStatus(repos: readonly WorkspaceRepo[]): Promise<RepoState[]> {
  return Promise.all(
    repos.map(async (repo): Promise<RepoState> => {
      const [status, stash, refs] = await Promise.all([
        out(repo.root, ['status', '--porcelain=v1', '-b']),
        out(repo.root, ['stash', 'list']),
        out(repo.root, ['for-each-ref', '--sort=-committerdate', `--count=${BRANCHES}`, `--format=%(refname:short)${SEP}%(committerdate:short)${SEP}%(subject)`, 'refs/heads']),
      ]);
      const lines = (status ?? '').split('\n').filter((l) => l !== '');
      const head = lines[0]?.startsWith('##') === true ? parseBranchLine(lines[0]) : { branch: null, upstream: null, ahead: 0, behind: 0 };
      const branches = (refs ?? '').split('\n').flatMap((l) => {
        const [name, at, subject] = l.split(SEP);
        return name !== undefined && name !== '' && at !== undefined && subject !== undefined ? [{ name, at, subject }] : [];
      });
      return { name: repo.name, root: repo.root, ...head, changed: lines.filter((l) => !l.startsWith('##')), stashes: (stash ?? '').split('\n').filter((l) => l !== '').length, branches };
    }),
  );
}

/** git grep 으로 여러 저장소의 추적 파일을 찾는다. 비밀 파일 줄은 뺀다. 모두 합쳐 limit 줄까지만 모은다. */
export async function searchRepos(repos: readonly WorkspaceRepo[], pattern: string, options: { readonly fixed: boolean; readonly glob: string | null; readonly limit: number }): Promise<SearchHit[]> {
  const found = await Promise.all(
    repos.map(async (repo) => {
      const secrets = loadSecretPolicy(repo.root);
      const args = ['grep', '-n', '-I', '--no-color', '--full-name', options.fixed ? '-F' : '-E', '-e', pattern, '--', ...(options.glob !== null ? [options.glob] : [])];
      const text = await out(repo.root, args);
      if (text === null) return [];
      const hits: SearchHit[] = [];
      for (const line of text.split('\n')) {
        const m = /^(.+?):(\d+):(.*)$/.exec(line);
        if (m === null || secrets.isSecret(m[1]!)) continue;
        hits.push({ repo: repo.name, path: m[1]!, line: Number(m[2]), text: m[3]! });
        if (hits.length >= options.limit) break;
      }
      return hits;
    }),
  );
  return found.flat().slice(0, options.limit);
}

/** 파일 하나를 바꾼 커밋(이름 바뀜 따라감, 새것부터) */
export async function fileHistory(repo: WorkspaceRepo, path: string): Promise<CommitLine[]> {
  const log = await out(repo.root, ['log', '--follow', '-n', String(HISTORY), '--date=format:%Y-%m-%d', `--format=%h${SEP}%ad${SEP}%an${SEP}%s`, '--', path]);
  return (log ?? '').split('\n').flatMap((l) => {
    const [hash, at, author, subject] = l.split(SEP);
    return hash !== undefined && hash !== '' && at !== undefined && author !== undefined && subject !== undefined ? [{ hash, at, author, subject }] : [];
  });
}

/** 커밋 하나: 메시지·바뀐 파일 통계·diff. 비밀 파일 diff 는 빼고 뺐다고 적는다. 없는 커밋이면 null */
export async function showCommit(repo: WorkspaceRepo, revision: string): Promise<string | null> {
  const sha = (await out(repo.root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`]))?.trim();
  if (sha === undefined || sha === '') return null;
  const secrets = loadSecretPolicy(repo.root);
  const [head, names] = await Promise.all([out(repo.root, ['show', '--no-color', '--stat', '--format=fuller', sha]), out(repo.root, ['show', '--no-color', '--name-only', '--format=', sha])]);
  const files = (names ?? '').split('\n').filter((f) => f !== '');
  const open = files.filter((f) => !secrets.isSecret(f));
  const hidden = files.length - open.length;
  const diff = open.length > 0 ? ((await out(repo.root, ['show', '--no-color', '--format=', sha, '--', ...open])) ?? '') : '';
  return [head?.trim() ?? sha, hidden > 0 ? `(비밀 파일 ${hidden}개의 diff 는 뺐어요)` : '', diff.trim()].filter((s) => s !== '').join('\n\n');
}
