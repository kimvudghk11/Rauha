import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { classifyFolder, SKIPPED_FOLDERS, type FolderKind } from '../../shared/folder-kind.js';
import { parseStatus, type RepoStatus } from '../../shared/git-status.js';
import { mapLimit } from './map-limit.js';

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
  /** 폴더 읽기를 한꺼번에 몇 개까지, git status를 한꺼번에 몇 개까지 돌릴지 */
  const READ_LANES = 8;
  const STATUS_LANES = 6;
  // 먼저 폴더 구조만 훑고(빠르다), 레포의 git status는 마지막에 모아서 병렬로 돌린다.
  const visit = async (dir: string, level: number): Promise<FolderEntry[]> => {
    let names: { name: string; isDir: boolean }[];
    try {
      names = (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }));
    } catch {
      return [];
    }
    const hasGit = names.some((n) => n.name === '.git');
    const extensions = names.filter((n) => !n.isDir).map((n) => (n.name.includes('.') ? (n.name.split('.').pop() ?? '').toLowerCase() : ''));
    const kind = classifyFolder({ hasGit, extensions });
    const isBase = dir === base;
    const children = async (): Promise<FolderEntry[]> => {
      if (level >= depth) return [];
      const subs = names.filter((n) => n.isDir && !SKIPPED_FOLDERS.has(n.name) && !n.name.startsWith('.'));
      return (await mapLimit(subs, READ_LANES, (n) => visit(join(dir, n.name), level + 1))).flat();
    };
    if (kind === 'repo' && isBase) {
      // 작업 폴더 자체에 .git이 있어도(드라이브 루트, 깨진 .git, 홈 폴더 전체를 git으로 관리) 아래에 레포들이 있으면 그것들을 쓴다.
      const below = await children();
      if (below.length > 0) return below;
      return [{ name: basename(dir) || dir, root: dir, relative: '.', kind, status: null }];
    }
    if (kind === 'repo' || (kind === 'docs' && !isBase)) {
      return [{ name: basename(dir) || dir, root: dir, relative: relative(base, dir) || '.', kind, status: null }];
    }
    const below = await children();
    if (isBase && below.length === 0 && kind === 'docs') return [{ name: basename(dir) || dir, root: dir, relative: '.', kind, status: null }];
    return below;
  };
  try {
    if (!(await stat(base)).isDirectory()) return [];
  } catch {
    return [];
  }
  const found = await visit(base, 0);
  return mapLimit(found, STATUS_LANES, async (e) => (e.kind === 'repo' ? { ...e, status: await repoStatus(e.root) } : e));
}
