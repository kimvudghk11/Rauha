import { describe, expect, it } from 'vitest';
import type { DigestRepo } from '../domain/repo-digest.js';
import type { WorkspaceFacts } from '../application/workspace-facts.js';
import { WORKSPACE_SERVER, withWorkspace, workspaceToolHandlers } from './workspace-mcp.js';

const repos: DigestRepo[] = [
  { name: 'shop', root: 'E:/w/shop', branch: 'main', tags: [], commits: [{ hash: 'a1', at: '2026-11-17', author: '김', subject: '결제 취소' }], changelog: { path: 'CHANGELOG.md', head: '## 1.0' } },
  { name: 'admin', root: 'E:/w/admin', branch: 'dev', tags: [], commits: [{ hash: 'b1', at: '2026-10-01', author: '이', subject: '옛 일' }], changelog: null },
];

const facts = (more: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({ repoChanges: async () => repos, myCommits: async () => [], today: () => '2026-11-18', ...more });

describe('rauha 작업 공간 도구', () => {
  it('repo_changes 는 고른 저장소의 커밋·CHANGELOG 를 주고, 본 곳으로 남긴다', async () => {
    const seen: string[] = [];
    const out = await workspaceToolHandlers(facts(), (p) => seen.push(...p)).repo_changes({ repos: ['shop'] });
    expect(out.content[0]!.text).toContain('결제 취소');
    expect(out.content[0]!.text).not.toContain('옛 일');
    expect(seen).toEqual(['E:/w/shop', 'E:/w/shop/CHANGELOG.md']);
  });

  it('맞는 저장소가 없으면 있는 저장소 이름을 알려 주는 오류', async () => {
    const out = await workspaceToolHandlers(facts(), () => undefined).repo_changes({ repos: ['nope'] });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('shop, admin');
  });

  it('since 가 날짜 모양이 아니면 고칠 수 있는 오류', async () => {
    const out = await workspaceToolHandlers(facts(), () => undefined).repo_changes({ since: '어제' });
    expect(out).toMatchObject({ isError: true, content: [{ text: 'since must be a date like 2026-11-01.' }] });
  });

  it('workspace_repos 는 모든 저장소를 한 줄씩 보이고 모두 본 곳으로 남긴다', async () => {
    const seen: string[] = [];
    const out = await workspaceToolHandlers(facts(), (p) => seen.push(...p)).workspace_repos({});
    expect(out.content[0]!.text).toContain('저장소 2개');
    expect(seen).toEqual(['E:/w/shop', 'E:/w/admin']);
  });

  it('my_commits 는 since 가 없으면 지난 근무일부터 모은다', async () => {
    const asked: string[] = [];
    await workspaceToolHandlers(facts({ myCommits: async (s) => (asked.push(s), []) }), () => undefined).my_commits({});
    expect(asked).toEqual(['2026-11-17']);
  });

  it('todo_list 는 할 일 탭의 끝나지 않은 할 일을, 할 일 탭이 없으면 없다고 알린다', async () => {
    expect((await workspaceToolHandlers(facts({ openTodos: async () => ['리뷰'] }), () => undefined).todo_list({})).content[0]!.text).toContain('- 리뷰');
    expect((await workspaceToolHandlers(facts(), () => undefined).todo_list({})).content[0]!.text).toContain('할 일 탭이 없어요');
  });

  it('작업 공간 사실이 있을 때만 도구 묶음에 서버를 더한다', () => {
    const empty = { servers: {}, tools: [] as readonly string[] };
    expect(withWorkspace(empty, undefined, () => undefined)).toBe(empty);
    const added = withWorkspace(empty, facts(), () => undefined);
    expect(Object.keys(added.servers)).toEqual([WORKSPACE_SERVER]);
    expect(added.tools).toContain('mcp__rauha__repo_changes');
  });
});
