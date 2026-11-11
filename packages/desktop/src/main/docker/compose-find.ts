import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { isComposeFileName, type ComposeFileView } from '../../shared/docker-api.js';

/** 안쪽을 뒤지지 않는 폴더(의존성·빌드 결과·숨김 폴더) */
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'venv', '__pycache__', 'coverage']);

export interface FindOptions {
  /** 작업 폴더에서 몇 단계 아래까지(0 = 작업 폴더만) */
  readonly maxDepth?: number;
  /** 읽는 폴더 수 상한(큰 폴더에서 오래 걸리지 않게) */
  readonly maxDirs?: number;
  readonly maxFiles?: number;
}

/**
 * 작업 폴더 안의 compose 파일(docker-compose.yml · compose.yaml …)을 찾는다.
 * 너비 우선으로 depth·폴더 수에 상한을 두고, node_modules·숨김 폴더는 건너뛰며, 심볼릭 링크 폴더는 따라가지 않는다.
 */
export function findComposeFiles(root: string, options: FindOptions = {}): readonly ComposeFileView[] {
  const maxDepth = options.maxDepth ?? 4;
  const maxDirs = options.maxDirs ?? 1500;
  const maxFiles = options.maxFiles ?? 100;
  const found: ComposeFileView[] = [];
  let queue: { readonly rel: string; readonly abs: string }[] = [{ rel: '', abs: root }];
  let scanned = 0;
  for (let depth = 0; depth <= maxDepth && queue.length > 0 && found.length < maxFiles; depth++) {
    const next: { rel: string; abs: string }[] = [];
    for (const dir of queue) {
      if (scanned++ >= maxDirs) return sort(found);
      let entries;
      try {
        entries = readdirSync(dir.abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const rel = dir.rel === '' ? e.name : `${dir.rel}/${e.name}`;
        if (e.isFile() && isComposeFileName(e.name)) found.push({ path: rel, folder: dir.rel === '' ? 'Work folder' : dir.rel });
        else if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) next.push({ rel, abs: join(dir.abs, e.name) });
      }
    }
    queue = next;
  }
  return sort(found.slice(0, maxFiles));
}

/**
 * 화면이 고른 compose 파일이 정말 작업 폴더 안의 보통 파일인지 확인한다(심볼릭 링크·정션으로 밖을 가리키는 것은 거절).
 * 맞으면 실제 경로, 아니면 null.
 */
export function resolveComposeFile(root: string, relative: string): string | null {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(resolve(root, relative));
    const inside = real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
    return inside && statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

const sort = (list: ComposeFileView[]): readonly ComposeFileView[] => [...list].sort((a, b) => a.path.localeCompare(b.path));
