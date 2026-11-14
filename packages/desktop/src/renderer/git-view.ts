import type { GitArg, GitData, GitFn, GitResult, Overview } from '../shared/git-api.js';
import type { RepoRow } from '../shared/ipc.js';
import { ProtectedBranches } from '../shared/git-guard.js';
import { el } from './dom.js';
import { buildChanges } from './git-changes-view.js';
import { buildBranches, buildConflicts, buildHistory, requestHistoryCommit } from './git-lists-view.js';
import { buildStash } from './git-stash-view.js';
import { buildActions } from './git-actions-view.js';
import { askDialog, type GitCtx } from './git-common.js';
import { openBranchMenu, openIdentityDialog, openNewBranchDialog } from './git-branch-ui.js';
import { gitIcon } from './git-icons.js';
import type { ConventionsView } from '../shared/git-conventions-view.js';
import { directionText, fetchedLabel, gitFixFor, isPushRejected, syncSentence } from '../shared/git-toolbar.js';
import { primaryGitAction } from '../shared/git-primary.js';
import { branchMark } from '../shared/git-branch-mark.js';
import { settleGitView, visibleGitViews, type GitViewId } from '../shared/git-tabs.js';

type ViewId = GitViewId;
interface SubView {
  readonly root: HTMLElement;
  refresh(): Promise<void>;
}

const VIEW_LABEL: Readonly<Record<ViewId, string>> = { changes: 'Changes', branches: 'Branches', history: 'History', stash: 'Stash', actions: 'Actions', conflicts: 'Conflicts' };
export const REMEMBER = 'rauha.git.repo';

