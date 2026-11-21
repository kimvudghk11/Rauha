import type { WorkspaceKnown } from '@rauha/core';

/** 작업 공간 저장소 하나의 지식을 붙일 때의 상한(저장소가 많아도 한 번에 붙는 양이 커지지 않게) */
export const WORKSPACE_REPO_CHARS = 3_000;

/** 같은 저장소의 지도를 다시 맞추기까지 기다리는 시간 */
export const MAP_REFRESH_GAP_MS = 10 * 60 * 1000;

const key = (root: string): string => root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * 작업 공간 저장소들의 지식 지도(파일·스택·심볼)를 뒤에서 모델 없이 맞춘다. 아직 모르는 저장소도 한 번 파악해 두어
 * 다음 질문부터 팀원이 처음부터 다시 읽지 않게 한다. 같은 저장소는 MAP_REFRESH_GAP_MS 안에 다시 하지 않는다.
 */
export class MapRefresher {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly run: (root: string) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  async refresh(roots: readonly string[]): Promise<void> {
    const due = roots.filter((root) => {
      const at = this.last.get(key(root));
      return at === undefined || this.now() - at >= MAP_REFRESH_GAP_MS;
    });
    for (const root of due) this.last.set(key(root), this.now());
    // 한 번에 하나씩(여러 저장소의 git·해시가 겹쳐 CPU 를 다 쓰지 않게)
    for (const root of due) await this.run(root).catch(() => undefined);
  }
}

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
