import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { classifyFolder, SKIPPED_FOLDERS, type FolderKind } from '../../shared/folder-kind.js';
import { parseStatus, type RepoStatus } from '../../shared/git-status.js';

const run = promisify(execFile);

export interface FolderEntry {
  readonly name: string;
  readonly root: string;
  /** 작업 폴더 기준 상대 경로 */
  readonly relative: string;
  readonly kind: FolderKind;
  /** 레포일 때만 */
  readonly status: RepoStatus | null;
}

/** 폴더를 몇 단계까지 내려갈지. 레포는 안으로 들어가지 않는다(레포 안의 레포는 따로 찾지 않는다). */
export const SCAN_DEPTH = 3;

async function repoStatus(root: string): Promise<RepoStatus | null> {
  try {
    const { stdout } = await run('git', ['status', '-sb', '--porcelain'], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return parseStatus(stdout);
  } catch {
    return null;
  }
}

/**
 * 작업 폴더 아래를 훑어 레포·문서 폴더·기타 폴더를 찾는다. 파일 내용은 읽지 않고 이름과 확장자만 본다.
 * 생성물 폴더(node_modules·dist·build …)는 들어가지 않는다. 작업 폴더 자체가 레포여도 아래에 레포가 있으면 그것들을, 없으면 그 하나만 돌려준다.
 */
export async function scanWorkFolder(base: string, depth: number = SCAN_DEPTH): Promise<FolderEntry[]> {
  const found: FolderEntry[] = [];
  const visit = async (dir: string, level: number): Promise<void> => {
    let names: { name: string; isDir: boolean }[];
    try {
      names = (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }));
    } catch {
      return;
    }
    const hasGit = names.some((n) => n.name === '.git');
    const extensions = names.filter((n) => !n.isDir).map((n) => (n.name.includes('.') ? (n.name.split('.').pop() ?? '').toLowerCase() : ''));
    const kind = classifyFolder({ hasGit, extensions });
    const isBase = dir === base;
    if (kind === 'repo' && isBase) {
      // 작업 폴더 자체에 .git이 있어도(드라이브 루트, 깨진 .git, 홈 폴더 전체를 git으로 관리) 아래에 레포들이 있으면 그것들을 쓴다.
      const before = found.length;
      if (level < depth) {
        for (const n of names) {
          if (!n.isDir || SKIPPED_FOLDERS.has(n.name) || n.name.startsWith('.')) continue;
          await visit(join(dir, n.name), level + 1);
        }
      }
      if (found.length > before) return;
      found.push({ name: basename(dir) || dir, root: dir, relative: '.', kind, status: await repoStatus(dir) });
      return;
    }
    if (kind === 'repo' || (kind === 'docs' && !isBase)) {
      found.push({ name: basename(dir) || dir, root: dir, relative: relative(base, dir) || '.', kind, status: kind === 'repo' ? await repoStatus(dir) : null });
      return;
    }
    if (level < depth) {
      for (const n of names) {
        if (!n.isDir || SKIPPED_FOLDERS.has(n.name) || n.name.startsWith('.')) continue;
        await visit(join(dir, n.name), level + 1);
      }
    }
    if (isBase && found.length === 0 && kind === 'docs') found.push({ name: basename(dir) || dir, root: dir, relative: '.', kind, status: null });
  };
  try {
    if (!(await stat(base)).isDirectory()) return [];
  } catch {
    return [];
  }
  await visit(base, 0);
  return found;
}
