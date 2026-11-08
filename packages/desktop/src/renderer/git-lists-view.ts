import type { FileDiffView } from '../shared/git-api.js';
import type { BranchView, LogRow } from '../shared/git-lists.js';
import { el } from './dom.js';
import { type GitCtx, renderDiff } from './git-common.js';
import { ago } from './git-format.js';
import { gitIcon } from './git-icons.js';
import { openNewBranchDialog, trackBadgeEl } from './git-branch-ui.js';
import { sortBranchesRecent } from '../shared/git-lists.js';

/** 브랜치 탭: 로컬·원격 목록, 새로 만들기(지금 브랜치에서), 전환, 현재 브랜치로 머지, 안전한 삭제(-d) */
export function buildBranches(ctx: GitCtx) {
  const root = el('div', 'glist gpanel');
  const tools = el('div', 'gtools');
  const filter = el('input', 'ginput');
  filter.placeholder = '브랜치 검색';
  const create = el('button', 'btn primary');
  create.append(gitIcon('plus'), el('span', undefined, '새 브랜치'));
  tools.append(filter, create);
  const list = el('div', 'gfiles');
  root.append(tools, list);
  let all: readonly BranchView[] = [];

  const act = async (fn: 'switchBranch' | 'merge' | 'deleteBranch', b: BranchView, title?: string) => {
    if (title !== undefined) {
      const a = await ctx.ask({ title, body: b.name, okLabel: '확인', danger: fn === 'deleteBranch' });
      if (!a.ok) return;
    }
    const done = await ctx.call(fn, { name: b.name });
    if (done?.conflicts === true) return ctx.goto('conflicts');
    await refresh();
    await ctx.changed();
  };

  function draw(): void {
    list.replaceChildren();
    const q = filter.value.trim().toLowerCase();
    for (const remote of [false]) {
      const rows = sortBranchesRecent(all.filter((b) => b.remote === remote && b.name.toLowerCase().includes(q)));
      if (rows.length === 0) continue;
      list.appendChild(el('div', 'gall', `내 브랜치 ${rows.length} · 최근 커밋 순`));
      for (const b of rows) {
        const row = el('div', `gf row-item${b.current ? ' on' : ''}`);
        const name = el('span', 'gname');
        name.append(el('b', 'mono', b.name));
        row.appendChild(name);
        if (b.current) row.appendChild(el('span', 'chip', '현재'));
        if (b.author !== '') row.appendChild(el('span', 'gbauthor', b.author));
        if (b.team) row.appendChild(el('span', 'chip purple', '팀 작업'));
        if (ctx.isProtected(b.name)) {
          const lock = el('span', 'chip red');
          lock.append(gitIcon('lock'), '보호');
          row.appendChild(lock);
        }
        const tb = trackBadgeEl(b);
        if (tb !== null) row.appendChild(tb);
        const btn = (label: string, fn: () => void, danger = false) => {
          const x = el('button', danger ? 'btn sm danger' : 'btn sm', label);
          x.addEventListener('click', fn);
          row.appendChild(x);
        };
        if (!b.current) btn('전환', () => void act('switchBranch', b));
        if (!b.current && !b.remote) btn('현재 브랜치로 머지', () => void act('merge', b, '이 브랜치를 현재 브랜치로 합칠까요?'));
        if (!b.current && !b.remote) btn('삭제', () => void act('deleteBranch', b, '브랜치를 지울까요? (합치지 않은 커밋이 있으면 git이 막아요)'), true);
        list.appendChild(row);
      }
    }
  }
  filter.addEventListener('input', draw);
  create.addEventListener('click', () => void openNewBranchDialog(ctx, filter.value.trim()));
  async function refresh(): Promise<void> {
    all = (await ctx.call('branches', undefined as never)) ?? [];
    draw();
  }
  return { root, refresh };
}

