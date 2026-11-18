import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRepo } from '@rauha/core';
import { runGit } from './git-run.js';

const MAX_COMMITS = 40;
const MAX_TAGS = 5;
/** CHANGELOG 는 앞부분(최근 릴리스)만 읽는다. 실을 양은 core 가 저장소 수에 맞춰 다시 줄인다. */
const CHANGELOG_CHARS = 8_000;
const SEP = '\x1f';
const CHANGELOG_NAME = /^(changelog|changes|history|release[-_ ]?notes|releases)(\.(md|markdown|txt|rst))?$/i;
const LOOK_IN = ['', 'docs', 'doc'];

/**
 * "모든 레포 체인지로그·커밋 봐줘"용: 저장소마다 지금 브랜치, 최근 태그, 모든 사람의 최근 커밋(모든 브랜치, 병합 제외, 새것부터),
 * 루트·docs 의 CHANGELOG 앞부분을 읽는다. 읽기만 하고, 실패한 부분은 빈 값으로 둔다(던지지 않는다).
 */
export async function repoDigest(repos: readonly { readonly name: string; readonly root: string }[]): Promise<DigestRepo[]> {
  return Promise.all(
    repos.map(async (repo): Promise<DigestRepo> => {
      const out = async (args: readonly string[]): Promise<string> => {
        const r = await runGit(repo.root, args).catch(() => null);
        return r !== null && r.code === 0 ? r.stdout.trim() : '';
      };
      const [branch, tags, log, changelog] = await Promise.all([
        out(['branch', '--show-current']),
        out(['for-each-ref', '--sort=-creatordate', `--count=${MAX_TAGS}`, '--format=%(refname:short)', 'refs/tags']),
        // --topo-order: 같은 초에 생긴 커밋도 자식이 부모보다 먼저 온다(시각만으로는 순서가 흔들린다)
        out(['log', '--all', '--no-merges', '--topo-order', '--date=format:%Y-%m-%d', `--format=%h${SEP}%ad${SEP}%an${SEP}%s`, '-n', String(MAX_COMMITS)]),
        findChangelog(repo.root),
      ]);
      const commits = log === '' ? [] : log.split('\n').flatMap((line) => {
        const [hash, at, author, subject] = line.split(SEP);
        return hash !== undefined && at !== undefined && author !== undefined && subject !== undefined ? [{ hash, at, author, subject }] : [];
      });
      return { name: repo.name, root: repo.root, branch: branch === '' ? null : branch, tags: tags === '' ? [] : tags.split('\n'), commits, changelog };
    }),
  );
}

async function findChangelog(root: string): Promise<DigestRepo['changelog']> {
  for (const dir of LOOK_IN) {
    const names = await readdir(join(root, dir)).catch(() => [] as string[]);
    const hit = names.filter((n) => CHANGELOG_NAME.test(n)).sort()[0];
    if (hit === undefined) continue;
    const text = await readFile(join(root, dir, hit), 'utf8').catch(() => null);
    if (text === null) continue;
    return { path: dir === '' ? hit : `${dir}/${hit}`, head: text.slice(0, CHANGELOG_CHARS).trim() };
  }
  return null;
}
