import type { FileDiffView } from '../shared/git-api.js';
import { branchMark } from '../shared/git-branch-mark.js';
import type { BranchView, LogRow } from '../shared/git-lists.js';
import { el } from './dom.js';
import { type GitCtx, renderDiff } from './git-common.js';
import { ago } from './git-format.js';
import { gitIcon } from './git-icons.js';
import { openNewBranchDialog, trackBadgeEl } from './git-branch-ui.js';
import { logMatches, sortBranchesRecent } from '../shared/git-lists.js';
import { graphCell, graphCols } from './git-graph-view.js';
import { layoutGraph } from '../shared/git-graph.js';
import { ConflictText, type ConflictChoice } from '../shared/conflict-text.js';

const NL = String.fromCharCode(10);
/** 3-way 화면에 한 번에 그리는 구역 수 상한(나머지는 글상자에서 고친다) */
const CONFLICT_BLOCK_CAP = 100;

/** 브랜치 탭: 로컬·원격 목록, 새로 만들기(지금 브랜치에서), 전환, 현재 브랜치로 머지, 안전한 삭제(-d) */
export function buildBranches(ctx: GitCtx) {
  const root = el('div', 'glist gpanel');
  const tools = el('div', 'gtools');
  const filter = el('input', 'ginput');
  filter.placeholder = 'Search branches';
  const create = el('button', 'btn primary');
  create.append(gitIcon('plus'), el('span', undefined, 'New branch'));
  tools.append(filter, create);
  const list = el('div', 'gfiles');
  root.append(tools, list);
  let all: readonly BranchView[] = [];

  const act = async (fn: 'switchBranch' | 'merge' | 'deleteBranch', b: BranchView, title?: string) => {
    if (title !== undefined) {
      const a = await ctx.ask({ title, body: b.name, okLabel: 'OK', danger: fn === 'deleteBranch' });
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
      list.appendChild(el('div', 'gall', `My branches ${rows.length} · latest commit first`));
      for (const b of rows) {
        const mark = branchMark(b.name, b.current);
        const row = el('div', `gf row-item${b.current ? ' on' : ''} ${mark.className}`);
        row.title = mark.title;
        const name = el('span', 'gname');
        name.append(el('b', 'mono', b.name));
        row.appendChild(name);
        if (mark.badge !== null) row.appendChild(el('span', 'chip blue', mark.badge));
        if (b.author !== '') row.appendChild(el('span', 'gbauthor', b.author));
        if (b.team) row.appendChild(el('span', 'chip purple', 'Team work'));
        if (ctx.isProtected(b.name)) {
          const lock = el('span', 'chip red');
          lock.append(gitIcon('lock'), 'Protected');
          row.appendChild(lock);
        }
        const tb = trackBadgeEl(b);
        if (tb !== null) row.appendChild(tb);
        const btn = (label: string, fn: () => void, danger = false) => {
          const x = el('button', danger ? 'btn sm danger' : 'btn sm', label);
          if (label.includes('Merge')) x.prepend(gitIcon('merge'));
          x.addEventListener('click', fn);
          row.appendChild(x);
        };
        if (!b.current) btn('Switch', () => void act('switchBranch', b));
        if (!b.current && !b.remote) btn('Merge into current', () => void act('merge', b, 'Merge this branch into the current branch?'));
        if (!b.current && !b.remote) btn('Delete', () => void act('deleteBranch', b, 'Delete this branch? (git refuses if it has unmerged commits)'), true);
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

/** Blame 등 다른 화면이 "이 커밋을 히스토리에서 열어 줘"라고 부탁하는 쪽지. 히스토리 탭이 다음에 그릴 때 읽는다. */
let wantedCommit = '';
export function requestHistoryCommit(hash: string): void {
  wantedCommit = hash;
}

/** 히스토리 탭: 최근 500개 커밋을 브랜치 선(그래프)과 함께 보이고, 고른 커밋의 diff를 오른쪽에 보인다 */
export function buildHistory(ctx: GitCtx) {
  const root = el('div', 'gsplit');
  const side = el('div', 'gside');
  const main = el('div', 'gmain');
  root.append(side, main);
  let selected = '';
  let allBranches = false;
  const opts = el('label', 'gall');
  const allBox = el('input');
  allBox.type = 'checkbox';
  opts.append(allBox, el('span', undefined, 'All branches'));
  allBox.addEventListener('change', () => {
    allBranches = allBox.checked;
    void refresh();
  });
  let listBox = el('div', 'gfiles');
  // 찾기: 제목·작성자·해시·브랜치 이름. 찾는 동안에는 그래프 선이 끊겨 보이므로 숨긴다
  const find = el('input', 'sm ghfind');
  find.placeholder = 'Find commits (subject, author, hash, branch)';
  find.spellcheck = false;
  let shown: readonly LogRow[] = [];
  const applyFind = (): void => {
    const q = find.value;
    listBox.classList.toggle('finding', q.trim() !== '');
    [...listBox.querySelectorAll<HTMLElement>('.gcm')].forEach((n, i) => {
      const r = shown[i];
      n.hidden = r !== undefined && !logMatches(r, q);
    });
  };
  find.addEventListener('input', applyFind);
  side.append(opts, find, listBox);
  async function show(row: LogRow): Promise<void> {
    selected = row.hash;
    main.replaceChildren(el('div', 'dim pad', 'Loading…'));
    const files = (await ctx.call('commitDiff', { hash: row.hash })) as readonly FileDiffView[] | null;
    if (files === null || selected !== row.hash) return;
    main.replaceChildren();
    const head = el('div', 'gmh');
    head.append(el('b', undefined, row.subject), el('span', 'dim mono', row.short), el('span', 'dim', `${row.author} · ${files.length} file(s)`));
    if (row.parents.length > 1) head.append(el('span', 'chip purple', `Merge of ${row.parents.length} parents`));
    const tools = el('span', 'btns ghtools');
    const copy = el('button', 'btn sm', 'Copy hash');
    copy.type = 'button';
    copy.addEventListener('click', () => void navigator.clipboard.writeText(row.hash).then(() => ctx.say(`Copied ${row.short}.`)));
    const branchHere = el('button', 'btn sm', 'Create branch here');
    branchHere.type = 'button';
    branchHere.title = 'Start a new branch from this commit and switch to it';
    branchHere.addEventListener('click', async () => {
      const a = await ctx.ask({ title: `New branch from ${row.short}`, body: `Starts at "${row.subject}". Your changed files come along.`, input: { label: 'Branch name', value: '' }, okLabel: 'Create and switch' });
      if (!a.ok || a.value.trim() === '') return;
      const done = await ctx.call('createBranch', { name: a.value.trim(), base: row.hash, checkout: true });
      if (done !== null) await ctx.reload();
    });
    tools.append(copy, branchHere);
    head.append(tools);
    main.appendChild(head);
    for (const f of files) {
      main.appendChild(el('div', 'gh', f.path));
      main.appendChild(renderDiff(f, { mode: 'view' }));
    }
  }
  async function refresh(): Promise<void> {
    const rows = (await ctx.call('log', allBranches ? { all: true } : {})) ?? [];
    const lanes = layoutGraph(rows);
    const cols = graphCols(lanes);
    if (wantedCommit !== '') {
      const hit = rows.find((r) => r.hash === wantedCommit || r.hash.startsWith(wantedCommit));
      if (hit === undefined && !allBranches) {
        // 이 브랜치에 없는 커밋이면 모든 브랜치로 넓혀 다시 찾는다
        allBranches = true;
        allBox.checked = true;
        return refresh();
      }
      wantedCommit = '';
      if (hit !== undefined) void show(hit);
    }
    const list = el('div', 'gfiles');
    const now = Math.floor(Date.now() / 1000);
    rows.forEach((r, i) => {
      const row = el('div', `gf row-item gcm${r.hash === selected ? ' on' : ''}`);
      const lane = lanes[i];
      if (lane !== undefined) row.appendChild(graphCell(lane, cols));
      const info = el('span', 'gname');
      info.append(el('b', undefined, r.subject), el('div', 'dim', `${r.author} · ${ago(r.at, now)} · ${r.short}`));
      row.appendChild(info);
      if (r.parents.length > 1) row.appendChild(el('span', 'chip', 'Merge'));
      for (const ref of r.refs.filter((x) => !x.startsWith('tag:'))) row.appendChild(el('span', ref.includes('rauha/job-') ? 'chip purple' : 'chip', ref.replace('HEAD -> ', '')));
      row.addEventListener('click', () => {
        list.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
        row.classList.add('on');
        void show(r);
      });
      list.appendChild(row);
    });
    if (rows.length === 0) list.appendChild(el('div', 'dim pad', 'No commits yet.'));
    listBox.replaceWith(list);
    listBox = list;
    shown = rows;
    applyFind();
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
    const r = await ctx.call('readConflict', { path, base: true });
    if (r === null) return;
    const head = el('div', 'gmh');
    head.appendChild(el('b', undefined, path));
    const area = el('textarea', 'ginput gconf');
    area.value = ConflictText.withBase(r.text, r.diff3 ?? null).toText();
    area.spellcheck = false;
    const done = async (fn: () => Promise<unknown>) => {
      if (await fn()) await refresh();
    };
    // 3-way 미리보기: 구역마다 Mine · Base(있으면) · Theirs 를 나란히 보이고, 구역별로 받을 쪽을 고른다. 아래 글상자를 고치면 바로 따라 바뀐다.
    const preview = el('div', 'gconfview');
    const accept = (index: number, choice: ConflictChoice): void => {
      area.value = ConflictText.parse(area.value).resolve(index, choice).toText();
      drawPreview();
    };
    const drawPreview = (): void => {
      const t = ConflictText.parse(area.value);
      preview.replaceChildren();
      const n = t.count();
      preview.append(el('div', 'gconfsum', n === 0 ? 'All conflict markers are gone. Press "Resolved".' : `${n} place(s) to resolve · pick Mine, Theirs or Both for each place`));
      let k = -1;
      for (const part of t.parts) {
        if (part.kind === 'plain') {
          const shown = part.lines.length > 6 ? [...part.lines.slice(0, 3), '…', ...part.lines.slice(-3)] : part.lines;
          preview.append(el('pre', 'gconfplain', shown.join(NL)));
          continue;
        }
        k++;
        if (k >= CONFLICT_BLOCK_CAP) {
          if (k === CONFLICT_BLOCK_CAP) preview.append(el('div', 'gconfsum', `More places are below. Resolve the first ${CONFLICT_BLOCK_CAP}, or edit the text box.`));
          continue;
        }
        const index = k;
        const block = el('div', 'gconfblock');
        const bar = el('div', 'gconfbar');
        bar.append(el('b', undefined, `Place ${index + 1} of ${n}`));
        const pick = (label: string, choice: ConflictChoice, cls = '') => {
          const b = el('button', cls === '' ? 'btn sm' : `btn sm ${cls}`, label);
          b.type = 'button';
          b.addEventListener('click', () => accept(index, choice));
          bar.append(b);
        };
        pick('Accept mine', 'mine', 'gours');
        pick('Accept theirs', 'theirs', 'gtheirs');
        pick('Accept both', 'both');
        if (part.base !== undefined) pick('Accept base', 'base');
        const cols = el('div', `gconfcols${part.base === undefined ? ' two' : ''}`);
        const side = (cls: 'ours' | 'base' | 'theirs', who: string, label: string, lines: readonly string[]) => {
          const box = el('div', `gconfside ${cls}`);
          box.append(el('div', 'gconfwho', `${who}${label === '' ? '' : ` · ${label}`}`), el('pre', 'gconfcode', lines.length === 0 ? '(empty)' : lines.join(NL)));
          cols.append(box);
        };
        side('ours', 'Mine', part.oursLabel, part.ours);
        if (part.base !== undefined) side('base', 'Base', '', part.base);
        side('theirs', 'Theirs', part.theirsLabel, part.theirs);
        block.append(bar, cols);
        preview.append(block);
      }
    };
    area.addEventListener('input', drawPreview);
    drawPreview();
    const mk = (label: string, fn: () => Promise<unknown>, cls = '') => {
      const b = el('button', cls === '' ? 'btn' : `btn ${cls}`, label);
      b.addEventListener('click', () => void done(fn));
      head.appendChild(b);
    };
    mk('Use mine (current branch)', () => ctx.call('resolveSide', { path, side: 'ours' }), 'gours');
    mk('Use theirs', () => ctx.call('resolveSide', { path, side: 'theirs' }), 'gtheirs');
    mk('Save', () => ctx.call('writeConflict', { path, text: area.value }));
    mk('Resolved', async () => (await ctx.call('writeConflict', { path, text: area.value })) && (await ctx.call('markResolved', { path })), 'primary');
    main.append(head, preview, area);
  }
  async function refresh(): Promise<void> {
    const s = await ctx.call('mergeState', undefined as never);
    side.replaceChildren();
    if (s === null) return;
    const list = el('div', 'gfiles');
    list.appendChild(el('div', 'gall', s.conflicts.length === 0 ? 'No conflicts to resolve' : `${s.conflicts.length} conflict(s)`));
    for (const p of s.conflicts) {
      const row = el('div', `gf row-item${p === selected ? ' on' : ''}`);
      row.append(el('span', 'gname', p), el('span', 'gb red', '!'));
      row.addEventListener('click', () => void edit(p).then(refreshMarks));
      list.appendChild(row);
    }
    side.appendChild(list);
    const foot = el('div', 'gcommit');
    const finish = el('button', 'btn primary', 'Finish merge');
    finish.disabled = !s.merging || s.conflicts.length > 0;
    finish.addEventListener('click', async () => {
      if (await ctx.call('finishMerge', undefined as never)) {
        await ctx.changed();
        ctx.goto('changes');
      }
    });
    const abort = el('button', 'btn danger', 'Abort merge');
    abort.disabled = !s.merging;
    abort.addEventListener('click', async () => {
      const a = await ctx.ask({ title: 'Abort the merge?', body: 'The merge is canceled and everything goes back as it was. Edits made while resolving are lost.', okLabel: 'Abort', danger: true });
      if (a.ok && (await ctx.call('abortMerge', undefined as never))) {
        await ctx.changed();
        ctx.goto('changes');
      }
    });
    foot.append(finish, abort);
    side.appendChild(foot);
    if (s.conflicts.length === 0) main.replaceChildren(el('div', 'dim pad', s.merging ? 'All conflicts are resolved. Press "Finish merge".' : 'No merge in progress.'));
    else if (selected === null || !s.conflicts.includes(selected)) void edit(s.conflicts[0]!);
    await ctx.changed();
  }
  const refreshMarks = () => side.querySelectorAll('.gf').forEach((r) => r.classList.toggle('on', r.textContent?.startsWith(selected ?? '\0') === true));
  return { root, refresh };
}
