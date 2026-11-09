import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import type { SecretPolicy } from '@rauha/core';
import { CarryPaths } from './carry-paths.js';

/** 한 파일이 이보다 크면 옮기지 않는다(앞 대화가 가리키는 건 코드·문서 정도다) */
const MAX_CARRY_BYTES = 5 * 1024 * 1024;

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** 경로의 각 단계가 심볼릭 링크·정션이 아닌지. file: 마지막이 일반 파일이어야 함, any: 없어도 됨(복사 대상) */
async function plainChain(base: string, rel: string, last: 'file' | 'any'): Promise<boolean> {
  let cur = base;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    cur = join(cur, parts[i]!);
    const isLast = i === parts.length - 1;
    let info;
    try {
      info = await lstat(cur);
    } catch (error) {
      // 없는 단계는 복사 대상 쪽에서만 괜찮다(만들 거라서)
      return (error as NodeJS.ErrnoException).code === 'ENOENT' && last === 'any';
    }
    if (info.isSymbolicLink()) return false;
    if (!isLast && !info.isDirectory()) return false;
    if (isLast && last === 'file' && !info.isFile()) return false;
  }
  return true;
}

/**
 * 앞 업무가 원래 폴더(root)에 남긴 커밋 안 한 파일을 새 worktree로 복사한다. 그래야 "방금 만든 파일 정리해줘" 같은 이어 시키는 일이 파일을 찾는다.
 * 복사만 하고 원래 폴더는 건드리지 않는다. 비밀 파일·레포 밖·링크·큰 파일·폴더는 건너뛰고, 복사한 상대 경로를 돌려준다.
 * 복사본은 worktree의 변경이 되므로 worktree를 정리할 때 작업 브랜치에 남는다.
 */
export async function carryFiles(root: string, worktree: string, paths: readonly string[], secrets: SecretPolicy): Promise<{ copied: string[] }> {
  const copied: string[] = [];
  let realRoot: string;
  let realWorktree: string;
  try {
    realRoot = await realpath(root);
    realWorktree = await realpath(worktree);
  } catch {
    return { copied };
  }
  for (const rel of CarryPaths.of(paths, secrets).allowed()) {
    try {
      const from = join(root, rel);
      const to = join(worktree, rel);
      if (!(await plainChain(root, rel, 'file'))) continue;
      if (!(await plainChain(worktree, rel, 'any'))) continue;
      if ((await lstat(from)).size > MAX_CARRY_BYTES) continue;
      if (!inside(realRoot, await realpath(from))) continue;
      await mkdir(dirname(to), { recursive: true });
      // 폴더를 만든 뒤, 쓰기 직전에 대상이 worktree 밖으로 새지 않는지 한 번 더 본다
      if (!(await plainChain(worktree, rel, 'any')) || !inside(realWorktree, join(await realpath(dirname(to)), rel.split('/').pop()!))) continue;
      await copyFile(from, to);
      copied.push(rel);
    } catch {
      /* 못 옮기는 파일은 건너뛴다 */
    }
  }
  return { copied };
}
