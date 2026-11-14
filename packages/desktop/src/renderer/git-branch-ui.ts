import type { BranchView } from '../shared/git-lists.js';
import { branchMark } from '../shared/git-branch-mark.js';
import { parseTrack, sortBranchesRecent } from '../shared/git-lists.js';
import { checkBranchName } from '../shared/branch-name-check.js';
import { switchBlockedByChanges } from '../shared/git-toolbar.js';
import { el, isEnterKey } from './dom.js';
import type { GitCtx } from './git-common.js';
import { gitIcon } from './git-icons.js';

/** 방향 배지 요소(↑는 초록, ↓는 노랑). 색만이 아니라 기호로도 구분된다. 원격과 같거나 연결이 없으면 null. */
export function trackBadgeEl(b: BranchView): HTMLElement | null {
  const t = parseTrack(b.upstream === null ? null : b.track);
  if (t === null || (t.ahead === 0 && t.behind === 0)) return null;
  const box = el('span', 'tg');
  if (t.ahead > 0) box.append(el('span', 'sbadge up', `↑${t.ahead}`));
  if (t.behind > 0) box.append(el('span', 'sbadge down', `↓${t.behind}`));
  box.title = [t.ahead > 0 ? `${t.ahead} commit(s) ahead of the remote (to push)` : '', t.behind > 0 ? `${t.behind} commit(s) behind the remote (to pull)` : ''].filter((x) => x !== '').join(' · ');
  return box;
}

let closeOpen: (() => void) | null = null;

/** 브랜치를 바꾼다. 고친 파일이 덮어써질 거라 막히면 "stash 하고 바꾸기"를 제안한다. 바꿨으면 true */
export async function switchTo(ctx: GitCtx, name: string): Promise<boolean> {
  const r = await ctx.callRaw('switchBranch', { name });
  if (r.ok) return ctx.say(r.data.message), true;
  if (!switchBlockedByChanges(r.error)) return ctx.say(r.error, true), false;
  const from = ctx.branch() ?? 'HEAD';
  const a = await ctx.ask({ title: 'Your changed files are in the way', body: `${r.error}\n\nPut your changes aside (stash) and switch to ${name}? They wait in the Stash tab. Apply them when you come back to ${from}.`, okLabel: 'Stash and switch' });
  if (!a.ok) return ctx.say('Did not switch.'), false;
  const s = await ctx.call('stash', { message: `rauha: changes on ${from} before switching to ${name}`, includeUntracked: true });
  if (s === null) return false;
  const again = await ctx.call('switchBranch', { name });
  if (again === null) return false;
  ctx.say(`Switched to ${name}. Your changes from ${from} are in the Stash tab.`);
  return true;
}

