import type { Overview } from '../shared/git-api.js';
import { primaryGitAction } from '../shared/git-primary.js';
import type { FileChangeView } from '../shared/git-changes.js';
import { el } from './dom.js';
import { type GitCtx, renderDiff } from './git-common.js';

const LABEL_CLASS: Readonly<Record<string, string>> = { M: 'yellow', A: 'green', D: 'red', R: 'blue', '?': 'dim', '!': 'red' };

/** 변경 탭: 바뀐 파일 목록(체크로 스테이지) · diff(줄·hunk 단위로 스테이지) · 커밋 */
export function buildChanges(ctx: GitCtx) {
  const root = el('div', 'gsplit');
  const side = el('div', 'gside');
  const main = el('div', 'gmain');
  root.append(side, main);
  let view: Overview | null = null;
  let selected: string | null = null;
  let diffSide: 'staged' | 'unstaged' = 'unstaged';
  let subject = '';
  let body = '';

  const file = (path: string) => view?.files.find((f) => f.path === path);

  async function setStaged(f: FileChangeView, on: boolean): Promise<void> {
    if (on && f.secret) {
      const a = await ctx.ask({ title: '비밀 파일 같아요', body: `${f.path} 는 비밀 값이 들어 있을 수 있어요. 그래도 스테이지할까요?`, okLabel: '스테이지' });
      if (!a.ok) return;
    }
    await ctx.call(on ? 'stage' : 'unstage', { paths: [f.path] });
    await refresh();
  }

  async function discard(f: FileChangeView): Promise<void> {
    const a = await ctx.ask({ title: '변경을 버릴까요?', body: `${f.path}\n${f.untracked ? '추적하지 않는 새 파일이라 파일이 지워져요.' : '스테이지한 것과 안 한 것 모두 마지막 커밋 상태로 돌아가요.'}\n되돌릴 수 없어요.`, okLabel: '버리기', danger: true });
    if (!a.ok) return;
    if (await ctx.call('discard', { paths: [f.path] })) {
      if (selected === f.path) selected = null;
      await refresh();
    }
  }

  function renderList(): void {
    side.replaceChildren();
    const files = view?.files ?? [];
    const list = el('div', 'gfiles');
    const stagedCount = files.filter((f) => f.staged).length;
    const all = el('label', 'gall');
    const allBox = el('input');
    allBox.type = 'checkbox';
    allBox.checked = files.length > 0 && files.every((f) => f.staged && !f.unstaged);
    allBox.indeterminate = !allBox.checked && stagedCount > 0;
    allBox.disabled = files.length === 0 || files.some((f) => f.conflict);
    allBox.addEventListener('change', async () => {
      const targets = files.filter((f) => !f.conflict && (allBox.checked ? (f.unstaged || !f.staged) && !f.secret : f.staged));
      if (targets.length > 0) await ctx.call(allBox.checked ? 'stage' : 'unstage', { paths: targets.map((f) => f.path) });
      await refresh();
    });
    all.append(allBox, el('span', undefined, files.length === 0 ? '바뀐 파일이 없어요' : `바뀐 파일 ${files.length}개`), el('span', 'dim', stagedCount > 0 ? `· 스테이지 ${stagedCount}` : ''));
    side.appendChild(all);
    for (const f of files) {
      const row = el('div', 'gf row-item');
      row.classList.toggle('on', f.path === selected);
      const box = el('input');
      box.type = 'checkbox';
      box.checked = f.staged && !f.unstaged;
      box.indeterminate = f.staged && f.unstaged;
      box.disabled = f.conflict;
      box.title = f.conflict ? '충돌은 충돌 탭에서 풀어요' : '스테이지';
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => void setStaged(f, box.checked || box.indeterminate));
      const name = f.path.split('/').pop() ?? f.path;
      const dir = f.path.slice(0, f.path.length - name.length);
      const info = el('span', 'gname');
      info.append(el('b', undefined, name), el('span', 'dim', dir === '' ? '' : ` ${dir}`));
      info.title = f.oldPath === null ? f.path : `${f.oldPath} → ${f.path}`;
      const label = el('span', `gb ${LABEL_CLASS[f.label] ?? ''}`, f.label);
      const x = el('button', 'btn ghost icon sm gx', '×');
      x.title = '변경 버리기';
      x.disabled = f.conflict;
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        void discard(f);
      });
      row.append(box, info, ...(f.secret ? [el('span', 'chip red', '비밀?')] : []), label, x);
      row.addEventListener('click', () => {
        selected = f.path;
        diffSide = f.unstaged ? 'unstaged' : 'staged';
        if (f.conflict) return ctx.goto('conflicts');
        renderList();
        void renderMain();
      });
      list.appendChild(row);
    }
    side.appendChild(list);

    const commit = el('div', 'gcommit');
    const title = el('input', 'ginput');
    title.placeholder = '커밋 제목';
    title.value = subject;
    const desc = el('textarea', 'ginput');
    desc.placeholder = '설명 (선택)';
    desc.rows = 3;
    desc.value = body;
    const blocked = view?.files.some((f) => f.conflict) === true;
    const go = el('button', primaryGitAction({ staged: stagedCount, conflicts: blocked, merging: false, ahead: null, behind: null, hasRemote: false }) === 'commit' ? 'btn block primary' : 'btn block', stagedCount > 0 ? `커밋 (${stagedCount}개 파일)` : '커밋');
    const sync = () => {
      subject = title.value;
      body = desc.value;
      go.disabled = stagedCount === 0 || subject.trim() === '' || blocked;
    };
    title.addEventListener('input', sync);
    desc.addEventListener('input', sync);
    go.addEventListener('click', async () => {
      const done = await ctx.call('commit', { subject, body });
      if (done === null) return;
      subject = '';
      body = '';
      ctx.say(done.message);
      await refresh();
    });
    sync();
    commit.append(title, desc, go);
    side.appendChild(commit);
  }

  async function renderMain(): Promise<void> {
    main.replaceChildren();
    const f = selected === null ? undefined : file(selected);
    if (f === undefined) {
      main.appendChild(el('div', 'dim pad', files0() === 0 ? '바뀐 파일이 없어요. 깨끗해요.' : '왼쪽에서 파일을 누르면 바뀐 내용이 보여요.'));
      return;
    }
    const head = el('div', 'gmh');
    head.append(el('b', undefined, f.path), el('span', `gb ${LABEL_CLASS[f.label] ?? ''}`, f.label));
    if (f.staged && f.unstaged) {
      const seg = el('div', 'seg');
      for (const s of ['unstaged', 'staged'] as const) {
        const b = el('button', diffSide === s ? 'on' : '', s === 'unstaged' ? '아직 스테이지 안 한 변경' : '스테이지한 변경');
        b.addEventListener('click', () => {
          diffSide = s;
          void renderMain();
        });
        seg.appendChild(b);
      }
      head.appendChild(seg);
    } else head.appendChild(el('span', 'dim', f.staged ? '스테이지됨' : f.untracked ? '새 파일(추적 안 함)' : '아직 스테이지 안 함'));
    main.appendChild(head);
    const d = await ctx.call('diff', { path: f.path, side: diffSide });
    if (d === null || selected !== f.path) return;
    const mode = diffSide === 'staged' ? 'unstage' : f.untracked ? 'view' : 'stage';
    const pane = renderDiff(d, {
      mode,
      apply: async (selection) => {
        if (await ctx.call('stageSelection', { path: f.path, selection, mode: mode === 'unstage' ? 'unstage' : 'stage' })) await refresh();
      },
    });
    if (f.untracked) pane.prepend(el('div', 'dim pad', '새 파일은 파일 단위로 스테이지해요(왼쪽 체크).'));
    main.appendChild(pane);
  }
  const files0 = () => view?.files.length ?? 0;

  async function refresh(): Promise<void> {
    view = await ctx.call('overview', undefined as never);
    if (view === null) return;
    if (selected !== null && file(selected) === undefined) selected = null;
    const f = selected === null ? undefined : file(selected);
    if (f !== undefined && diffSide === 'unstaged' && !f.unstaged) diffSide = 'staged';
    if (f !== undefined && diffSide === 'staged' && !f.staged) diffSide = 'unstaged';
    renderList();
    await renderMain();
    await ctx.changed();
  }

  return { root, refresh };
}
