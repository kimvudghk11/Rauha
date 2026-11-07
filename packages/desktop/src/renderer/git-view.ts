import type { GitArg, GitData, GitFn, GitResult, Overview } from '../shared/git-api.js';
import type { RepoRow } from '../shared/ipc.js';
import { ProtectedBranches } from '../shared/git-guard.js';
import { el } from './dom.js';
import { buildChanges } from './git-changes-view.js';
import { buildBranches, buildConflicts, buildHistory } from './git-lists-view.js';
import { askDialog, type GitCtx } from './git-common.js';
import { syncChips } from './git-format.js';

type ViewId = 'changes' | 'branches' | 'history' | 'conflicts';
interface SubView {
  readonly root: HTMLElement;
  refresh(): Promise<void>;
}

const VIEW_LABEL: Readonly<Record<ViewId, string>> = { changes: '변경', branches: '브랜치', history: '히스토리', conflicts: '충돌' };
const REMEMBER = 'rauha.git.repo';

const remembered = (): string | null => {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
};

/** 인자 없는 함수도 같은 모양으로 부르게 하는 모양 맞추기 */
type CallFn = <K extends GitFn>(fn: K, arg: GitArg<K>) => Promise<GitData<K> | null>;

/**
 * git 탭(GitHub Desktop 같은 기능). 모델 호출 없이 순수 git만 쓴다.
 * 레포를 고르고, 변경·브랜치·히스토리·충돌 화면을 오간다. 화면 열림·창 포커스·되돌아올 때마다 상태를 다시 읽는다.
 */