/** 브랜치 고르기 팝업: 검색, 현재 브랜치 맨 위, 최근 순, 로컬/원격 구분, ↑↓, 보호 브랜치 자물쇠, 맨 아래에 새 브랜치 */
export async function openBranchMenu(anchor: HTMLElement, ctx: GitCtx, onNew: (prefill: string) => void): Promise<void> {
  closeOpen?.();
  const every = (await ctx.call('branches', undefined as never)) ?? [];
  const all = every.filter((b) => !b.remote);
  const remoteNames = every.filter((b) => b.remote).map((b) => b.name);
  let enter: (() => void) | null = null;
  const menu = el('div', 'menu gbm');
  menu.setAttribute('role', 'menu');
  const search = el('input', 'sm');
  search.placeholder = 'Search branches';
  const close = (): void => {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (closeOpen === close) closeOpen = null;
  };
  const onDown = (e: Event): void => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (isEnterKey(e) && document.activeElement === search && enter !== null) {
      e.preventDefault();
      enter();
    }
  };
  const item = (b: BranchView): HTMLElement => {
    const row = el('button');
    row.type = 'button';
    row.setAttribute('role', 'menuitem');
    const mark = branchMark(b.name, b.current);
    row.className = mark.className;
    row.title = mark.title;
    row.append(el('span', 'grow mono', b.name));
    if (mark.badge !== null) row.append(el('span', 'chip blue', mark.badge));
    if (ctx.isProtected(b.name)) {
      const lock = gitIcon('lock');
      lock.setAttribute('aria-label', 'Protected branch');
      row.append(lock);
    }
    if (b.author !== '') row.append(el('span', 'gbauthor', b.author));
    const t = trackBadgeEl(b);
    if (t !== null) row.append(t);
    row.addEventListener('click', async () => {
      close();
      if (b.current) return;
      if (await switchTo(ctx, b.name)) await ctx.reload();
    });
    return row;
  };
  const draw = (): void => {
    for (const n of [...menu.children]) if (n !== search) n.remove();
    const q = search.value.trim().toLowerCase();
    const hit = all.filter((b) => b.name.toLowerCase().includes(q));
    const local = sortBranchesRecent(hit.filter((b) => !b.remote));
    // 하나만 남으면 Enter 로 그 브랜치로
    const only = local.length === 1 ? local[0] : undefined;
    enter = only === undefined ? null : () => {
      close();
      if (!only.current) void switchTo(ctx, only.name).then(async (ok) => {
        if (ok) await ctx.reload();
      });
    };
    // 같은 이름이 없으면 맨 위에서 바로 만든다(Enter). 이름이 틀렸으면 그 이유를 한 줄로.
    if (q !== '' && !all.some((b) => b.name.toLowerCase() === q)) {
      const check = checkBranchName(search.value, all.map((b) => b.name), remoteNames);
      const cur = ctx.branch();
      if (check.ok) {
        const create = el('button', 'gbm-create');
        create.type = 'button';
        create.append(gitIcon('plus'), el('span', 'grow', `Create branch ${check.name} from ${cur ?? 'here'}`), el('span', 'kbd', 'Enter'));
        const make = async (): Promise<void> => {
          close();
          const done = await ctx.call('createBranch', cur === null ? { name: check.name, checkout: true } : { name: check.name, base: cur, checkout: true });
          if (done !== null) await ctx.reload();
        };
        create.addEventListener('click', () => void make());
        if (local.length === 0) enter = () => void make();
        menu.append(create);
      } else menu.append(el('div', 'err gbm-why', check.reason));
    }
    if (local.length > 0) menu.append(el('div', 'lbl', `My branches · latest commit first (${local.length})`), ...local.map(item));
    if (hit.length === 0) menu.append(el('div', 'lbl', 'No matching branches.'));
    menu.append(el('div', 'sep'));
    const add = el('button');
    add.type = 'button';
    add.append(gitIcon('plus'), el('span', 'grow', q === '' ? 'New branch…' : 'New branch with options (base, prefix)…'));
    add.addEventListener('click', () => {
      const prefill = search.value.trim();
      close();
      onNew(prefill);
    });
    menu.append(add);
  };
  search.addEventListener('input', draw);
  menu.append(search);
  draw();
  closeOpen = close;
  document.body.append(menu);
  const a = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(a.left, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${a.bottom + 2}px`;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  search.focus();
}

/** 커밋에 적힐 이름·이메일을 그 자리에서 정한다(터미널에 git config 를 치지 않아도 된다) */
export async function openIdentityDialog(ctx: GitCtx): Promise<void> {
  const veil = el('div', 'veil');
  const box = el('div', 'dialog gnew');
  box.setAttribute('role', 'dialog');
  box.append(el('b', undefined, 'Your name and email for commits'), el('div', 'hint', 'Git writes these into every commit. Use the email of your GitHub account so commits link to you.'));
  const field = (label: string, ph: string): HTMLInputElement => {
    const f = el('div', 'gfield');
    const i = el('input');
    i.placeholder = ph;
    i.spellcheck = false;
    f.append(el('span', 'lbl', label), i);
    box.append(f);
    return i;
  };
  const name = field('Name', 'Your Name');
  const email = field('Email', 'you@example.com');
  const all = el('label', 'gcheck');
  const allBox = el('input');
  allBox.type = 'checkbox';
  allBox.checked = true;
  all.append(allBox, el('span', undefined, 'Use for all repos on this computer'));
  const row = el('div', 'btns end');
  const why = el('span', 'err grow');
  const cancel = el('button', 'btn', 'Cancel');
  const ok = el('button', 'btn primary', 'Save');
  row.append(why, cancel, ok);
  box.append(all, row);
  veil.append(box);
  const finish = (): void => {
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
  };
  const save = async (): Promise<void> => {
    ok.disabled = true;
    const r = await ctx.callRaw('setIdentity', { name: name.value, email: email.value, scope: allBox.checked ? 'global' : 'repo' });
    ok.disabled = false;
    if (!r.ok) return void (why.textContent = r.error);
    finish();
    ctx.say(`${r.data.message} Try the commit again.`);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') finish();
    else if (isEnterKey(e) && !ok.disabled) void save();
  };
  cancel.addEventListener('click', finish);
  ok.addEventListener('click', () => void save());
  document.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  name.focus();
}

/**
 * 새 브랜치 대화상자: 이름(이 레포 방식의 접두어 칩 · 즉시 검사 · 겹침 경고), 기준 브랜치, 만들고 바로 이동.
 * 만들기가 막힌 이유는 버튼 옆에 한 줄로 보인다.
 */
export async function openNewBranchDialog(ctx: GitCtx, prefill = ''): Promise<void> {
  const [list, conv] = await Promise.all([ctx.call('branches', undefined as never), ctx.conventions()]);
  const all = (list ?? []).filter((b) => !b.remote);
  const local = all.filter((b) => !b.remote).map((b) => b.name);
  const remotes: string[] = (list ?? []).filter((b) => b.remote).map((b) => b.name);
  const veil = el('div', 'veil');
  const box = el('div', 'dialog gnew');
  box.setAttribute('role', 'dialog');
  box.append(el('b', undefined, 'New branch'));

  const nameField = el('div', 'gfield');
  nameField.append(el('span', 'lbl', 'Name'));
  const name = el('input');
  name.value = prefill;
  name.placeholder = conv !== null && conv.branch.fromRepo ? `${conv.branch.prefixes[0] ?? ''}task-name` : 'feature/task-name';
  name.spellcheck = false;
  nameField.append(name);
  const verdict = el('div', 'hint');
  const check = (): void => {
    const r = checkBranchName(name.value, local, remotes);
    const empty = name.value.trim() === '';
    verdict.className = r.ok || empty ? 'hint' : 'err';
    verdict.textContent = r.ok ? `Will be named: ${r.name}` : empty ? '' : r.reason;
    ok.disabled = !r.ok || all.length === 0;
    why.textContent = r.ok ? '' : r.reason;
  };
  if (conv !== null) {
    const chips = el('div', 'chips');
    chips.append(el('span', 'hint', conv.branch.fromRepo ? 'This repo uses:' : 'Common prefixes:'));
    for (const p of conv.branch.prefixes) {
      const c = el('button', 'chip', p);
      c.type = 'button';
      c.addEventListener('click', () => {
        name.value = p + name.value.replace(/^[a-z]+\//i, '');
        name.focus();
        check();
      });
      chips.append(c);
    }
    nameField.append(chips);
  }
  nameField.append(verdict);

  const baseField = el('div', 'gfield');
  baseField.append(el('span', 'lbl', 'Base branch (branches off here)'));
  const base = el('select');
  const cur = ctx.branch();
  for (const b of sortBranchesRecent(all)) {
    const o = el('option', undefined, `${b.name}${b.name === cur ? ' (current)' : ''}${b.remote ? ' · remote' : ''}`);
    o.value = b.name;
    o.selected = cur !== null ? b.name === cur : b.current;
    base.append(o);
  }
  baseField.append(base);

  const go = el('label', 'gcheck');
  const goBox = el('input');
  goBox.type = 'checkbox';
  goBox.checked = true;
  go.append(goBox, el('span', undefined, 'Create and switch'));

  const row = el('div', 'btns end');
  const why = el('span', 'hint grow');
  const cancel = el('button', 'btn', 'Cancel');
  const ok = el('button', 'btn primary', 'Create');
  row.append(why, cancel, ok);
  box.append(nameField, baseField, go, row);
  veil.append(box);

  const finish = (): void => {
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') finish();
    else if (isEnterKey(e) && !ok.disabled && document.activeElement === name) void create();
  };
  const create = async (): Promise<void> => {
    const r = checkBranchName(name.value, local, remotes);
    if (!r.ok) return;
    ok.disabled = true;
    const done = await ctx.call('createBranch', { name: r.name, base: base.value, checkout: goBox.checked });
    if (done === null) return check();
    finish();
    await ctx.reload();
  };
  name.addEventListener('input', check);
  cancel.addEventListener('click', finish);
  ok.addEventListener('click', () => void create());
  document.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  check();
  name.focus();
}
