import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadSecretPolicy } from '@rauha/core';

const MAX_BYTES = 512 * 1024;

/**
 * 할 일 근거 확인용 파일 읽기. 허락한 폴더(작업 공간·레포) 안의 작은 글 파일만, 비밀 파일(.env 등)은 읽지 않는다.
 * 상대 경로는 첫 폴더 기준. 밖이거나 없거나 크면 null.
 */
export function workspaceFileReader(roots: readonly string[]): (path: string) => Promise<string | null> {
  const bases = [...new Set(roots.map((r) => resolve(r)))];
  return async (path) => {
    const first = bases[0];
    if (first === undefined) return null;
    const full = isAbsolute(path) ? resolve(path) : resolve(first, path);
    const base = bases.find((b) => {
      const rel = relative(b, full);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    });
    if (base === undefined) return null;
    const rel = relative(base, full).replace(/\\/g, '/');
    if (loadSecretPolicy(base).isSecret(rel)) return null;
    try {
      if ((await stat(full)).size > MAX_BYTES) return null;
      return await readFile(full, 'utf8');
    } catch {
      return null;
    }
  };
}
