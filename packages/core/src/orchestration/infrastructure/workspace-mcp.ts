import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z, type ZodRawShape } from 'zod';
import { DomainError } from '../../shared/domain-error.js';
import { RepoDigest } from '../domain/repo-digest.js';
import { Standup } from '../domain/standup.js';
import { matchRepos, WorkspaceToolInput } from '../domain/workspace-tools.js';
import { WorkspaceText } from '../domain/workspace-text.js';
import type { WorkspaceFacts, WorkspaceRepo } from '../application/workspace-facts.js';

/** 팀원에게 붙이는 rauha 작업 공간 도구 서버 이름. 도구는 mcp__rauha__<이름> 이다. */
export const WORKSPACE_SERVER = 'rauha';
export const WORKSPACE_TOOLS = ['workspace_repos', 'repo_changes', 'my_commits', 'todo_list', 'repo_status', 'search_repos', 'file_history', 'show_commit', 'ci_runs', 'ci_log', 'past_work'] as const;
export type WorkspaceToolName = (typeof WORKSPACE_TOOLS)[number];

const SEARCH_LIMIT = 150;

/** 이 도구를 붙인 팀원에게 더하는 짧은 사용법 */
export const WORKSPACE_GUIDE = `<rauha-tools>
rauha 작업 공간 도구(mcp__rauha__*)가 있습니다. rauha 가 git·파일·GitHub 를 직접 읽어 주므로 빠르고 빠짐이 없습니다. 레포마다 Bash 로 git 을 돌리기 전에 이것부터 쓰세요.
- 어떤 레포가 있나: workspace_repos. 커밋·CHANGELOG·릴리스·변경 내역: repo_changes(repos, since). 커밋 하나 자세히: show_commit.
- push·pull 안 한 것, 커밋 안 한 파일, 브랜치: repo_status. 내가 한 일·스탠드업: my_commits(since).
- 여러 레포에서 코드 찾기: search_repos(pattern, repos, glob). 파일이 언제 왜 바뀌었나: file_history.
- CI 상태: ci_runs, 실패 원인: ci_log(repo, run_id). 할 일 탭: todo_list. 예전에 rauha 가 한 일·결정: past_work(query).
- 도구가 본 저장소는 본 것으로 칩니다. 도구 결과에 없는 것을 지어내지 마세요.
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

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * 도구별 처리: 입력 검사(도메인) → rauha 가 읽기 → 글로 만들기(도메인). 사실이 없는 도구는 빠진다.
 * seen: 도구로 본 저장소 루트·파일을 요청 항목 표의 "연 곳"에 더한다.
 */
export function workspaceToolHandlers(facts: WorkspaceFacts, seen: (paths: readonly string[]) => void): Partial<Record<WorkspaceToolName, Handler>> {
  const one = (name: unknown): WorkspaceRepo => {
    const wanted = WorkspaceToolInput.repo(name);
    const all = facts.repos();
    const hit = matchRepos(all, [wanted])[0];
    if (hit === undefined) throw new DomainError('INVALID_INPUT', `No repository named "${wanted}". Repositories: ${all.map((r) => r.name).join(', ') || '(none)'}`);
    return hit;
  };
  const some = (names: unknown): WorkspaceRepo[] => {
    const all = facts.repos();
    const picked = matchRepos(all, WorkspaceToolInput.names(names));
    if (picked.length === 0) throw new DomainError('INVALID_INPUT', `No repository matched. Repositories: ${all.map((r) => r.name).join(', ') || '(none)'}`);
    return picked;
  };
  const handlers: Partial<Record<WorkspaceToolName, Handler>> = {
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
  };
  const { openTodos, repoStatus, search, fileHistory, showCommit, ciRuns, ciLog, pastWork } = facts;
  if (openTodos !== undefined)
    handlers.todo_list = () =>
      guarded(async () => {
        const open = await openTodos();
        return open.length === 0 ? '할 일 탭에 끝나지 않은 할 일이 없어요.' : `할 일 탭의 끝나지 않은 할 일 ${open.length}개(카드 제목과 안 끝난 체크리스트):\n${open.map((t) => `- ${t}`).join('\n')}`;
      });
  if (repoStatus !== undefined)
    handlers.repo_status = (a) =>
      guarded(async () => {
        const repos = some(a['repos']);
        seen(repos.map((r) => r.root));
        return WorkspaceText.status(await repoStatus(repos));
      });
  if (search !== undefined)
    handlers.search_repos = (a) =>
      guarded(async () => {
        const pattern = WorkspaceToolInput.pattern(a['pattern']);
        const glob = WorkspaceToolInput.glob(a['glob']);
        const repos = some(a['repos']);
        const hits = await search(repos, pattern, { fixed: a['regex'] !== true, glob, limit: SEARCH_LIMIT + 1 });
        seen(repos.map((r) => r.root));
        return WorkspaceText.hits(pattern, hits, repos.length, SEARCH_LIMIT);
      });
  if (fileHistory !== undefined)
    handlers.file_history = (a) =>
      guarded(async () => {
        const repo = one(a['repo']);
        const path = WorkspaceToolInput.path(a['path']);
        seen([`${repo.root.replace(/[\\/]+$/, '')}/${path}`]);
        return WorkspaceText.history(repo.name, path, await fileHistory(repo, path));
      });
  if (showCommit !== undefined)
    handlers.show_commit = (a) =>
      guarded(async () => {
        const repo = one(a['repo']);
        const rev = WorkspaceToolInput.revision(a['commit']);
        const shown = await showCommit(repo, rev);
        if (shown === null) throw new DomainError('INVALID_INPUT', `${repo.name} has no commit "${rev}".`);
        seen([repo.root]);
        return WorkspaceText.commit(repo.name, shown);
      });
  if (ciRuns !== undefined)
    handlers.ci_runs = (a) =>
      guarded(async () => {
        const got = await ciRuns(some(a['repos']));
        return WorkspaceText.ci(got.runs, got.notGithub, got.signedIn);
      });
  if (ciLog !== undefined)
    handlers.ci_log = (a) =>
      guarded(async () => {
        const repo = one(a['repo']);
        const runId = WorkspaceToolInput.runId(a['run_id']);
        return WorkspaceText.ciLog(repo.name, runId, await ciLog(repo, runId));
      });
  if (pastWork !== undefined)
    handlers.past_work = (a) =>
      guarded(async () => {
        const query = WorkspaceToolInput.pattern(a['query']);
        const found = await pastWork(query);
        return found === '' ? `"${query}"에 대해 rauha 가 기억하는 지난 작업이 없어요.` : found;
      });
  return handlers;
}

const REPOS = { repos: z.array(z.string()).optional().describe('Repository names. Omit for every repository in the workspace.') };
const SINCE = { since: z.string().optional().describe('YYYY-MM-DD. Only commits on or after this day.') };
const REPO = { repo: z.string().describe('One repository name from workspace_repos.') };

const SPECS: Readonly<Record<WorkspaceToolName, { readonly description: string; readonly shape: ZodRawShape }>> = {
  workspace_repos: { description: "Every repository in the user's workspace (rauha reads git directly): name, path, branch, latest commit, latest tag, CHANGELOG file.", shape: {} },
  repo_changes: { description: 'Recent commits (all authors, all branches, newest first), tags and the top of CHANGELOG for the chosen repositories (default: all). Use this instead of running git in each repository.', shape: { ...REPOS, ...SINCE } },
  my_commits: { description: "The user's own commits (git user.email), branch and uncommitted file count in every repository since a day (default: last working day). For standups and daily reports.", shape: SINCE },
  todo_list: { description: "Unfinished items in the user's rauha todo tab (card titles and unchecked checklist items).", shape: {} },
  repo_status: { description: 'For each repository: unpushed and unpulled commits, uncommitted files, stashes and recently used branches.', shape: REPOS },
  search_repos: {
    description: 'Search tracked files of many repositories at once (git grep; secret files are skipped). Literal text by default.',
    shape: { pattern: z.string().describe('Text to find'), regex: z.boolean().optional().describe('true to treat pattern as an extended regular expression'), glob: z.string().optional().describe('Only files matching this, e.g. *.ts or src/**'), ...REPOS },
  },
  file_history: { description: 'Commits that changed one file (follows renames, newest first): who, when, why.', shape: { ...REPO, path: z.string().describe('Path relative to the repository root') } },
  show_commit: { description: 'One commit: message, changed files and diff (long diffs are cut; secret files left out).', shape: { ...REPO, commit: z.string().describe('Commit hash or tag') } },
  ci_runs: { description: 'Recent GitHub Actions runs of each repository (status, workflow, branch, commit).', shape: REPOS },
  ci_log: { description: 'Failed jobs of one GitHub Actions run and the end of their logs.', shape: { ...REPO, run_id: z.number().int().describe('Run number from ci_runs') } },
  past_work: { description: 'What rauha remembers from earlier work and answers in this repository, with the decisions made then.', shape: { query: z.string().describe('What to look for') } },
};

/** rauha 작업 공간을 팀원이 읽기 전용으로 보는 in-process MCP 서버. 사실이 있는 도구만 붙는다. */
export function workspaceToolServer(facts: WorkspaceFacts, seen: (paths: readonly string[]) => void): { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] } {
  const handlers = workspaceToolHandlers(facts, seen);
  const names = WORKSPACE_TOOLS.filter((n) => handlers[n] !== undefined);
  const server = createSdkMcpServer({
    name: WORKSPACE_SERVER,
    tools: names.map((n) => tool(n, SPECS[n].description, SPECS[n].shape, (a) => handlers[n]!(a as Record<string, unknown>))),
  });
  return { servers: { [WORKSPACE_SERVER]: server }, tools: names.map((n) => `mcp__${WORKSPACE_SERVER}__${n}`) };
}

/** 도구 묶음에 작업 공간 서버를 더한다. 작업 공간 사실이 없으면 그대로. */
export function withWorkspace<T extends { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] }>(kits: T, facts: WorkspaceFacts | undefined, seen: (paths: readonly string[]) => void): T {
  if (facts === undefined) return kits;
  const added = workspaceToolServer(facts, seen);
  return { ...kits, servers: { ...kits.servers, ...added.servers }, tools: [...kits.tools, ...added.tools] };
}
