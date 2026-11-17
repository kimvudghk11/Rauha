import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SecretPolicy } from '../../orchestration/domain/secret-policy.js';
import { areaOf, type RepoFacts } from '../domain/repo-knowledge.js';
import { RepoRef } from '../domain/repo-ref.js';
import { exportedSymbols } from '../domain/symbols.js';

const run = promisify(execFile);
const IGNORED = /(^|\/)node_modules\//;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const INSTRUCTIONS = new Set(['CLAUDE.md', 'AGENTS.md', 'README.md']);
const SCRIPTS = ['test', 'typecheck', 'lint', 'build'];
const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
const TEST_PATTERNS = ['.spec.ts', '.test.ts', '.spec.tsx', '.test.tsx', '.spec.js', '.test.js', 'Test.java', 'Tests.java', 'Test.kt', '_test.go', '_test.py'];

/**
 * 저장소 지식을 만들고 최신으로 맞추는 데 필요한 것을 git으로 읽는다(모델 호출 없음).
 * 경로는 작업 폴더 기준이고, 비밀 파일과 node_modules는 어디에도 넣지 않는다.
 */
export class GitRepoReader {
  constructor(
    private readonly root: string,
    private readonly secrets: SecretPolicy,
  ) {}

  /** 지금 기준. git 저장소가 아니거나 커밋이 없으면 null. */
  async current(): Promise<RepoRef | null> {
    const commit = await this.gitOrNull(['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (commit === null || commit === '') return null;
    const branch = await this.gitOrNull(['symbolic-ref', '--short', '-q', 'HEAD']);
    const status = (await this.gitOrNull(['status', '--porcelain', '--', '.'])) ?? '';
    return RepoRef.of({ branch: branch === null || branch === '' ? null : branch, commit, dirty: status !== '' });
  }

  async files(): Promise<string[]> {
    const out = await this.git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], false);
    return this.keep(out.split('\0'));
  }

  async facts(files: readonly string[]): Promise<RepoFacts> {
    const counts = new Map<string, number>();
    for (const f of files) counts.set(areaOf(f), (counts.get(areaOf(f)) ?? 0) + 1);
    const names = (f: string) => f.split('/').pop() ?? f;
    const pkg = await this.packageJson();
    return {
      totalFiles: files.length,
      dirs: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, n]) => ({ path, files: n })),
      packageManager: files.includes('yarn.lock') ? 'yarn' : files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('package-lock.json') ? 'npm' : null,
      scripts: Object.fromEntries(SCRIPTS.flatMap((k) => (typeof pkg?.[k] === 'string' ? [[k, pkg[k] as string]] : []))),
      instructionFiles: files.filter((f) => INSTRUCTIONS.has(names(f))).sort(),
      testPattern: (() => {
        const suffix = TEST_PATTERNS.find((s) => files.some((f) => f.endsWith(s)));
        if (suffix !== undefined) return `*${suffix}`;
        return files.some((f) => /(^|\/)test_[^/]*\.py$/.test(f)) ? 'test_*.py' : null;
      })(),
    };
  }

  /** 코드 파일은 내보낸 이름, 코드가 아닌 파일은 빈 목록, 없는 파일은 null. */
  async symbolsOf(paths: readonly string[]): Promise<Map<string, readonly string[] | null>> {
    const entries = await Promise.all(
      paths.map(async (path): Promise<[string, readonly string[] | null]> => {
        try {
          const text = await readFile(join(this.root, path), 'utf8');
          return [path, CODE.test(path) ? exportedSymbols(text) : []];
        } catch {
          return [path, null];
        }
      }),
    );
    return new Map(entries);
  }

  /**
   * 파일 내용 해시(git blob 해시). 없는 파일과 폴더(서브모듈 등)는 null.
   * git hash-object는 폴더를 만나면 도중에 끝나므로 일반 파일만 넘기고, 그래도 실패하면 모두 null로 둔다.
   */
  async hashes(paths: readonly string[]): Promise<Map<string, string | null>> {
    const present = paths.filter((p) => isFile(join(this.root, p)));
    const out = present.length > 0 ? ((await this.gitWithInput(['hash-object', '--stdin-paths'], present.join('\n')).catch(() => null))?.split('\n') ?? []) : [];
    const found = new Map(present.map((p, i) => [p, out[i]?.trim() || null] as const));
    return new Map(paths.map((p) => [p, found.get(p) ?? null] as const));
  }

  /**
   * 기준 이후 바뀐 파일(커밋된 것 + 커밋 안 한 것 + 새 파일). 기준이 지금 HEAD의 조상이 아니면
   * 갈라진 지점 기준으로 양쪽을 합친다. 기준 커밋이 저장소에 없으면 'rebuild'.
   */
  async changedSince(basis: RepoRef): Promise<{ readonly paths: string[] } | 'rebuild'> {
    if ((await this.gitOrNull(['cat-file', '-e', `${basis.commit}^{commit}`])) === null) return 'rebuild';
    const ancestor = (await this.gitOrNull(['merge-base', '--is-ancestor', basis.commit, 'HEAD'])) !== null;
    const committed = ancestor
      ? await this.names(['diff', '--name-only', '-z', '--relative', basis.commit, 'HEAD', '--', '.'])
      : await (async () => {
          const fork = await this.git(['merge-base', basis.commit, 'HEAD']);
          return [
            ...(await this.names(['diff', '--name-only', '-z', '--relative', fork, basis.commit, '--', '.'])),
            ...(await this.names(['diff', '--name-only', '-z', '--relative', fork, 'HEAD', '--', '.'])),
          ];
        })();
    const working = await this.names(['diff', '--name-only', '-z', '--relative', 'HEAD', '--', '.']);
    const untracked = await this.names(['ls-files', '-z', '--others', '--exclude-standard', '--', '.']);
    return { paths: this.keep([...committed, ...working, ...untracked]) };
  }

  private keep(paths: readonly string[]): string[] {
    return [...new Set(paths)].filter((p) => p !== '' && !IGNORED.test(p) && !this.secrets.isSecret(p)).sort();
  }

  private async names(args: readonly string[]): Promise<string[]> {
    return (await this.git(args, false)).split('\0');
  }

  private async packageJson(): Promise<Record<string, unknown> | null> {
    try {
      const pkg = JSON.parse(await readFile(join(this.root, 'package.json'), 'utf8')) as { scripts?: unknown };
      return typeof pkg.scripts === 'object' && pkg.scripts !== null ? (pkg.scripts as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private async gitOrNull(args: readonly string[]): Promise<string | null> {
    try {
      return await this.git(args);
    } catch {
      return null;
    }
  }

  private async gitWithInput(args: readonly string[], input: string): Promise<string> {
    const child = run('git', ['-c', 'core.quotepath=false', ...args], { cwd: this.root, maxBuffer: 64 * 1024 * 1024 });
    // git이 입력을 다 읽기 전에 끝나면 쓰기가 EPIPE로 실패한다. 처리하지 않으면 프로세스가 죽으므로 받아 두고, 실패는 종료 코드로 알린다.
    child.child.stdin?.on('error', () => undefined);
    child.child.stdin?.end(input);
    return (await child).stdout;
  }

  private async git(args: readonly string[], trim = true): Promise<string> {
    const { stdout } = await run('git', ['-c', 'core.quotepath=false', ...args], { cwd: this.root, maxBuffer: 64 * 1024 * 1024 });
    return trim ? stdout.trim() : stdout;
  }
}
