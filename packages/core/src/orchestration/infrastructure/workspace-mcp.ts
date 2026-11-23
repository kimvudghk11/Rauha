import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z, type ZodRawShape } from 'zod';
import { DomainError } from '../../shared/domain-error.js';
import { RepoDigest } from '../domain/repo-digest.js';
import { Standup } from '../domain/standup.js';
import { matchRepos, WORKSPACE_TOOL_NAMES, WorkspaceToolInput, type WorkspaceToolName } from '../domain/workspace-tools.js';
import { WorkspaceText } from '../domain/workspace-text.js';
import type { WorkspaceFacts, WorkspaceRepo } from '../application/workspace-facts.js';

/** 팀원에게 붙이는 rauha 작업 공간 도구 서버 이름. 도구는 mcp__rauha__<이름> 이다. */
export const WORKSPACE_SERVER = 'rauha';
export const WORKSPACE_TOOLS = WORKSPACE_TOOL_NAMES;
export type { WorkspaceToolName };

/** 검색 한 번에 돌려주는 줄 수. 돌려준 줄은 팀원의 다음 턴마다 다시 읽힌다(2026-11-22 실측: 깊은 답 한 번에 검색 7번) — 넘으면 좁혀 다시 찾게 한다 */
const SEARCH_LIMIT = 60;

/** 도구마다 언제 쓰는지 한 줄(붙은 도구만 사용법에 싣는다) */
const WHEN: Readonly<Record<WorkspaceToolName, string>> = {
  workspace_repos: '어떤 레포가 있나',
  repo_changes: '커밋·CHANGELOG·릴리스·변경 내역(repos, since)',
  my_commits: '내가 한 일·스탠드업(since)',
  todo_list: '할 일 탭',
  repo_status: 'push·pull 안 한 것, 커밋 안 한 파일, 브랜치',
  search_repos: '여러 레포에서 코드 찾기(pattern, repos, glob)',
  file_history: '파일이 언제·누가·왜 바뀌었나',
  show_commit: '커밋 하나 자세히(diff)',
  ci_runs: 'CI 상태',
  ci_log: 'CI 실패 원인(repo, run_id)',
  past_work: '예전에 rauha 가 한 일·결정(query)',
  company_notes: '회사 부서가 이미 정한 것(기획·디자인·마케팅·품질·운영)',
  dependencies: '레포별 의존성과 버전(name 으로 어느 레포가 쓰나)',
  read_spreadsheet: 'CSV·TSV·엑셀(xlsx) 표 읽기, 숫자 열 합계는 rauha 가 계산(repo, path)',
  add_todo: '사용자가 할 일 탭에 넣어 달라고 할 때만(title, note, checklist)',
  remember: '사용자가 "라우하에 저장·기억"해 달라고 할 때 — 작업 폴더에 파일을 만들지 말고 이것(title, text, source)',
  keep_rule: '사용자가 이 룰 파일을 항상 기준으로 삼으라고 할 때(path: 절대 경로, 원본은 읽기만)',
};

/** 이 도구들을 붙인 팀원에게 더하는 짧은 사용법. 붙은 도구가 없으면 빈 글 */
export function workspaceGuide(tools: readonly WorkspaceToolName[]): string {
  if (tools.length === 0) return '';
  return [
    '<rauha-tools>',
    'rauha 작업 공간 도구(mcp__rauha__*)가 있습니다. rauha 가 git·파일·GitHub 를 직접 읽어 주므로 빠르고 빠짐이 없습니다. 레포마다 Bash 로 git 을 돌리거나 파일을 하나씩 열기 전에 이것부터 쓰세요.',
    ...tools.map((t) => `- ${t}: ${WHEN[t]}`),
    '도구가 본 저장소는 본 것으로 칩니다. 도구 결과에 없는 것을 지어내지 마세요.',
    '</rauha-tools>',
  ].join('\n');
}

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

