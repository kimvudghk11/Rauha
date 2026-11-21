import type { WorkspaceKnown } from '@rauha/core';

/** 작업 공간 저장소 하나의 지식을 붙일 때의 상한(저장소가 많아도 한 번에 붙는 양이 커지지 않게) */
export const WORKSPACE_REPO_CHARS = 3_000;

const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * 작업 공간의 다른 저장소들이 저장해 둔 지식(한 번 읽은 저장소를 다시 읽지 않게). 파일만 읽고 모델은 부르지 않는다.
 * 지금 저장소는 따로 붙으니 뺀다. 못 읽은 저장소는 null(아직 파악하지 않음)로 둔다.
 */
export async function workspaceKnowledge(
  repos: readonly { readonly name: string; readonly root: string }[],
  currentRoot: string,
  load: (root: string) => Promise<{ toBlock(name: string, maxChars: number): string } | null>,
): Promise<WorkspaceKnown[]> {
  const others = repos.filter((r) => !same(r.root, currentRoot));
  return Promise.all(
    others.map(async (r): Promise<WorkspaceKnown> => {
      try {
        const k = await load(r.root);
        return { name: r.name, block: k === null ? null : k.toBlock(r.name, WORKSPACE_REPO_CHARS) };
      } catch {
        return { name: r.name, block: null };
      }
    }),
  );
}
