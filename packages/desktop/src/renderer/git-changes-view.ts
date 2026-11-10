import type { Overview } from '../shared/git-api.js';
import { primaryGitAction } from '../shared/git-primary.js';
import type { FileChangeView } from '../shared/git-changes.js';
import { el } from './dom.js';
import { type GitCtx, renderDiff } from './git-common.js';
import { gitIcon } from './git-icons.js';
import { buildWorktreeGraph } from './git-worktree-graph.js';
import { commitBlockReason, stageSummary, subjectState, SUBJECT_LIMIT } from '../shared/git-toolbar.js';
import type { ConventionsView } from '../shared/git-conventions-view.js';
import { FILE_FIRST, FILE_MORE, moreLabel, nextLimit } from '../shared/git-window.js';

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
  /** 방금 한 커밋(되돌리기 안내용). 다른 동작을 하면 사라진다 */
  let justCommitted: { hash: string; subject: string } | null = null;
  /** 목록에 그릴 파일 수. 수천 개가 바뀐 레포에서 한꺼번에 그리면 느려서 처음엔 일부만 그리고 "더 보기"로 늘린다 */
  let fileLimit = FILE_FIRST;

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

  let guide: ConventionsView | null = null;
  void ctx.conventions().then((v) => {
    guide = v;
    if (view !== null) renderList();
  });

  /** 제목 앞의 말머리(feat(범위): 또는 [태그])를 걷어 낼 때 쓴다 */
  const PREFIX = /^([a-z]+(\([^)]*\))?!?: ?|\[[^\]]+\] ?)/;

  /** 커밋 입력: 제목(한 줄, 글자 수) · 설명(선택) · 이 레포 방식 안내와 말머리 칩 · 스테이지 요약과 커밋 버튼 · 커밋 뒤 되돌리기 */
  function renderCommit(stagedCount: number): HTMLElement {
    const box = el('div', 'gcommit');
    const blocked = view?.files.some((f) => f.conflict) === true;
    if (guide !== null) {
      box.append(el('div', 'hint', guide.commit.text));
      if (guide.commit.chips.length > 0) {
        const chips = el('div', 'chips');
        for (const p of guide.commit.chips) {
          const chip = el('button', 'chip', p.trim());
          chip.type = 'button';
          chip.title = '제목 앞에 넣기';
          chip.addEventListener('click', () => {
            title.value = p + title.value.replace(PREFIX, "");
            title.focus();
            sync();
          });
          chips.append(chip);
        }
        box.append(chips);
      }
    }
    const subjectRow = el('div', 'gfield');
    const title = el('input');
    title.placeholder = guide === null ? '커밋 제목 (한 줄)' : `제목 · 예: ${guide.commit.example}`;
    title.value = subject;
    const count = el('span', 'fld-count');
    const head = el('div', 'gsub');
    head.append(el('span', 'lbl', '제목'), count);
    subjectRow.append(head, title);
    const descRow = el('div', 'gfield');
    const desc = el('textarea');
    desc.placeholder = '설명 (선택) — 왜 바꿨는지';
    desc.rows = 2;
    desc.value = body;
    descRow.append(desc);

    const act = el('div', 'gact');
    const go = el('button', primaryGitAction({ staged: stagedCount, conflicts: blocked, merging: false, ahead: null, behind: null, hasRemote: false }) === 'commit' ? 'btn primary' : 'btn');
    go.append(gitIcon('commit'), el('span', undefined, '커밋'));
    const sum = el('span', 'hint', '');
    const why = el('div', 'hint', '');
    act.append(go, sum);
    const sync = (): void => {
      subject = title.value;
      body = desc.value;
      const st = subjectState(subject);
      count.textContent = `${st.length}/${SUBJECT_LIMIT}`;
      count.className = st.warn ? 'fld-count warn' : 'fld-count';
      count.title = st.warn ? '제목이 길어요. 72자 안쪽이 읽기 좋아요(커밋은 할 수 있어요).' : '';
      sum.textContent = stagedCount > 0 ? stageSummary(stagedCount, view?.staged?.added ?? null, view?.staged?.removed ?? null) : '';
      const reason = commitBlockReason({ staged: stagedCount, subject, conflicts: blocked });
      go.disabled = reason !== null;
      why.textContent = reason ?? (st.warn ? `제목이 ${SUBJECT_LIMIT}자를 넘었어요. 줄이면 좋지만 커밋은 할 수 있어요.` : '');
      why.className = reason === null && st.warn ? 'err' : 'hint';
    };
    title.addEventListener('input', sync);
    desc.addEventListener('input', sync);
    go.addEventListener('click', async () => {
      const done = await ctx.call('commit', { subject, body });
      if (done === null) return;
      justCommitted = { hash: done.hash ?? '', subject: subject.trim() };
      subject = '';
      body = '';
      ctx.say(done.message);
      await refresh();
    });
    sync();
    box.append(subjectRow, descRow, act, why);
    if (justCommitted !== null) {
      const done = justCommitted;
      const note = el('div', 'gnote');
      const undo = el('button', 'btn sm');
      undo.append(gitIcon('undo'), el('span', undefined, '직전 커밋 취소'));
      undo.title = '커밋만 취소하고 바뀐 내용은 스테이지에 그대로 둬요';
      undo.addEventListener('click', async () => {
        const a = await ctx.ask({ title: '직전 커밋을 취소할까요?', body: `${done.hash.slice(0, 7)} ${done.subject}\n\n커밋만 없던 일로 하고, 바뀐 내용은 스테이지에 그대로 남아요(soft reset). 이미 원격에 올린 커밋은 취소할 수 없어요.`, okLabel: '커밋 취소' });
        if (!a.ok) return;
        if (await ctx.call('undoCommit', undefined as never)) {
          justCommitted = null;
          subject = done.subject;
          await refresh();
        }
      });
      note.append(el('span', 'hint grow', `커밋했어요 ${done.hash.slice(0, 7)}`), undo);
      box.append(note);
    }
    return box;
  }

  const wt = buildWorktreeGraph(ctx);

  function renderList(): void {
    side.replaceChildren(wt.root);
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
    for (const f of files.slice(0, fileLimit)) {
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
    if (files.length > fileLimit) {
      const more = el('button', 'btn gmore', moreLabel(fileLimit, files.length, FILE_MORE));
      more.type = 'button';
      more.addEventListener('click', () => {
        fileLimit = nextLimit(fileLimit, files.length, FILE_MORE);
        const top = side.querySelector('.gfiles')?.scrollTop ?? 0;
        renderList();
        const next = side.querySelector('.gfiles');
        if (next !== null) next.scrollTop = top;
      });
      list.appendChild(more);
    }
    side.appendChild(list);

    side.appendChild(renderCommit(stagedCount));
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
    ctx.adopt(view);
    if (selected !== null && file(selected) === undefined) selected = null;
    const f = selected === null ? undefined : file(selected);
    if (f !== undefined && diffSide === 'unstaged' && !f.unstaged) diffSide = 'staged';
    if (f !== undefined && diffSide === 'staged' && !f.staged) diffSide = 'unstaged';
    renderList();
    void wt.refresh();
    await renderMain();
  }

  return { root, refresh };
}
