import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DomainError } from '../../shared/domain-error.js';
import { RepoDigest } from '../domain/repo-digest.js';
import { Standup } from '../domain/standup.js';
import { WorkspaceToolInput } from '../domain/workspace-tools.js';
import type { WorkspaceFacts } from '../application/workspace-facts.js';

/** 팀원에게 붙이는 rauha 작업 공간 도구 서버 이름. 도구는 mcp__rauha__<이름> 이다. */
export const WORKSPACE_SERVER = 'rauha';
export const WORKSPACE_TOOLS = ['workspace_repos', 'repo_changes', 'my_commits', 'todo_list'] as const;
type WorkspaceToolName = (typeof WORKSPACE_TOOLS)[number];

/** 이 도구를 붙인 팀원에게 더하는 짧은 사용법 */
export const WORKSPACE_GUIDE = `<rauha-tools>
rauha 작업 공간 도구(mcp__rauha__*)가 있습니다. rauha 가 git·파일로 직접 읽어 주므로 빠르고 빠짐이 없습니다.
- 여러 저장소·"모든 레포"를 다룰 때는 git 을 레포마다 돌리지 말고 workspace_repos → repo_changes 부터 부르세요. 결과에 든 저장소는 본 것으로 칩니다.
- 커밋·CHANGELOG·릴리스·변경 내역은 repo_changes(repos, since), 내가 한 일·스탠드업은 my_commits(since), 할 일 탭은 todo_list.
- 도구 결과에 없는 것을 지어내지 마세요. 더 깊은 diff 가 필요할 때만 git -C <root> 를 쓰세요.
</rauha-tools>`;

interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const text = (body: string, error = false): ToolResult => ({ content: [{ type: 'text', text: body }], ...(error ? { isError: true } : {}) });

async function guarded(task: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await task());
  } catch (error) {
    return text(error instanceof DomainError ? error.message : 'rauha could not read the workspace.', true);
  }
}

/**
 * 도구별 처리: 입력 검사(도메인) → rauha 가 읽기 → 글로 만들기(도메인).
 * seen: 도구로 본 저장소 루트·CHANGELOG 를 요청 항목 표의 "연 곳"에 더한다.
 */
export function workspaceToolHandlers(facts: WorkspaceFacts, seen: (paths: readonly string[]) => void): Record<WorkspaceToolName, (args: Record<string, unknown>) => Promise<ToolResult>> {
  return {
    workspace_repos: () =>
      guarded(async () => {
        const repos = await facts.repoChanges();
        seen(repos.map((r) => r.root));
        return RepoDigest.list(repos);
      }),
    repo_changes: (a) =>
      guarded(async () => {
        const names = WorkspaceToolInput.names(a['repos']);
        const since = WorkspaceToolInput.since(a['since']);
        const all = await facts.repoChanges();
        const picked = RepoDigest.pick(all, names, since);
        if (picked.length === 0) throw new DomainError('INVALID_INPUT', `No repository matched. Repositories: ${all.map((r) => r.name).join(', ') || '(none)'}`);
        seen(RepoDigest.seen(picked));
        return RepoDigest.block(picked);
      }),
    my_commits: (a) =>
      guarded(async () => {
        const since = WorkspaceToolInput.since(a['since']) ?? Standup.since(facts.today());
        return Standup.block(since, await facts.myCommits(since));
      }),
    todo_list: () =>
      guarded(async () => {
        if (facts.openTodos === undefined) return '이 화면에는 할 일 탭이 없어요.';
        const open = await facts.openTodos();
        return open.length === 0 ? '할 일 탭에 끝나지 않은 할 일이 없어요.' : `할 일 탭의 끝나지 않은 할 일 ${open.length}개(카드 제목과 안 끝난 체크리스트):\n${open.map((t) => `- ${t}`).join('\n')}`;
      }),
  };
}

const NAMES = { repos: z.array(z.string()).optional().describe('Repository names. Omit for every repository in the workspace.') };
const SINCE = { since: z.string().optional().describe('YYYY-MM-DD. Only commits on or after this day.') };

/** rauha 작업 공간을 팀원이 읽기 전용으로 보는 in-process MCP 서버 */
export function workspaceToolServer(facts: WorkspaceFacts, seen: (paths: readonly string[]) => void): { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] } {
  const h = workspaceToolHandlers(facts, seen);
  const server = createSdkMcpServer({
    name: WORKSPACE_SERVER,
    tools: [
      tool('workspace_repos', 'Every repository in the user\'s workspace (rauha reads git directly): name, path, branch, latest commit, latest tag, CHANGELOG file.', {}, () => h.workspace_repos({})),
      tool('repo_changes', 'Recent commits (all authors, all branches, newest first), tags and the top of CHANGELOG for the chosen repositories (default: all). Use this instead of running git in each repository.', { ...NAMES, ...SINCE }, (a) => h.repo_changes(a)),
      tool('my_commits', 'The user\'s own commits (git user.email), branch and uncommitted file count in every repository since a day (default: last working day). For standups and daily reports.', SINCE, (a) => h.my_commits(a)),
      tool('todo_list', 'Unfinished items in the user\'s rauha todo tab (card titles and unchecked checklist items).', {}, () => h.todo_list({})),
    ],
  });
  return { servers: { [WORKSPACE_SERVER]: server }, tools: WORKSPACE_TOOLS.map((n) => `mcp__${WORKSPACE_SERVER}__${n}`) };
}

/** 도구 묶음에 작업 공간 서버를 더한다. 작업 공간 사실이 없으면 그대로. */
export function withWorkspace<T extends { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] }>(kits: T, facts: WorkspaceFacts | undefined, seen: (paths: readonly string[]) => void): T {
  if (facts === undefined) return kits;
  const added = workspaceToolServer(facts, seen);
  return { ...kits, servers: { ...kits.servers, ...added.servers }, tools: [...kits.tools, ...added.tools] };
}
