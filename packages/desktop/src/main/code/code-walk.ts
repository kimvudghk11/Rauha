import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SKIPPED_FOLDERS } from '../../shared/folder-kind.js';

/** 빠른 열기·전체 찾기가 훑는 파일 수 상한 */
export const MAX_WALK_FILES = 20_000;

export interface WalkOptions {
  readonly isSecret: (relPath: string) => boolean;
  readonly maxFiles?: number;
}

/**
 * 작업 폴더 아래 글 파일 후보를 훑는다. 바로가기(심볼릭 링크)는 따라가지 않고(밖으로 새는 길),
 * .git·node_modules·dist 같은 생성물 폴더와 비밀 파일은 들어가지도 담지도 않는다. 경로는 작업 폴더 기준 슬래시, 가나다순.
 */
export async function walkFiles(rootReal: string, options: WalkOptions): Promise<{ paths: string[]; truncated: boolean }> {
  const max = options.maxFiles ?? MAX_WALK_FILES;
  const paths: string[] = [];
  const stack: string[] = [''];
  let truncated = false;
  while (stack.length > 0 && !truncated) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(join(rootReal, ...(dir === '' ? [] : dir.split('/'))), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const rel = dir === '' ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(e.name)) stack.push(rel);
      } else if (e.isFile() && !options.isSecret(rel)) {
        if (paths.length >= max) {
          truncated = true;
          break;
        }
        paths.push(rel);
      }
    }
  }
  paths.sort((a, b) => a.localeCompare(b));
  return { paths, truncated };
}
