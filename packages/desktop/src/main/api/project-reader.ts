import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { SourceFile } from '../../shared/api-extract.js';
import { SKIPPED_FOLDERS } from '../../shared/folder-kind.js';
import { mapLimit } from '../workspace/map-limit.js';

/** 프로젝트를 훑은 결과: 무엇이 있는지(파일 내용은 package.json·빌드 파일만 읽는다) */
export interface ProjectSurvey {
  /** git HEAD + 후보 파일 경로·크기·수정 시각으로 만든 지문 */
  readonly fingerprint: string;
  readonly packageJsons: readonly string[];
  readonly jvmBuild: string | null;
  /** 후보 파일 상대 경로(/ 구분) */
  readonly paths: readonly string[];
  /** 상한에 걸려 다 훑지 못했다 */
  readonly truncated: boolean;
}

export interface ProjectReaderPort {
  survey(root: string): Promise<ProjectSurvey>;
  read(root: string, paths: readonly string[]): Promise<SourceFile[]>;
}

export const READER_LIMITS = { depth: 12, entries: 30_000, candidates: 4000, fileBytes: 512 * 1024, totalBytes: 40 * 1024 * 1024, packageJsons: 20 } as const;

const SKIP = new Set([...SKIPPED_FOLDERS, 'bower_components', 'vendor', 'tmp', 'temp', 'logs', '.turbo', '.cache', '.nuxt', '.svelte-kit', '.output', 'test', 'tests', '__tests__', '__mocks__', 'e2e', 'cypress', 'storybook-static', 'public', 'static', 'assets']);
const SOURCE_RE = /\.(?:[cm]?[jt]s|java|kt)$/;
const NOT_SOURCE_RE = /\.(?:spec|test|e2e-spec|stories)\.[cm]?[jt]s$|\.d\.ts$|\.min\.js$/;
const EXTRA_RE = /^(?:(?:openapi|swagger)[\w.-]*\.json|application[\w-]*\.(?:properties|ya?ml))$/i;
const JVM_BUILD = ['pom.xml', 'build.gradle', 'build.gradle.kts'];

async function gitHead(root: string): Promise<string> {
  try {
    const head = (await readFile(join(root, '.git', 'HEAD'), 'utf8')).trim();
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (ref === undefined) return head;
    return `${ref}@${(await readFile(join(root, '.git', ...ref.split('/')), 'utf8').catch(() => '')).trim()}`;
  } catch {
    return '';
  }
}

/** 실제 파일 시스템에서 읽는다. 폴더는 비동기로 훑고, 개수·크기 상한을 둔다. */
export class FsProjectReader implements ProjectReaderPort {
  async survey(root: string): Promise<ProjectSurvey> {
    const found: string[] = [];
    const pkgs: string[] = [];
    let entries = 0;
    let truncated = false;
    let queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
    while (queue.length > 0 && !truncated) {
      const next: { dir: string; depth: number }[] = [];
      await mapLimit(queue, 8, async ({ dir, depth }) => {
        let list;
        try {
          list = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const d of list) {
          if (++entries > READER_LIMITS.entries) {
            truncated = true;
            return;
          }
          const abs = join(dir, d.name);
          if (d.isDirectory()) {
            if (depth < READER_LIMITS.depth && !SKIP.has(d.name) && !d.name.startsWith('.')) next.push({ dir: abs, depth: depth + 1 });
          } else if (d.isFile()) {
            if (d.name === 'package.json') pkgs.push(abs);
            else if ((SOURCE_RE.test(d.name) && !NOT_SOURCE_RE.test(d.name)) || EXTRA_RE.test(d.name)) {
              if (found.length >= READER_LIMITS.candidates) truncated = true;
              else found.push(abs);
            }
          }
        }
      });
      queue = next;
    }
    const rel = (abs: string): string => relative(root, abs).split(sep).join('/');
    const stats = await mapLimit(found, 16, async (abs) => {
      try {
        const s = await stat(abs);
        return `${rel(abs)}:${s.size}:${Math.floor(s.mtimeMs)}`;
      } catch {
        return `${rel(abs)}:-`;
      }
    });
    const pkgTexts = (await mapLimit(pkgs.sort((a, b) => a.length - b.length).slice(0, READER_LIMITS.packageJsons), 8, (p) => readFile(p, 'utf8').catch(() => ''))).filter((t) => t !== '' && t.length < 1_000_000);
    let jvmBuild: string | null = null;
    for (const f of JVM_BUILD) {
      const t = await readFile(join(root, f), 'utf8').catch(() => null);
      if (t !== null) jvmBuild = (jvmBuild ?? '') + t.slice(0, 200_000);
    }
    const hash = createHash('sha1');
    hash.update(await gitHead(root));
    for (const s of [...stats].sort()) hash.update(`\n${s}`);
    for (const t of pkgTexts) hash.update(`\n${t.length}:${t}`);
    hash.update(`\n${jvmBuild ?? ''}`);
    return { fingerprint: hash.digest('hex'), packageJsons: pkgTexts, jvmBuild, paths: found.map(rel).sort(), truncated };
  }

  async read(root: string, paths: readonly string[]): Promise<SourceFile[]> {
    let total = 0;
    const out = await mapLimit(paths.slice(0, READER_LIMITS.candidates), 24, async (p): Promise<SourceFile | null> => {
      const abs = join(root, ...p.split('/'));
      const back = relative(root, abs);
      if (back.startsWith('..') || isAbsolute(back)) return null;
      try {
        const s = await stat(abs);
        if (!s.isFile() || s.size > READER_LIMITS.fileBytes || total + s.size > READER_LIMITS.totalBytes) return null;
        total += s.size;
        return { path: p, text: await readFile(abs, 'utf8') };
      } catch {
        return null;
      }
    });
    return out.filter((f): f is SourceFile => f !== null);
  }
}
