import { describe, expect, it } from 'vitest';
import type { DigestRepo } from '../domain/repo-digest.js';
import type { WorkspaceFacts } from '../application/workspace-facts.js';
import { WorkspaceToolAccess } from '../domain/workspace-tools.js';
import { WORKSPACE_SERVER, withWorkspace, workspaceToolHandlers, type WorkspaceToolName } from './workspace-mcp.js';

const repos: DigestRepo[] = [
  { name: 'shop', root: 'E:/w/shop', branch: 'main', tags: [], commits: [{ hash: 'a1', at: '2026-11-17', author: '김', subject: '결제 취소' }], changelog: { path: 'CHANGELOG.md', head: '## 1.0' } },
  { name: 'admin', root: 'E:/w/admin', branch: 'dev', tags: [], commits: [{ hash: 'b1', at: '2026-10-01', author: '이', subject: '옛 일' }], changelog: null },
];

const facts = (more: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({ repos: () => repos, repoChanges: async () => repos, myCommits: async () => [], today: () => '2026-11-18', ...more });
const run = async (f: WorkspaceFacts, name: WorkspaceToolName, args: Record<string, unknown> = {}, seen: (p: readonly string[]) => void = () => undefined) => (await workspaceToolHandlers(f, seen)[name]!(args)).content[0]!.text;

describe('rauha 작업 공간 도구', () => {
  it('repo_changes 는 고른 저장소의 커밋·CHANGELOG 를 주고, 본 곳으로 남긴다', async () => {
    const seen: string[] = [];
    const out = await workspaceToolHandlers(facts(), (p) => seen.push(...p)).repo_changes!({ repos: ['shop'] });
    expect(out.content[0]!.text).toContain('결제 취소');
    expect(out.content[0]!.text).not.toContain('옛 일');
    expect(seen).toEqual(['E:/w/shop', 'E:/w/shop/CHANGELOG.md']);
  });

  it('맞는 저장소가 없으면 있는 저장소 이름을 알려 주는 오류', async () => {
    const out = await workspaceToolHandlers(facts(), () => undefined).repo_changes!({ repos: ['nope'] });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('shop, admin');
  });

  it('since 가 날짜 모양이 아니면 고칠 수 있는 오류', async () => {
    const out = await workspaceToolHandlers(facts(), () => undefined).repo_changes!({ since: '어제' });
    expect(out).toMatchObject({ isError: true, content: [{ text: 'since must be a date like 2026-11-01.' }] });
  });

  it('workspace_repos 는 모든 저장소를 한 줄씩 보이고 모두 본 곳으로 남긴다', async () => {
    const seen: string[] = [];
    const out = await workspaceToolHandlers(facts(), (p) => seen.push(...p)).workspace_repos!({});
    expect(out.content[0]!.text).toContain('저장소 2개');
    expect(seen).toEqual(['E:/w/shop', 'E:/w/admin']);
  });

  it('my_commits 는 since 가 없으면 지난 근무일부터 모은다', async () => {
    const asked: string[] = [];
    await workspaceToolHandlers(facts({ myCommits: async (s) => (asked.push(s), []) }), () => undefined).my_commits!({});
    expect(asked).toEqual(['2026-11-17']);
  });

  it('add_todo 는 할 일 탭에 카드 하나(여럿이면 체크리스트)를 넣고 결과 한 줄을 돌려준다', async () => {
    const added: unknown[] = [];
    const out = await run(facts({ addTodo: async (c) => (added.push(c), '할 일 탭에 넣었어요') }), 'add_todo', { title: ' 배포 전 확인 ', checklist: ['VPN', ' ', 'DB'] });
    expect(out).toBe('할 일 탭에 넣었어요');
    expect(added).toEqual([{ title: '배포 전 확인', note: '', checklist: ['VPN', 'DB'] }]);
  });

  it('remember 는 rauha 기억에 글을 남기고, 빈 글이면 고칠 수 있는 오류', async () => {
    const saved: unknown[] = [];
    const f = facts({ remember: async (n) => (saved.push(n), 'rauha 기억에 남겼어요') });
    expect(await run(f, 'remember', { title: 'memory.md', text: '회사 VPN 은 …', source: '/Users/me/memory.md' })).toBe('rauha 기억에 남겼어요');
    expect(saved).toEqual([{ title: 'memory.md', text: '회사 VPN 은 …', source: '/Users/me/memory.md' }]);
    const bad = await workspaceToolHandlers(f, () => undefined).remember!({ title: 'x', text: '  ' });
    expect(bad.isError).toBe(true);
  });

  it('keep_rule 은 절대 경로만 받고, 막힌 이유(비밀 파일 등)를 그대로 돌려준다', async () => {
    const f = facts({ keepRule: async (p) => (p.endsWith('.env') ? Promise.reject(new Error('That file may hold secrets')) : `항상 따를 룰로 남겼어요: ${p}`) });
    expect(await run(f, 'keep_rule', { path: '/Users/me/repos/rules/RULES.md' })).toContain('RULES.md');
    expect((await workspaceToolHandlers(f, () => undefined).keep_rule!({ path: 'RULES.md' })).isError).toBe(true);
    const secret = await workspaceToolHandlers(f, () => undefined).keep_rule!({ path: '/a/.env' });
    expect(secret).toMatchObject({ isError: true, content: [{ text: 'That file may hold secrets' }] });
  });

  it('rauha 에 쓰는 도구는 메인 채팅 Claude 에게만 붙는다', () => {
    const kits = (role: Parameters<typeof WorkspaceToolAccess.toolsFor>[0]) => withWorkspace({ servers: {}, tools: [] }, facts({ addTodo: async () => '', remember: async () => '', keepRule: async () => '' }), () => undefined, WorkspaceToolAccess.toolsFor(role)).tools;
    expect(kits('direct')).toEqual(expect.arrayContaining(['mcp__rauha__add_todo', 'mcp__rauha__remember', 'mcp__rauha__keep_rule']));
    expect(kits('answerer').some((t) => /add_todo|remember|keep_rule/.test(t))).toBe(false);
    expect(kits('implementer').some((t) => /add_todo|remember|keep_rule/.test(t))).toBe(false);
  });

  it('todo_list 는 할 일 탭의 끝나지 않은 할 일을 보이고, 할 일 탭이 없으면 도구 자체가 붙지 않는다', async () => {
    expect(await run(facts({ openTodos: async () => ['리뷰'] }), 'todo_list')).toContain('- 리뷰');
    expect(workspaceToolHandlers(facts(), () => undefined).todo_list).toBeUndefined();
  });

  it('읽을 수 있는 사실이 있는 도구만 서버에 붙는다(설명 글만큼 한도를 아낀다)', () => {
    const base = withWorkspace({ servers: {}, tools: [] as readonly string[] }, facts(), () => undefined);
    expect(base.tools).toEqual(['mcp__rauha__workspace_repos', 'mcp__rauha__repo_changes', 'mcp__rauha__my_commits']);
    const more = withWorkspace({ servers: {}, tools: [] as readonly string[] }, facts({ ciRuns: async () => ({ runs: [], notGithub: [], signedIn: true }) }), () => undefined);
    expect(more.tools).toContain('mcp__rauha__ci_runs');
  });

  it('역할에 허락된 도구만 붙고, 사용법 글에는 붙은 도구만 실린다', () => {
    const f = facts({ pastWork: async () => '', ciRuns: async () => ({ runs: [], notGithub: [], signedIn: true }) });
    const added = withWorkspace({ servers: {}, tools: [] as readonly string[] }, f, () => undefined, ['past_work', 'search_repos']);
    expect(added.tools).toEqual(['mcp__rauha__past_work']); // search 사실이 없으니 search_repos 는 빠진다
    expect(added.guide).toContain('- past_work:');
    expect(added.guide).not.toContain('ci_runs');
    expect(withWorkspace({ servers: {}, tools: [] as readonly string[] }, f, () => undefined, []).guide).toBe('');
  });

  it('company_notes 는 부서가 정한 것을, 없으면 없다고 / dependencies 는 이름으로 거른다', async () => {
    expect(await run(facts({ companyNotes: async () => null }), 'company_notes')).toContain('아직 정한 것이 없어요');
    const deps = facts({ dependencies: async () => [{ repo: 'shop', path: 'package.json', kind: 'npm', deps: [{ name: 'axios', version: '1.6.0', dev: false }] }] });
    const seen: string[] = [];
    expect(await run(deps, 'dependencies', { name: 'axios' }, (p) => seen.push(...p))).toContain('- axios 1.6.0');
    expect(seen).toEqual(['E:/w/shop/package.json']);
  });

  it('search_repos 는 고른 저장소에서 글 그대로 찾고(기본), 찾은 저장소를 본 곳으로 남긴다', async () => {
    const calls: { names: string[]; pattern: string; fixed: boolean; glob: string | null }[] = [];
    const seen: string[] = [];
    const f = facts({ search: async (rs, pattern, o) => (calls.push({ names: rs.map((r) => r.name), pattern, fixed: o.fixed, glob: o.glob }), [{ repo: 'shop', path: 'src/pay.ts', line: 3, text: 'refund()' }]) });
    const out = await run(f, 'search_repos', { pattern: 'refund(', repos: ['shop'], glob: '*.ts' }, (p) => seen.push(...p));
    expect(calls).toEqual([{ names: ['shop'], pattern: 'refund(', fixed: true, glob: '*.ts' }]);
    expect(out).toContain('shop/src/pay.ts:3: refund()');
    expect(seen).toEqual(['E:/w/shop']);
  });

  it('file_history·show_commit 은 저장소 이름을 루트로 바꿔 묻고, 없는 이름이면 있는 이름을 알려 준다', async () => {
    const f = facts({ fileHistory: async (r, p) => [{ hash: 'c1', at: '2026-11-01', author: '김', subject: `${r.root}:${p}` }], showCommit: async (_r, rev) => (rev === 'c1' ? 'commit c1\n결제' : null) });
    expect(await run(f, 'file_history', { repo: 'shop', path: 'src\\pay.ts' })).toContain('E:/w/shop:src/pay.ts');
    expect(await run(f, 'show_commit', { repo: 'shop', commit: 'c1' })).toContain('■ shop\ncommit c1');
    expect(await run(f, 'show_commit', { repo: 'shop', commit: 'zz9' })).toContain('has no commit');
    expect(await run(f, 'file_history', { repo: 'nope', path: 'a' })).toContain('Repositories: shop, admin');
  });

  it('ci_log 는 실행 번호로 실패한 작업 로그를, past_work 는 기억이 없으면 없다고 알린다', async () => {
    const f = facts({ ciLog: async (_r, id) => [{ job: 'test', lines: [`#${id} expected 1`] }], pastWork: async () => '' });
    expect(await run(f, 'ci_log', { repo: 'shop', run_id: 42 })).toContain('#42 expected 1');
    expect(await run(f, 'past_work', { query: '환불' })).toContain('기억하는 지난 작업이 없어요');
  });

  it('작업 공간 사실이 있을 때만 도구 묶음에 서버를 더한다', () => {
    const empty = { servers: {}, tools: [] as readonly string[] };
    expect(withWorkspace(empty, undefined, () => undefined)).toEqual({ ...empty, guide: '' });
    const added = withWorkspace(empty, facts(), () => undefined);
    expect(Object.keys(added.servers)).toEqual([WORKSPACE_SERVER]);
    expect(added.tools).toContain('mcp__rauha__repo_changes');
  });
});

describe('rauha 작업 공간 도구 — 표 읽기', () => {
  it('read_spreadsheet 는 저장소 안 경로의 표를 읽어 합계까지 보이고, 못 읽으면 이유를 알린다', async () => {
    const f = facts({
      readSpreadsheet: async (_r, p) => {
        if (p === '.env') throw new Error('비밀 파일이라 읽지 않아요');
        return [{ name: 'Sheet1', rows: [['서비스', '비용'], ['EC2', '120.5'], ['S3', '9.5']] }];
      },
    });
    const seen: string[] = [];
    const out = await workspaceToolHandlers(f, (p) => seen.push(...p)).read_spreadsheet!({ repo: 'shop', path: 'billing/oct.csv' });
    expect(out.content[0]!.text).toContain('- 비용: 합계 130');
    expect(seen).toEqual(['E:/w/shop/billing/oct.csv']);
    const bad = await workspaceToolHandlers(f, () => undefined).read_spreadsheet!({ repo: 'shop', path: '.env' });
    expect(bad).toMatchObject({ isError: true, content: [{ text: 'shop/.env: 비밀 파일이라 읽지 않아요' }] });
  });
});
