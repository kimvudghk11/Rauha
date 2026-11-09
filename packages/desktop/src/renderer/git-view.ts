import type { GitArg, GitData, GitFn, GitResult, Overview } from '../shared/git-api.js';
import type { RepoRow } from '../shared/ipc.js';
import { ProtectedBranches } from '../shared/git-guard.js';
import { el } from './dom.js';
import { buildChanges } from './git-changes-view.js';
import { buildBranches, buildConflicts, buildHistory } from './git-lists-view.js';
import { askDialog, type GitCtx } from './git-common.js';
import { openBranchMenu, openNewBranchDialog } from './git-branch-ui.js';
import { gitIcon } from './git-icons.js';
import type { ConventionsView } from '../shared/git-conventions-view.js';
import { directionText, fetchedLabel } from '../shared/git-toolbar.js';
import { primaryGitAction } from '../shared/git-primary.js';
import { branchMark } from '../shared/git-branch-mark.js';

type ViewId = 'changes' | 'branches' | 'history' | 'conflicts';
interface SubView {
  readonly root: HTMLElement;
  refresh(): Promise<void>;
}

const VIEW_LABEL: Readonly<Record<ViewId, string>> = { changes: '변경', branches: '브랜치', history: '히스토리', conflicts: '충돌' };
export const REMEMBER = 'rauha.git.repo';

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
  const say = (text: string, bad = false) => {
    clearTimeout(sayTimer);
    msg.textContent = text;
    msg.className = `gmsg${text === '' ? '' : bad ? ' bad' : ' ok'}`;
    if (text !== '' && !bad) sayTimer = setTimeout(() => say(''), 9000);
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
    branch: () => overview?.branch ?? null,
    conventions: async () => {
      if (conv === undefined) conv = (await callRaw('conventions', undefined as never).then((r) => (r.ok ? r.data : null)));
      return conv ?? null;
    },
    reload: () => refreshAll(),
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
    select.title = '레포 고르기';
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
    // 현재 브랜치를 크게: 누르면 검색·전환·새 브랜치 팝업
    const mark = branchMark(overview.branch, true);
    const branch = el('button', `btn gbranch ${mark.className}`);
    branch.title = `${mark.title} · 눌러서 브랜치 바꾸기·새 브랜치`;
    branch.append(gitIcon('branch'), el('span', 'gbranchname', overview.branch ?? '(분리된 HEAD)'));
    if (overview.branch !== null && protectedList.has(overview.branch)) {
      const lock = gitIcon('lock');
      lock.setAttribute('aria-label', '보호 브랜치');
      branch.append(lock);
    }
    branch.addEventListener('click', () => void openBranchMenu(branch, ctx, (prefill) => void openNewBranchDialog(ctx, prefill)));
    head.append(branch);
    if (overview.merging) head.appendChild(el('span', 'chip red', '머지 중'));
    if (!overview.hasRemote) head.appendChild(el('span', 'chip', '원격 없음'));
    head.appendChild(el('span', 'grow'));

    const hasRemote = overview.hasRemote;
    const sync = el('div', 'btns gsync');
    // 동기화 버튼: 아이콘 + 글자 + 상태 배지. 도는 중이면 스피너와 진행 글.
    const syncBtn = (kind: 'fetch' | 'pull' | 'push', label: string, progress: string, fn: () => Promise<void>, tip: string, primary: boolean, badge: HTMLElement | null) => {
      const b = el('button', primary ? 'btn primary' : 'btn');
      b.disabled = !hasRemote || busy;
      b.title = hasRemote ? tip : '이 레포에는 원격이 없어요.';
      b.setAttribute('aria-label', label);
      b.append(running === kind ? el('span', 'spinner') : gitIcon(kind, true), el('span', 'glabel', running === kind ? progress : label));
      if (badge !== null) b.append(badge);
      b.addEventListener('click', async () => {
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
    const primary = primaryGitAction({ staged: o.files.filter((f) => f.staged).length, conflicts: o.files.some((f) => f.conflict), merging: o.merging, ahead: o.ahead, behind: o.behind, hasRemote });
    const dir = (kind: 'up' | 'down', n: number | null): HTMLElement | null => {
      const text = directionText(kind === 'up' ? n : null, kind === 'down' ? n : null);
      if (text === '') return null;
      const s = el('span', `sbadge ${kind}`, text);
      s.title = kind === 'down' ? `원격에 받을 커밋이 ${n}개 있어요` : `올릴 커밋이 ${n}개 있어요`;
      return s;
    };
    const fetched = fetchedLabel(o.fetchedAt, Math.floor(Date.now() / 1000));
    const fb = el('span', 'sbadge faint fbadge', fetched.replace('마지막 확인 ', '').replace('방금 확인', '방금'));
    syncBtn('fetch', 'Fetch', '가져오는 중…', async () => void (await call('fetch', undefined as never)), `원격 소식을 확인해요(받지는 않아요) · ${fetched}`, false, fb);
    syncBtn('pull', 'Pull', '받는 중…', pull, '원격의 새 커밋을 받아 합쳐요', primary === 'pull', dir('down', o.behind));
    syncBtn('push', 'Push', '올리는 중…', async () => void (await call('push', {})), '내 커밋을 원격에 올려요', primary === 'push', dir('up', o.ahead));
    const pr = el('button', 'btn prbtn');
    pr.disabled = !hasRemote || busy;
    pr.title = 'GitHub에서 PR 열기';
    pr.append(gitIcon('external'), el('span', 'glabel', 'PR'));
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
      status.replaceChildren(el('span', 'spinner'), el('span', 'hint grow', running === 'fetch' ? '원격 소식을 가져오는 중…' : running === 'pull' ? '새 커밋을 받는 중…' : '커밋을 올리는 중…'));
    } else if (status.firstChild !== msg) status.replaceChildren(msg);
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
      const b = el('button', `tab${id === current ? ' on' : ''}${id === 'conflicts' ? ' danger' : ''}`, VIEW_LABEL[id]);
      b.addEventListener('click', () => void open(id));
      bar.appendChild(b);
    }
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
    conv = undefined;
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
