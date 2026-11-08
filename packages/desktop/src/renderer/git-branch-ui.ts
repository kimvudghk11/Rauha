import type { BranchView } from '../shared/git-lists.js';
import { parseTrack, sortBranchesRecent } from '../shared/git-lists.js';
import { checkBranchName } from '../shared/branch-name-check.js';
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
  box.title = [t.ahead > 0 ? `원격보다 ${t.ahead}개 앞서 있어요(올릴 것)` : '', t.behind > 0 ? `원격보다 ${t.behind}개 뒤처져 있어요(받을 것)` : ''].filter((x) => x !== '').join(' · ');
  return box;
}

let closeOpen: (() => void) | null = null;

/** 브랜치 고르기 팝업: 검색, 현재 브랜치 맨 위, 최근 순, 로컬/원격 구분, ↑↓, 보호 브랜치 자물쇠, 맨 아래에 새 브랜치 */
export async function openBranchMenu(anchor: HTMLElement, ctx: GitCtx, onNew: (prefill: string) => void): Promise<void> {
  closeOpen?.();
  const all = ((await ctx.call('branches', undefined as never)) ?? []).filter((b) => !b.remote);
  const menu = el('div', 'menu gbm');
  menu.setAttribute('role', 'menu');
  const search = el('input', 'sm');
  search.placeholder = '브랜치 검색';
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
  };
  const item = (b: BranchView): HTMLElement => {
    const row = el('button');
    row.type = 'button';
    row.setAttribute('role', 'menuitem');
    row.append(el('span', 'grow mono', b.name));
    if (b.current) row.append(el('span', 'chip blue', '현재'));
    if (ctx.isProtected(b.name)) {
      const lock = gitIcon('lock');
      lock.setAttribute('aria-label', '보호 브랜치');
      row.append(lock);
    }
    if (b.author !== '') row.append(el('span', 'gbauthor', b.author));
    const t = trackBadgeEl(b);
    if (t !== null) row.append(t);
    row.addEventListener('click', async () => {
      close();
      if (b.current) return;
      const done = await ctx.call('switchBranch', { name: b.name });
      if (done !== null) await ctx.reload();
    });
    return row;
  };
  const draw = (): void => {
    for (const n of [...menu.children]) if (n !== search) n.remove();
    const q = search.value.trim().toLowerCase();
    const hit = all.filter((b) => b.name.toLowerCase().includes(q));
    const local = sortBranchesRecent(hit.filter((b) => !b.remote));
    if (local.length > 0) menu.append(el('div', 'lbl', `내 브랜치 · 최근 커밋 순 (${local.length})`), ...local.map(item));
    if (hit.length === 0) menu.append(el('div', 'lbl', '맞는 브랜치가 없어요.'));
    menu.append(el('div', 'sep'));
    const add = el('button');
    add.type = 'button';
    add.append(gitIcon('plus'), el('span', 'grow', q === '' ? '새 브랜치 만들기…' : `"${search.value.trim()}" 새 브랜치 만들기…`));
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
  box.append(el('b', undefined, '새 브랜치'));

  const nameField = el('div', 'gfield');
  nameField.append(el('span', 'lbl', '이름'));
  const name = el('input');
  name.value = prefill;
  name.placeholder = conv !== null && conv.branch.fromRepo ? `${conv.branch.prefixes[0] ?? ''}작업-이름` : 'feature/작업-이름';
  name.spellcheck = false;
  nameField.append(name);
  const verdict = el('div', 'hint');
  const check = (): void => {
    const r = checkBranchName(name.value, local, remotes);
    const empty = name.value.trim() === '';
    verdict.className = r.ok || empty ? 'hint' : 'err';
    verdict.textContent = r.ok ? `만들 이름: ${r.name}` : empty ? '' : r.reason;
    ok.disabled = !r.ok || all.length === 0;
    why.textContent = r.ok ? '' : r.reason;
  };
  if (conv !== null) {
    const chips = el('div', 'chips');
    chips.append(el('span', 'hint', conv.branch.fromRepo ? '이 레포 방식:' : '자주 쓰는 말머리:'));
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
  baseField.append(el('span', 'lbl', '기준 브랜치(여기서 갈라져요)'));
  const base = el('select');
  const cur = ctx.branch();
  for (const b of sortBranchesRecent(all)) {
    const o = el('option', undefined, `${b.name}${b.name === cur ? ' (현재)' : ''}${b.remote ? ' · 원격' : ''}`);
    o.value = b.name;
    o.selected = cur !== null ? b.name === cur : b.current;
    base.append(o);
  }
  baseField.append(base);

  const go = el('label', 'gcheck');
  const goBox = el('input');
  goBox.type = 'checkbox';
  goBox.checked = true;
  go.append(goBox, el('span', undefined, '만들고 바로 이동'));

  const row = el('div', 'btns end');
  const why = el('span', 'hint grow');
  const cancel = el('button', 'btn', '취소');
  const ok = el('button', 'btn primary', '만들기');
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