export function buildGit(listRepos: () => Promise<readonly RepoRow[]>, protectedNames: () => Promise<readonly string[]>, extra: (ctx: GitCtx) => Partial<Record<ViewId, SubView>> = () => ({})) {
  const root = el('section', 'git');
  const head = el('div', 'ghead');
  const bar = el('div', 'gbar');
  const msg = el('div', 'gmsg');
  const body = el('div', 'gbody');
  root.append(head, bar, msg, body);

  let repos: readonly RepoRow[] = [];
  let repo: string | null = null;
  let overview: Overview | null = null;
  let current: ViewId = 'changes';
  let protectedList = ProtectedBranches.of([]);
  const views: Partial<Record<ViewId, SubView>> = {};
  let busy = false;

  const say = (text: string, bad = false) => {
    msg.textContent = text;
    msg.className = `gmsg${text === '' ? '' : bad ? ' bad' : ' ok'}`;
  };

  const callRaw = async <K extends GitFn>(fn: K, arg: GitArg<K>, confirmed = false): Promise<GitResult<GitData<K>>> => {
    const api = window.rauha.git[fn] as unknown as (r: string, a: unknown) => Promise<GitResult<GitData<K>>>;
    return api(repo ?? '', confirmed ? { ...(arg as object), confirmed: true } : (arg ?? {}));
  };
  const call: CallFn = async (fn, arg) => {
    let r = await callRaw(fn, arg);
    if (!r.ok && r.code === 'PROTECTED') {
      const a = await askDialog({ title: '보호 브랜치예요', body: r.error, okLabel: '그래도 진행', danger: true });
      if (!a.ok) return null;
      r = await callRaw(fn, arg, true);
    }
    if (!r.ok) {
      say(r.error, true);
      return null;
    }
    const d = r.data as { message?: unknown } | null;
    if (typeof d?.message === 'string' && fn !== 'commit') say(d.message);
    return r.data;
  };

  const ctx: GitCtx = {
    root: () => repo ?? '',
    call,
    say,
    ask: askDialog,
    changed: () => loadHeader(),
    goto: (v) => void open(v),
    isProtected: (n) => protectedList.has(n),
  };

  const sub = (id: ViewId): SubView => {
    const found = views[id] ?? (id === 'changes' ? buildChanges(ctx) : id === 'branches' ? buildBranches(ctx) : id === 'history' ? buildHistory(ctx) : buildConflicts(ctx));
    if (found === undefined) {
      const stub = { root: el('div', 'dim pad', '준비 중이에요.'), refresh: async () => {} };
      return (views[id] = stub);
    }
    return (views[id] = found);
  };

  async function loadHeader(): Promise<void> {
    if (repo === null) return;
    const o = await callRaw('overview', undefined as never);
    if (!o.ok) {
      say(o.error, true);
      return;
    }
    overview = o.data;
    renderHead();
  }

  function renderHead(): void {
    head.replaceChildren();
    const select = el('select', 'gselect');
    const sorted = [...repos].sort((a, b) => (b.status?.changed ?? 0) - (a.status?.changed ?? 0) || a.name.localeCompare(b.name));
    for (const r of sorted) {
      const o = el('option', undefined, `${r.name}${r.status !== null && r.status.changed > 0 ? ` · 변경 ${r.status.changed}` : ''}`);
      o.value = r.root;
      o.selected = r.root === repo;
      select.appendChild(o);
    }
    select.addEventListener('change', () => void pickRepo(select.value));
    head.appendChild(select);
    if (overview === null) return;
    const branch = el('button', 'gbranch', `⎇ ${overview.branch ?? '(분리된 HEAD)'}`);
    branch.title = '브랜치 보기';
    branch.addEventListener('click', () => void open('branches'));
    head.append(branch);
    for (const c of syncChips(overview.ahead, overview.behind)) head.appendChild(el('span', `chip${c.startsWith('앞섬') ? ' green' : c.startsWith('뒤처짐') ? ' yellow' : ''}`, c));
    if (overview.branch !== null && protectedList.has(overview.branch)) head.appendChild(el('span', 'chip red', '보호 브랜치'));
    if (overview.merging) head.appendChild(el('span', 'chip red', '머지 중'));
    head.appendChild(el('span', 'gfill'));
    const act = (label: string, fn: () => Promise<void>, primary = false, disabled = false) => {
      const b = el('button', `btn ${primary ? 'primary' : 'sec'}`, label);
      b.disabled = disabled || busy;
      b.addEventListener('click', async () => {
        busy = true;
        renderHead();
        try {
          await fn();
        } finally {
          busy = false;
          await refreshAll();
        }
      });
      head.appendChild(b);
    };
    const hasRemote = overview.hasRemote;
    act('fetch', async () => void (await call('fetch', undefined as never)), false, !hasRemote);
    act(overview.behind !== null && overview.behind > 0 ? `pull (${overview.behind})` : 'pull', pull, false, !hasRemote);
    act(overview.ahead !== null && overview.ahead > 0 ? `push (${overview.ahead})` : 'push', async () => void (await call('push', {})), true, !hasRemote);
    act('PR 열기', openPr, false, !hasRemote);
  }

  async function pull(): Promise<void> {
    const r = await callRaw('pull', { mode: 'ff' });
    if (r.ok) return say(r.data.message), void (r.data.conflicts === true && (await open('conflicts')));
    if (r.code !== 'BLOCKED') return say(r.error, true);
    const a = await askDialog({ title: '빨리감기로는 합칠 수 없어요', body: `${r.error}\n\n병합(merge)으로 가져올까요? 충돌이 나면 충돌 탭에서 풀 수 있어요.`, okLabel: '병합으로 pull' });
    if (!a.ok) return say('pull을 하지 않았어요.');
    const m = await call('pull', { mode: 'merge' });
    if (m?.conflicts === true) await open('conflicts');
  }

  async function openPr(): Promise<void> {
    const a = await askDialog({ title: 'GitHub에서 PR 열기', body: `${overview?.branch ?? ''} 브랜치를 어디로 합칠지 골라 주세요. 브라우저가 열려요.`, input: { label: '받는 브랜치', value: 'main' }, okLabel: '브라우저로 열기' });
    if (a.ok) {
      const out = await call('openPr', { base: a.value.trim() });
      if (out !== null) say('브라우저에서 PR 화면을 열었어요. (먼저 push가 돼 있어야 보여요)');
    }
  }

  async function open(id: ViewId): Promise<void> {
    current = id;
    renderBar();
    const v = sub(id);
    body.replaceChildren(v.root);
    await v.refresh();
  }

  function renderBar(): void {
    bar.replaceChildren();
    const show: ViewId[] = ['changes', 'branches', 'history'];
    if (overview?.merging === true || overview?.files.some((f) => f.conflict) === true) show.push('conflicts');
    if (!show.includes(current)) current = 'changes';
    for (const id of show) {
      const b = el('button', `gtab${id === current ? ' on' : ''}${id === 'conflicts' ? ' red' : ''}`, VIEW_LABEL[id]);
      b.addEventListener('click', () => void open(id));
      bar.appendChild(b);
    }
    const reread = el('button', 'btn sec gfillbtn', '다시 읽기');
    reread.addEventListener('click', () => void refreshAll());
    bar.appendChild(reread);
  }

  async function refreshAll(): Promise<void> {
    await loadHeader();
    renderBar();
    await sub(current).refresh();
  }

  async function pickRepo(path: string): Promise<void> {
    repo = path;
    try {
      localStorage.setItem(REMEMBER, path);
    } catch {
      /* 기억 못 해도 괜찮다 */
    }
    for (const k of Object.keys(views)) delete views[k as ViewId];
    say('');
    await loadHeader();
    await open('changes');
  }

  async function load(): Promise<void> {
    body.replaceChildren(el('div', 'dim pad', '레포를 찾는 중…'));
    const [all, prot] = await Promise.all([listRepos(), protectedNames()]);
    protectedList = ProtectedBranches.of(prot);
    repos = all.filter((r) => r.kind === 'repo');
    if (repos.length === 0) {
      head.replaceChildren();
      body.replaceChildren(el('div', 'dim pad', '작업 폴더에서 레포를 찾지 못했어요. 설정에서 작업 폴더를 골라 주세요.'));
      return;
    }
    const keep = remembered();
    const first = repos.find((r) => r.root === keep) ?? [...repos].sort((a, b) => (b.status?.changed ?? 0) - (a.status?.changed ?? 0))[0]!;
    await pickRepo(first.root);
  }

  window.addEventListener('focus', () => {
    if (root.isConnected && repo !== null && !busy) void refreshAll();
  });
  void load();
  return { root, refresh: load };
}
