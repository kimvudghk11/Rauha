import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { toPosixPath } from '../../shared/path-pattern.js';

const SKIP = (name: string) => name.startsWith('.') || name === 'node_modules';
/** 저장소를 찾아 내려가는 깊이. 작업 폴더 바로 아래와 그 아래까지. */
const MAX_DEPTH = 2;

/** 바로가기(symlink)·8.3 짧은 이름을 풀어 git이 돌려주는 경로와 같은 모양으로 맞춘다(macOS의 /var → /private/var 등). */
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function toplevel(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP(d.name))
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/** 두 단계 아래까지 `.git`이 있는 폴더(저장소 안으로는 더 내려가지 않는다). */
function childRepos(launchDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const child of subdirs(dir)) {
      if (existsSync(join(child, '.git'))) found.push(child);
      else if (depth < MAX_DEPTH) walk(child, depth + 1);
    }
  };
  walk(launchDir, 1);
  return found.sort();
}

/**
 * 작업 공간의 저장소들. 띄운 폴더가 저장소의 루트여도 그 아래에 저장소들이 있으면 그것들(없으면 그 저장소 하나). 저장소 밖이거나, 큰 저장소
 * (홈 폴더 전체를 git으로 관리하는 경우 등) 안의 하위 폴더인데 그 아래에 저장소들이 있으면 그 저장소들.
 * 저장소 안의 하위 폴더이고 아래에 저장소가 없으면 감싸는 저장소 하나.
 */
export function discoverRepos(launchDir: string): string[] {
  const top = toplevel(launchDir);
  const atRoot = top !== null && toPosixPath(top).toLowerCase() === toPosixPath(real(launchDir)).toLowerCase();
  const children = childRepos(launchDir);
  // 작업 폴더 자체가 저장소여도(드라이브 루트·홈 폴더를 git으로 관리하는 경우 등) 그 아래에 저장소들이 있으면 그것들을 쓴다.
  if (atRoot) return children.length > 0 ? children : [top];
  if (children.length > 0 || top === null) return children;
  return [top];
}

/** 자기 `.git`이 있는 폴더인지(큰 저장소 안의 아무 폴더가 아니라). /repo add에서 쓴다. */
export function isRepo(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, '.git'));
  } catch {
    return false;
  }
}