/** rauha 앱에 쓰는 도구: 막힌 이유(규칙)를 그대로 돌려줘 Claude 가 고쳐 다시 부르게 한다 */
async function acted(task: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await task());
  } catch (error) {
    return text(error instanceof Error && error.message !== '' ? error.message.slice(0, 300) : 'rauha could not save it.', true);
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
  const { openTodos, repoStatus, search, fileHistory, showCommit, ciRuns, ciLog, pastWork, companyNotes, dependencies, readSpreadsheet, addTodo, remember, keepRule } = facts;
  if (addTodo !== undefined)
    handlers.add_todo = (a) => acted(async () => addTodo({ title: WorkspaceToolInput.title(a['title']), note: WorkspaceToolInput.body(a['note'], 2000), checklist: WorkspaceToolInput.checklist(a['checklist']) }));
  if (remember !== undefined)
    handlers.remember = (a) =>
      acted(async () => {
        const body = WorkspaceToolInput.body(a['text']);
        if (body.trim() === '') throw new DomainError('INVALID_INPUT', 'text is empty.');
        const source = a['source'] === undefined || a['source'] === null || a['source'] === '' ? null : WorkspaceToolInput.body(a['source'], 500);
        return remember({ title: WorkspaceToolInput.title(a['title']), text: body, source });
      });
  if (keepRule !== undefined) handlers.keep_rule = (a) => acted(async () => keepRule(WorkspaceToolInput.absolutePath(a['path'])));
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
  if (companyNotes !== undefined)
    handlers.company_notes = () =>
      guarded(async () => (await companyNotes()) ?? '회사 부서가 아직 정한 것이 없어요(기획·디자인·마케팅·품질·운영 부서에 일을 맡긴 적이 없음).');
  if (dependencies !== undefined)
    handlers.dependencies = (a) =>
      guarded(async () => {
        const repos = some(a['repos']);
        const name = a['name'] === undefined || a['name'] === null || a['name'] === '' ? null : WorkspaceToolInput.pattern(a['name']);
        const manifests = await dependencies(repos);
        seen(manifests.map((m) => `${(repos.find((r) => r.name === m.repo)?.root ?? m.repo).replace(/[\\/]+$/, '')}/${m.path}`));
        return WorkspaceText.dependencies(manifests, repos.length, name);
      });
  if (readSpreadsheet !== undefined)
    handlers.read_spreadsheet = (a) =>
      guarded(async () => {
        const repo = one(a['repo']);
        const path = WorkspaceToolInput.path(a['path']);
        const sheets = await readSpreadsheet(repo, path).catch((error: unknown) => {
          throw new DomainError('INVALID_INPUT', `${repo.name}/${path}: ${error instanceof Error ? error.message : 'could not read the file'}`);
        });
        seen([`${repo.root.replace(/[\\/]+$/, '')}/${path}`]);
        return WorkspaceText.spreadsheet(`${repo.name}/${path}`, sheets);
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
  company_notes: { description: 'What the company departments (planning, design, marketing, quality, operations) already decided: their latest results.', shape: {} },
  read_spreadsheet: { description: 'Read a CSV, TSV or Excel (.xlsx) file in a repository as tab-separated rows (first 200 rows per sheet). Totals of numeric columns are computed by rauha over all rows: use them instead of adding numbers yourself.', shape: { ...REPO, path: z.string().describe('Path of the file relative to the repository root') } },
  add_todo: {
    description: "Add one card to the user's rauha todo tab (not a file). Use only when the user asks to put something in the todo tab. Several to-dos go into one card as a checklist.",
    shape: { title: z.string().describe('Card title'), note: z.string().optional().describe('Details'), checklist: z.array(z.string()).optional().describe('Checklist items, when there are several to-dos') },
  },
  remember: {
    description: "Save text into rauha's own memory (rauha's data folder, not the project). Use when the user asks to save or remember something in rauha. Every later rauha session sees it. Saving again with the same title replaces it.",
    shape: { title: z.string().describe('Short title'), text: z.string().describe('What to remember: the content itself or a faithful summary'), source: z.string().optional().describe('File it came from, if any') },
  },
  keep_rule: {
    description: 'Make a rule file apply to every future rauha session as a top-priority rule (like an @import in CLAUDE.md). rauha reads the file each time and never edits it. Use when the user says to always follow that file.',
    shape: { path: z.string().describe('Absolute path of the rule file') },
  },
  dependencies: { description: 'Dependencies declared in each repository (package.json, go.mod, requirements.txt, build.gradle, pom.xml) with versions as written. Use name to find which repositories use a library.', shape: { ...REPOS, name: z.string().optional().describe('Only dependencies whose name contains this') } },
};

/**
 * rauha 작업 공간을 팀원이 읽기 전용으로 보는 in-process MCP 서버. 이 역할에 허락된(allowed) 도구 중 사실이 있는 것만 붙는다.
 * names: 실제로 붙은 도구(사용법 글에 쓴다).
 */
export function workspaceToolServer(facts: WorkspaceFacts, seen: (paths: readonly string[]) => void, allowed: readonly WorkspaceToolName[] = WORKSPACE_TOOLS): { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[]; readonly names: readonly WorkspaceToolName[] } {
  const handlers = workspaceToolHandlers(facts, seen);
  const names = WORKSPACE_TOOLS.filter((n) => handlers[n] !== undefined && allowed.includes(n));
  const server = createSdkMcpServer({
    name: WORKSPACE_SERVER,
    tools: names.map((n) => tool(n, SPECS[n].description, SPECS[n].shape, (a) => handlers[n]!(a as Record<string, unknown>))),
  });
  return { servers: { [WORKSPACE_SERVER]: server }, tools: names.map((n) => `mcp__${WORKSPACE_SERVER}__${n}`), names };
}

/**
 * 도구 묶음에 작업 공간 서버를 더한다. 사실이 없거나 이 역할에 붙을 도구가 없으면 그대로(guide 도 빈 글).
 * guide: 시스템 프롬프트 끝에 붙일 사용법.
 */
export function withWorkspace<T extends { readonly servers: Record<string, McpServerConfig>; readonly tools: readonly string[] }>(kits: T, facts: WorkspaceFacts | undefined, seen: (paths: readonly string[]) => void, allowed: readonly WorkspaceToolName[] = WORKSPACE_TOOLS): T & { readonly guide: string } {
  if (facts === undefined || allowed.length === 0) return { ...kits, guide: '' };
  const added = workspaceToolServer(facts, seen, allowed);
  if (added.names.length === 0) return { ...kits, guide: '' };
  return { ...kits, servers: { ...kits.servers, ...added.servers }, tools: [...kits.tools, ...added.tools], guide: workspaceGuide(added.names) };
}