/** 다른 화면(코드 탭 blame)이 "git 탭을 History 로 열어 줘"라고 남긴 쪽지. 다음에 레포를 고를 때 한 번 쓴다. */
let pendingView: ViewId | null = null;
export function requestGitHistory(hash: string): void {
  pendingView = 'history';
  requestHistoryCommit(hash);
}

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
  const head = el('div', 'bar gtool');
  const bar = el('div', 'tabs');
  const msg = el('div', 'gmsg');
  const status = el('div', 'gstatus');
  status.append(msg);
  const body = el('div', 'gbody');
  root.append(head, status, bar, body);

  let repos: readonly RepoRow[] = [];
  let repo: string | null = null;
  let overview: Overview | null = null;
  let current: ViewId = 'changes';
  let protectedList = ProtectedBranches.of([]);
  const views: Partial<Record<ViewId, SubView>> = {};
  let busy = false;
  /** 지금 도는 동기화 동작(버튼에 스피너와 진행 글을 보인다) */
  let running: 'fetch' | 'pull' | 'push' | null = null;
  let conv: ConventionsView | null | undefined;
  let sayTimer: ReturnType<typeof setTimeout> | undefined;

  /** 결과 한 줄. 성공 글은 잠깐 보였다 사라지고, 실패 글은 다음 동작 때까지 남는다. */
  /** 마지막으로 누른 동기화 동작(실패 줄의 Try again 이 다시 부른다) */
  let lastSync: (() => void) | null = null;
  const say = (text: string, bad = false) => {
    clearTimeout(sayTimer);
    msg.textContent = text;
    msg.className = `gmsg${text === '' ? '' : bad ? ' bad' : ' ok'}`;
    if (text !== '' && !bad) sayTimer = setTimeout(() => say(''), 9000);
    // 실패 줄 옆에 바로 고치는 단추(shared/git-toolbar.ts gitFixFor)
    const fix = bad ? gitFixFor(text) : null;
    if (fix === 'identity') {
      const b = el('button', 'btn sm primary gfix', 'Set name and email');
      b.addEventListener('click', () => void openIdentityDialog(ctx));
      msg.append(' ', b);
    } else if (fix === 'retry' && lastSync !== null) {
      const again = lastSync;
      const b = el('button', 'btn sm gfix', 'Try again');
      b.addEventListener('click', () => again());
      msg.append(' ', b);
    }
  };

  const callRaw = async <K extends GitFn>(fn: K, arg: GitArg<K>, confirmed = false): Promise<GitResult<GitData<K>>> => {
    const api = window.rauha.git[fn] as unknown as (r: string, a: unknown) => Promise<GitResult<GitData<K>>>;
    return api(repo ?? '', confirmed ? { ...(arg as object), confirmed: true } : (arg ?? {}));
  };
  const call: CallFn = async (fn, arg) => {
    let r = await callRaw(fn, arg);
    if (!r.ok && r.code === 'PROTECTED') {
      const a = await askDialog({ title: 'Protected branch', body: r.error, okLabel: 'Continue anyway', danger: true });
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
    callRaw: (fn, arg) => callRaw(fn, arg),
    say,
    ask: askDialog,
    changed: () => loadHeader(),
    adopt: (o) => {
      overview = o;
      renderHead();
      renderBar();
    },
    goto: (v) => void open(v),
    isProtected: (n) => protectedList.has(n),
    branch: () => overview?.branch ?? null,
    conventions: async () => {
      if (conv === undefined) conv = (await callRaw('conventions', undefined as never).then((r) => (r.ok ? r.data : null)));
      return conv ?? null;
    },
    reload: () => refreshAll(),
  };

  const sub = (id: ViewId): SubView => {
    const found = views[id] ?? (id === 'changes' ? buildChanges(ctx) : id === 'branches' ? buildBranches(ctx) : id === 'history' ? buildHistory(ctx) : id === 'stash' ? buildStash(ctx) : id === 'actions' ? buildActions(ctx) : buildConflicts(ctx));
    if (found === undefined) {
      const stub = { root: el('div', 'dim pad', 'Coming soon.'), refresh: async () => {} };
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
    select.title = 'Pick a repo';
    const sorted = [...repos].sort((a, b) => (b.status?.changed ?? 0) - (a.status?.changed ?? 0) || a.name.localeCompare(b.name));
    for (const r of sorted) {
      const o = el('option', undefined, `${r.name}${r.status !== null && r.status.changed > 0 ? ` · ${r.status.changed} changed` : ''}`);
      o.value = r.root;
      o.selected = r.root === repo;
      select.appendChild(o);
    }
    select.addEventListener('change', () => void pickRepo(select.value));
    head.appendChild(select);
    if (overview === null) return;
    // 현재 브랜치를 크게: 누르면 검색·전환·새 브랜치 팝업
    const mark = branchMark(overview.branch, true);
    const branch = el('button', `btn gbranch ${mark.className}`);
    branch.title = `${mark.title} · click to switch or create a branch`;
    branch.append(gitIcon('branch'), el('span', 'gbranchname', overview.branch ?? '(detached HEAD)'));
    if (overview.branch !== null && protectedList.has(overview.branch)) {
      const lock = gitIcon('lock');
      lock.setAttribute('aria-label', 'Protected branch');
      branch.append(lock);
    }
    branch.addEventListener('click', () => void openBranchMenu(branch, ctx, (prefill) => void openNewBranchDialog(ctx, prefill)));
    head.append(branch);
    if (overview.merging) head.appendChild(el('span', 'chip red', 'Merging'));
    const o0 = overview;
    const behindOrBoth = (o0.behind ?? 0) > 0;
    head.appendChild(el('span', `gsyncline${behindOrBoth ? ' warn' : (o0.ahead ?? 0) > 0 ? ' ahead' : ''}`, syncSentence(o0)));
    head.appendChild(el('span', 'grow'));

    const hasRemote = overview.hasRemote;
    const sync = el('div', 'btns gsync');
    // 동기화 버튼: 아이콘 + 글자 + 상태 배지. 도는 중이면 스피너와 진행 글.
    const syncBtn = (kind: 'fetch' | 'pull' | 'push', label: string, progress: string, fn: () => Promise<void>, tip: string, primary: boolean, badge: HTMLElement | null) => {
      const b = el('button', primary ? 'btn primary' : 'btn');
      b.disabled = !hasRemote || busy;
      b.title = hasRemote ? tip : 'This repo has no remote.';
      b.setAttribute('aria-label', label);
      b.append(running === kind ? el('span', 'spinner') : gitIcon(kind, true), el('span', 'glabel', running === kind ? progress : label));
      if (badge !== null) b.append(badge);
      b.addEventListener('click', async () => {
        lastSync = () => [...sync.ownerDocument.querySelectorAll<HTMLButtonElement>('.gsync button')].find((x) => x.getAttribute('aria-label') === b.getAttribute('aria-label'))?.click();
        busy = true;
        running = kind;
        say('');
        renderHead();
        try {
          await fn();
        } finally {
          busy = false;
          running = null;
          await refreshAll();
        }
      });
      sync.appendChild(b);
    };
    const o = overview;
    // 파랗게 강조하는 동작은 상태에서 하나만 정한다(shared/git-primary.ts). 나머지도 글자와 아이콘은 항상 읽힌다.
    const primary = primaryGitAction({ staged: o.files.filter((f) => f.staged).length, conflicts: o.files.some((f) => f.conflict), merging: o.merging, ahead: o.ahead, behind: o.behind, hasRemote, upstream: o.branch === null ? undefined : o.upstream });
    const dir = (kind: 'up' | 'down', n: number | null): HTMLElement | null => {
      const text = directionText(kind === 'up' ? n : null, kind === 'down' ? n : null);
      if (text === '') return null;
      const s = el('span', `sbadge ${kind}`, text);
      s.title = kind === 'down' ? `${n} commit(s) to pull` : `${n} commit(s) to push`;
      return s;
    };
    const fetched = fetchedLabel(o.fetchedAt, Math.floor(Date.now() / 1000));
    const fb = el('span', 'sbadge faint fbadge', fetched.replace('Last checked ', '').replace('Checked just now', 'just now'));
    syncBtn('fetch', 'Fetch', 'Fetching…', async () => void (await call('fetch', undefined as never)), `Check the remote for news (nothing is downloaded into your branch) · ${fetched}`, false, fb);
    syncBtn('pull', 'Pull', 'Pulling…', async () => void (await pull()), 'Get new commits from the remote and merge them', primary === 'pull', dir('down', o.behind));
    const publish = primary === 'publish';
    syncBtn('push', publish ? 'Publish branch' : 'Push', publish ? 'Publishing…' : 'Pushing…', push, publish ? 'Create this branch on the remote and link it' : 'Send my commits to the remote', primary === 'push' || publish, dir('up', o.ahead));
    const pr = el('button', 'btn prbtn');
    pr.disabled = !hasRemote || busy;
    pr.title = hasRemote ? 'Open a PR on GitHub' : 'This repo has no remote.';
    pr.append(gitIcon('pr'), el('span', 'glabel', 'PR'));
    pr.addEventListener('click', async () => {
      busy = true;
      renderHead();
      try {
        await openPr();
      } finally {
        busy = false;
        await refreshAll();
      }
    });
    sync.appendChild(pr);
    head.appendChild(sync);
    // 진행 중 글: 결과 줄 자리에 보인다
    if (running !== null) {
      status.replaceChildren(el('span', 'spinner'), el('span', 'hint grow', running === 'fetch' ? 'Fetching from the remote…' : running === 'pull' ? 'Pulling new commits…' : 'Pushing commits…'));
    } else if (status.firstChild !== msg) status.replaceChildren(msg);
  }

  /** 받아서 합친다. 충돌 없이 끝났으면 true(이어서 push 해도 된다) */
  async function pull(): Promise<boolean> {
    const r = await callRaw('pull', { mode: 'ff' });
    if (r.ok) {
      say(r.data.message);
      if (r.data.conflicts === true) return await open('conflicts'), false;
      return true;
    }
    if (r.code !== 'BLOCKED') return say(r.error, true), false;
    const a = await askDialog({ title: 'Cannot fast-forward', body: `${r.error}\n\nPull with a merge instead? If it conflicts, resolve it in the Conflicts tab.`, okLabel: 'Pull with merge' });
    if (!a.ok) return say('Did not pull.'), false;
    const m = await call('pull', { mode: 'merge' });
    if (m === null) return false;
    if (m.conflicts === true) return await open('conflicts'), false;
    return true;
  }

  /** 보낸다. 원격에 내가 없는 커밋이 있어 거절되면 "받고 다시 보내기"를 한 번에 제안한다 */
  async function push(): Promise<void> {
    let confirmed = false;
    let r = await callRaw('push', {});
    if (!r.ok && r.code === 'PROTECTED') {
      const a = await askDialog({ title: 'Protected branch', body: r.error, okLabel: 'Continue anyway', danger: true });
      if (!a.ok) return;
      confirmed = true;
      r = await callRaw('push', {}, true);
    }
    if (r.ok) return say(r.data.message);
    if (!isPushRejected(r.error)) return say(r.error, true);
    const a = await askDialog({ title: 'Push was rejected', body: `${r.error}\n\nGet the new commits first and push again? Your commits stay as they are. If something conflicts, you resolve it in the Conflicts tab and push after.`, okLabel: 'Pull and push again' });
    if (!a.ok) return say('Did not push. Pull first when you are ready.');
    running = 'pull';
    renderHead();
    if (!(await pull())) return;
    running = 'push';
    renderHead();
    const again = await callRaw('push', {}, confirmed);
    if (again.ok) say(`Pulled and pushed. ${again.data.message}`);
    else say(again.error, true);
  }

  async function openPr(): Promise<void> {
    const a = await askDialog({ title: 'Open a PR on GitHub', body: `Pick the branch to merge ${overview?.branch ?? ''} into. A browser opens.`, input: { label: 'Target branch', value: 'main' }, okLabel: 'Open in browser' });
    if (a.ok) {
      const out = await call('openPr', { base: a.value.trim() });
      if (out !== null) say('Opened the PR page in your browser (push first, or it will not show).');
    }
  }

  async function open(id: ViewId): Promise<void> {
    // 방금 pull·머지로 충돌이 났다면 헤더가 아직 모른다. 먼저 읽어야 충돌 탭이 보이고 그리로 들어간다.
    if (!visibleGitViews(overview).includes(id)) await loadHeader();
    current = id;
    renderBar();
    const v = sub(current);
    body.replaceChildren(v.root);
    await v.refresh();
  }

  function renderBar(): void {
    bar.replaceChildren();
    const show = visibleGitViews(overview);
    current = settleGitView(current, overview);
    for (const id of show) {
      const b = el('button', `tab${id === current ? ' on' : ''}${id === 'conflicts' ? ' danger' : ''}`, VIEW_LABEL[id]);
      b.addEventListener('click', () => void open(id));
      bar.appendChild(b);
    }
  }

  async function refreshAll(): Promise<void> {
    // 변경 탭은 자기가 읽은 overview를 헤더에 넘기므로 따로 읽지 않는다
    if (current !== 'changes') await loadHeader();
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
    conv = undefined;
    say('');
    // 변경 탭이 자기가 읽은 overview를 헤더에 넘기므로(adopt) 따로 한 번 더 읽지 않는다(큰 레포에서 탭 열기가 그만큼 빨라진다)
    const first = pendingView ?? 'changes';
    pendingView = null;
    await open(first);
  }

  async function load(): Promise<void> {
    body.replaceChildren(el('div', 'dim pad', 'Looking for repos…'));
    const [all, prot] = await Promise.all([listRepos(), protectedNames()]);
    protectedList = ProtectedBranches.of(prot);
    repos = all.filter((r) => r.kind === 'repo');
    if (repos.length === 0) {
      head.replaceChildren();
      body.replaceChildren(el('div', 'dim pad', 'No repos found in the work folder. Pick a work folder in Settings.'));
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