/** 히스토리 탭: 최근 200개 커밋과 그 커밋의 diff */
export function buildHistory(ctx: GitCtx) {
  const root = el('div', 'gsplit');
  const side = el('div', 'gside');
  const main = el('div', 'gmain');
  root.append(side, main);
  let selected = '';
  async function show(row: LogRow): Promise<void> {
    selected = row.hash;
    main.replaceChildren(el('div', 'dim pad', '읽는 중…'));
    const files = (await ctx.call('commitDiff', { hash: row.hash })) as readonly FileDiffView[] | null;
    if (files === null || selected !== row.hash) return;
    main.replaceChildren();
    const head = el('div', 'gmh');
    head.append(el('b', undefined, row.subject), el('span', 'dim mono', row.short), el('span', 'dim', `${row.author} · 파일 ${files.length}개`));
    main.appendChild(head);
    for (const f of files) {
      main.appendChild(el('div', 'gh', f.path));
      main.appendChild(renderDiff(f, { mode: 'view' }));
    }
  }
  async function refresh(): Promise<void> {
    const rows = (await ctx.call('log', {})) ?? [];
    side.replaceChildren();
    const list = el('div', 'gfiles');
    const now = Math.floor(Date.now() / 1000);
    for (const r of rows) {
      const row = el('div', `gf row-item gcm${r.hash === selected ? ' on' : ''}`);
      const info = el('span', 'gname');
      info.append(el('b', undefined, r.subject), el('div', 'dim', `${r.author} · ${ago(r.at, now)} · ${r.short}`));
      row.appendChild(info);
      for (const ref of r.refs.filter((x) => !x.startsWith('tag:'))) row.appendChild(el('span', ref.includes('rauha/job-') ? 'chip purple' : 'chip', ref.replace('HEAD -> ', '')));
      row.addEventListener('click', () => {
        list.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
        row.classList.add('on');
        void show(r);
      });
      list.appendChild(row);
    }
    if (rows.length === 0) list.appendChild(el('div', 'dim pad', '커밋이 아직 없어요.'));
    side.appendChild(list);
    if (rows[0] !== undefined && selected === '') void show(rows[0]);
  }
  return { root, refresh };
}

/** 충돌 탭: 충돌 파일마다 내 것/상대 것 선택 또는 직접 편집 → 해결됨, 머지 마치기·중단 */
export function buildConflicts(ctx: GitCtx) {
  const root = el('div', 'gsplit');
  const side = el('div', 'gside');
  const main = el('div', 'gmain');
  root.append(side, main);
  let selected: string | null = null;
  async function edit(path: string): Promise<void> {
    selected = path;
    main.replaceChildren();
    const r = await ctx.call('readConflict', { path });
    if (r === null) return;
    const head = el('div', 'gmh');
    head.appendChild(el('b', undefined, path));
    const area = el('textarea', 'ginput gconf');
    area.value = r.text;
    area.spellcheck = false;
    const done = async (fn: () => Promise<unknown>) => {
      if (await fn()) await refresh();
    };
    const mk = (label: string, fn: () => Promise<unknown>, cls = '') => {
      const b = el('button', cls === '' ? 'btn' : `btn ${cls}`, label);
      b.addEventListener('click', () => void done(fn));
      head.appendChild(b);
    };
    mk('내 것 쓰기(현재 브랜치)', () => ctx.call('resolveSide', { path, side: 'ours' }));
    mk('상대 것 쓰기', () => ctx.call('resolveSide', { path, side: 'theirs' }));
    mk('저장', () => ctx.call('writeConflict', { path, text: area.value }));
    mk('해결됨', async () => (await ctx.call('writeConflict', { path, text: area.value })) && (await ctx.call('markResolved', { path })), 'primary');
    main.append(head, area);
  }
  async function refresh(): Promise<void> {
    const s = await ctx.call('mergeState', undefined as never);
    side.replaceChildren();
    if (s === null) return;
    const list = el('div', 'gfiles');
    list.appendChild(el('div', 'gall', s.conflicts.length === 0 ? '풀 충돌이 없어요' : `충돌 ${s.conflicts.length}개`));
    for (const p of s.conflicts) {
      const row = el('div', `gf row-item${p === selected ? ' on' : ''}`);
      row.append(el('span', 'gname', p), el('span', 'gb red', '!'));
      row.addEventListener('click', () => void edit(p).then(refreshMarks));
      list.appendChild(row);
    }
    side.appendChild(list);
    const foot = el('div', 'gcommit');
    const finish = el('button', 'btn primary', '머지 이어서 마치기');
    finish.disabled = !s.merging || s.conflicts.length > 0;
    finish.addEventListener('click', async () => {
      if (await ctx.call('finishMerge', undefined as never)) {
        await ctx.changed();
        ctx.goto('changes');
      }
    });
    const abort = el('button', 'btn danger', '머지 중단');
    abort.disabled = !s.merging;
    abort.addEventListener('click', async () => {
      const a = await ctx.ask({ title: '머지를 중단할까요?', body: '합치던 것을 취소하고 원래 상태로 돌아가요. 충돌을 풀며 고친 내용은 사라져요.', okLabel: '중단', danger: true });
      if (a.ok && (await ctx.call('abortMerge', undefined as never))) {
        await ctx.changed();
        ctx.goto('changes');
      }
    });
    foot.append(finish, abort);
    side.appendChild(foot);
    if (s.conflicts.length === 0) main.replaceChildren(el('div', 'dim pad', s.merging ? '충돌을 모두 풀었어요. "머지 이어서 마치기"를 눌러 주세요.' : '진행 중인 머지가 없어요.'));
    else if (selected === null || !s.conflicts.includes(selected)) void edit(s.conflicts[0]!);
    await ctx.changed();
  }
  const refreshMarks = () => side.querySelectorAll('.gf').forEach((r) => r.classList.toggle('on', r.textContent?.startsWith(selected ?? '\0') === true));
  return { root, refresh };
}
