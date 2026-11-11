import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BlameResult, ChangesResult, DiffResult, RepoInfo } from '../../shared/code-api.js';
import { allAdded, parseHunks, parseStatusZ, type ChangedFile } from '../../shared/code-changes.js';
import { decodeFile, MAX_OPEN_BYTES } from '../../shared/code-text.js';
import { blameArgs, parseBlame } from '../../shared/git-blame.js';
import { isInside } from './code-path.js';
import type { CodeFiles } from './code-files.js';

export interface GitRun {
  (root: string, args: readonly string[]): Promise<{ code: number; stdout: string }>;
}

export interface CodeGitDeps {
  readonly files: CodeFiles;
  /** 작업 폴더 아래 레포 루트들(절대 경로) */
  readonly repos: () => readonly string[];
  readonly run: GitRun;
  readonly platform?: NodeJS.Platform;
}

const toSlash = (p: string): string => p.split(/[\\/]+/).join('/');

/** 코드 탭의 git 표시(읽기 전용): 바뀐 파일 목록과 한 파일의 바뀐 줄. git을 고치는 명령은 부르지 않는다. */
export class CodeGit {
  constructor(private readonly deps: CodeGitDeps) {}

  private get ci(): boolean {
    return (this.deps.platform ?? process.platform) === 'win32';
  }

  /** 실제 경로로 푼 레포들. 작업 폴더 밖 레포(작업 폴더가 레포 안쪽 폴더일 때)도 쓰되 경로는 작업 폴더 기준으로 바꾼다. */
  private async repoList(): Promise<{ real: string; root: string }[]> {
    const out: { real: string; root: string }[] = [];
    for (const root of this.deps.repos()) {
      try {
        out.push({ real: await realpath(root), root });
      } catch {
        /* 사라진 레포는 건너뛴다 */
      }
    }
    return out;
  }

  async changes(): Promise<ChangesResult> {
    const rootReal = await this.deps.files.rootRealPath();
    if (rootReal === null) return { ok: false, reason: 'no-folder' };
    const files: ChangedFile[] = [];
    const repos: RepoInfo[] = [];
    for (const repo of await this.repoList()) {
      const r = await this.deps.run(repo.real, ['status', '--porcelain=v1', '-z', '-unormal']).catch(() => null);
      if (r === null || r.code !== 0) continue;
      const base = toSlash(relative(rootReal, repo.real));
      repos.push({ path: base.startsWith('..') ? '' : base, root: repo.root });
      for (const f of parseStatusZ(r.stdout)) {
        const dir = f.path.endsWith('/');
        const abs = join(repo.real, f.path.replace(/\/$/, ''));
        if (!isInside(rootReal, abs, this.ci)) continue;
        const rel = toSlash(relative(rootReal, abs));
        if (!this.deps.files.isSecretPath(rel)) files.push({ path: dir ? `${rel}/` : rel, code: f.code });
      }
    }
    return { ok: true, files, repos };
  }

  /**
   * 한 파일의 줄별 작성자(읽기 전용). 파일 찾기는 diff 와 같은 길(작업 폴더 안·비밀 파일 거절·링크 너머 거절)을 쓰고,
   * git 은 고정 인자(경로는 -- 뒤)로, textconv 없이 부른다. 저장된 파일 기준이라 안 저장한 글은 반영되지 않는다.
   */
  async blame(rawPath: unknown): Promise<BlameResult> {
    const located = await this.deps.files.locate(rawPath);
    if (!located.ok) return located;
    const { real, clean } = located.value;
    if (clean === '') return { ok: false, reason: 'not-file' };
    const repo = (await this.repoList()).filter((r) => isInside(r.real, real, this.ci)).sort((a, b) => b.real.length - a.real.length)[0];
    if (repo === undefined) return { ok: true, view: null, why: 'not-repo' };
    try {
      if ((await stat(real)).size > MAX_OPEN_BYTES) return { ok: true, view: null, why: 'too-big' };
    } catch {
      return { ok: false, reason: 'missing' };
    }
    const inRepo = toSlash(relative(repo.real, real));
    const tracked = await this.deps.run(repo.real, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', inRepo]).catch(() => null);
    if (tracked === null || tracked.code !== 0) return { ok: true, view: null, why: 'not-tracked' };
    const r = await this.deps.run(repo.real, blameArgs(inRepo)).catch(() => null);
    if (r === null || r.code !== 0) return { ok: true, view: null, why: 'failed' };
    return { ok: true, view: parseBlame(r.stdout), root: repo.root };
  }

  /** 저장된 파일 내용이 HEAD와 다른 줄. 새 파일은 전체가 added, git이 못 알려 주면 표시 없음. */
  async diff(rawPath: unknown): Promise<DiffResult> {
    const located = await this.deps.files.locate(rawPath);
    if (!located.ok) return located;
    const { real, clean } = located.value;
    if (clean === '') return { ok: false, reason: 'not-file' };
    const repo = (await this.repoList()).filter((r) => isInside(r.real, real, this.ci)).sort((a, b) => b.real.length - a.real.length)[0];
    if (repo === undefined) return { ok: true, marks: [] };
    const inRepo = toSlash(relative(repo.real, real));
    const status = await this.deps.run(repo.real, ['status', '--porcelain=v1', '-z', '--', inRepo]).catch(() => null);
    if (status === null || status.code !== 0) return { ok: true, marks: [] };
    if (status.stdout.startsWith('??')) return { ok: true, marks: allAdded(await countLines(real)) };
    const d = await this.deps.run(repo.real, ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', inRepo]).catch(() => null);
    if (d === null || d.code !== 0) {
      // HEAD가 아직 없는 새 레포: 스테이지된 새 파일은 전체가 added
      return { ok: true, marks: status.stdout.startsWith('A') ? allAdded(await countLines(real)) : [] };
    }
    return { ok: true, marks: parseHunks(d.stdout) };
  }
}

async function countLines(real: string): Promise<number> {
  try {
    const bytes = await readFile(real);
    if (bytes.length > MAX_OPEN_BYTES) return 0;
    const decoded = decodeFile(bytes);
    return decoded.ok ? (decoded.text === '' ? 0 : decoded.text.split('\n').length - (decoded.text.endsWith('\n') ? 1 : 0)) : 0;
  } catch {
    return 0;
  }
}
