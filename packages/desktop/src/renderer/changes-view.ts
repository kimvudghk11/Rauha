import type { ChangesView, CheckpointDiff } from '../shared/checkpoint-api.js';
import type { FileChange } from '../shared/checkpoint.js';
import { FILE_FIRST, FILE_MORE, moreLabel } from '../shared/git-window.js';
import { el } from './dom.js';
import { askDialog, renderDiff } from './git-common.js';

const KIND_CHIP: Readonly<Record<FileChange['kind'], readonly [string, string]>> = {
  added: ['chip green', 'Added'],
  modified: ['chip blue', 'Modified'],
  deleted: ['chip red', 'Deleted'],
};

/** 작업 하나의 변경 보기 상태. 결과 카드와 상세 패널이 같은 것을 보므로 작업 id 로 하나만 둔다. */
interface Shared {
  view: ChangesView | null;
  loaded: boolean;
  loading: boolean;
  /** 펼쳐 둔 파일 */
  open: Set<string>;
  diffs: Map<string, CheckpointDiff | string>;
  message: { text: string; bad: boolean } | null;
  busy: boolean;
  shown: number;
  hosts: Set<() => boolean>;
  /** 기록이 아직 없을 때 다시 읽은 횟수(멈춘 일은 끝 기록이 조금 늦게 남을 수 있다) */
  retries: number;
}

const shared = new Map<string, Shared>();

const stateOf = (jobId: string): Shared => {
  let s = shared.get(jobId);
  if (s === undefined) {
    s = { view: null, loaded: false, loading: false, open: new Set(), diffs: new Map(), message: null, busy: false, shown: FILE_FIRST, hosts: new Set(), retries: 0 };
    shared.set(jobId, s);
  }
  return s;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const errorText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'Something went wrong.');

/** 모든 보이는 패널을 다시 그린다(사라진 패널은 목록에서 뺀다) */
function repaint(s: Shared): void {
  for (const paint of [...s.hosts]) if (!paint()) s.hosts.delete(paint);
}

async function refresh(jobId: string): Promise<void> {
  const s = stateOf(jobId);
  s.loading = true;
  try {
    s.view = (await window.rauha.checkpoint.changes({ jobId })) ?? null;
  } catch {
    s.view = null;
  }
  s.loaded = s.view !== null;
  s.loading = false;
  repaint(s);
  if (s.view === null && s.retries < 2) {
    s.retries += 1;
    setTimeout(() => void refresh(jobId), 2500);
  }
}

/** 한 번에 하나만: 끝나면 목록을 다시 읽는다 */
async function guarded(jobId: string, work: () => Promise<void>): Promise<void> {
  const s = stateOf(jobId);
  if (s.busy) return;
  s.busy = true;
  repaint(s);
  try {
    await work();
  } catch (e) {
    s.message = { text: errorText(e), bad: true };
  } finally {
    s.busy = false;
    await refresh(jobId);
  }
}

function revert(jobId: string, paths?: readonly string[]): Promise<void> {
  return guarded(jobId, async () => {
    const s = stateOf(jobId);
    const api = window.rauha.checkpoint;
    const preview = await api.preview(paths === undefined ? { jobId } : { jobId, paths });
    if (preview.files === 0) {
      s.message = { text: preview.body, bad: false };
      return;
    }
    const ok = await askDialog({ title: preview.title, body: preview.body, okLabel: preview.okLabel, danger: true });
    if (!ok.ok) return;
    const done = await api.revert(paths === undefined ? { jobId } : { jobId, paths });
    s.message = { text: done.message, bad: done.reverted === 0 };
    for (const p of paths ?? []) dropDiff(jobId, p);
  });
}

/** hunk 하나만 되돌린다: 미리보기(충돌·이미 되돌림이면 알리기만) → 확인창 → 되돌리기. hunk 는 내용 해시로 가리킨다. */
function revertHunk(jobId: string, path: string, hunk: string): Promise<void> {
  return guarded(jobId, async () => {
    const s = stateOf(jobId);
    const api = window.rauha.checkpoint;
    const preview = await api.previewHunk({ jobId, path, hunk });
    if (preview.files === 0) {
      s.message = { text: preview.body, bad: preview.conflicts.length > 0 };
      dropDiff(jobId, path);
      return;
    }
    const ok = await askDialog({ title: preview.title, body: preview.body, okLabel: preview.okLabel, danger: true });
    if (!ok.ok) return;
    const done = await api.revertHunk({ jobId, path, hunk });
    s.message = { text: done.message, bad: done.reverted === 0 };
    dropDiff(jobId, path);
  });
}

/** 읽어 둔 diff 를 버린다(되돌린 뒤 상태가 달라졌으므로). 펼쳐 둔 파일이면 바로 다시 읽는다. */
function dropDiff(jobId: string, path: string): void {
  const s = stateOf(jobId);
  s.diffs.delete(path);
  if (s.open.has(path)) void loadDiff(jobId, path);
}

function undoRevert(jobId: string): Promise<void> {
  return guarded(jobId, async () => {
    const s = stateOf(jobId);
    const ok = await askDialog({ title: 'Undo the undo?', body: 'Brings back the changes you reverted, using the backup Rauha saved. If you edited those files since, nothing is changed.', okLabel: 'Undo the undo' });
    if (!ok.ok) return;
    s.message = { text: (await window.rauha.checkpoint.undoRevert({ jobId })).message, bad: false };
  });
}

function discardBranch(jobId: string, branch: string): Promise<void> {
  return guarded(jobId, async () => {
    const s = stateOf(jobId);
    const ok = await askDialog({ title: `Discard branch ${branch}?`, body: `Deletes the branch that holds this job's changes. Your own files are not touched.\nThis cannot be undone from Rauha: after Git cleans up, the commits are gone.`, okLabel: 'Discard branch', danger: true });
    if (!ok.ok) return;
    s.message = { text: (await window.rauha.checkpoint.discardBranch({ jobId })).message, bad: false };
  });
}

async function loadDiff(jobId: string, path: string): Promise<void> {
  const s = stateOf(jobId);
  if (s.diffs.has(path)) return;
  s.diffs.set(path, 'Loading…');
  repaint(s);
  try {
    s.diffs.set(path, await window.rauha.checkpoint.diff({ jobId, path }));
  } catch (e) {
    s.diffs.set(path, errorText(e));
  }
  repaint(s);
}

/**
 * 끝난 작업의 변경 보기: 바뀐 파일 목록(추가·수정·삭제, +줄 −줄), 파일을 누르면 읽기 전용 diff, 파일별 되돌리기와 전체 되돌리기.
 * 작업에 기록된 변경이 없으면 숨는다. mode 'card': 결과 카드(접힌 채 시작) · 'detail': 상세 패널(펼친 채 시작).
 */
export function changesPanel(jobId: string, mode: 'card' | 'detail'): HTMLElement {
  const s = stateOf(jobId);
  const host = el('div', 'chg');
  host.hidden = true;
  let expanded = mode === 'detail';
  let seen = false;

  const paint = (): boolean => {
    if (host.isConnected) seen = true;
    else if (seen) return false;
    const view = s.view;
    host.replaceChildren();
    host.hidden = view === null;
    if (view === null) return true;

    const head = el('div', 'chg-head');
    const t = view.totals;
    const title = view.place === 'worktree' ? `Changes on branch ${view.workBranch ?? ''}` : 'Changes';
    head.append(el('b', undefined, title), el('span', 'dim', plural(t.files, 'file', 'files')), el('span', 'chg-add', `+${t.added}`), el('span', 'chg-del', `−${t.removed}`));
    const toggle = el('button', 'link chg-toggle', expanded ? 'Hide changes' : 'Review changes');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      paint();
    });
    head.appendChild(toggle);
    host.appendChild(head);
    if (s.message !== null) host.appendChild(el('div', s.message.bad ? 'chg-msg err' : 'chg-msg', s.message.text));
    if (!expanded) return true;

    const notes: string[] = [];
    if (view.startDirty > 0) notes.push(`You had ${plural(view.startDirty, 'uncommitted file', 'uncommitted files')} when the job started. Changes you already had are not counted as this job's.`);
    if (view.hiddenCount > 0) notes.push(`${plural(view.hiddenCount, 'secret file', 'secret files')} with uncommitted changes ${view.hiddenCount === 1 ? 'is' : 'are'} hidden. Rauha never shows or reverts them.`);
    for (const n of notes) host.appendChild(el('div', 'chg-note dim', n));

    const list = el('div', 'chg-list');
    for (const f of view.files.slice(0, s.shown)) list.appendChild(fileRow(f));
    if (view.files.length > s.shown) {
      const more = el('button', 'btn sm chg-more', moreLabel(s.shown, view.files.length, FILE_MORE));
      more.type = 'button';
      more.addEventListener('click', () => {
        s.shown = Math.min(view.files.length, s.shown + FILE_MORE);
        repaint(s);
      });
      list.appendChild(more);
    }
    host.appendChild(list);

    const foot = el('div', 'btns chg-foot');
    const pending = view.revertBlock === null && Object.values(view.states).some((a) => a === 'restore' || a === 'delete');
    const anyState = Object.keys(view.states).length > 0;
    if (view.revertBlock === null && (pending || !anyState)) {
      const all = el('button', 'btn danger', 'Undo all changes');
      all.type = 'button';
      all.disabled = s.busy;
      all.title = 'Put every file this job changed back the way it was before the job. You will be asked first.';
      all.addEventListener('click', () => void revert(jobId));
      foot.appendChild(all);
    }
    if (view.discardBlock === null) {
      const discard = el('button', 'btn danger', 'Discard branch');
      discard.type = 'button';
      discard.disabled = s.busy;
      discard.title = 'Delete the branch that holds this job\'s changes. You will be asked first.';
      discard.addEventListener('click', () => void discardBranch(jobId, view.workBranch ?? ''));
      foot.appendChild(discard);
    }
    if (view.backup !== null) {
      const undo = el('button', 'btn', 'Undo the undo');
      undo.type = 'button';
      undo.disabled = s.busy;
      undo.title = `Bring back the ${plural(view.backup.files, 'file', 'files')} you reverted, from the backup Rauha saved`;
      undo.addEventListener('click', () => void undoRevert(jobId));
      foot.appendChild(undo);
    }
    if (foot.childElementCount > 0) host.appendChild(foot);
    if (view.revertBlock !== null) host.appendChild(el('div', 'chg-note dim', view.revertBlock));
    return true;
  };

  const fileRow = (f: FileChange): HTMLElement => {
    const view = s.view!;
    const wrap = el('div', 'chg-item');
    const row = el('div', 'chg-row');
    const [cls, label] = KIND_CHIP[f.kind];
    const name = el('button', 'chg-file mono', f.path);
    name.type = 'button';
    name.title = 'Show what changed in this file';
    const isOpen = s.open.has(f.path);
    name.setAttribute('aria-expanded', String(isOpen));
    name.addEventListener('click', () => {
      if (s.open.has(f.path)) s.open.delete(f.path);
      else {
        s.open.add(f.path);
        void loadDiff(jobId, f.path);
      }
      repaint(s);
    });
    row.append(el('span', cls, label), name, el('span', 'chg-add', f.binary ? 'bin' : `+${f.added}`), el('span', 'chg-del', f.binary ? '' : `−${f.removed}`));
    const action = view.states[f.path];
    if (action === 'already') row.appendChild(el('span', 'chip', 'Reverted'));
    else if (action === 'conflict') {
      const chip = el('span', 'chip yellow', 'Conflict');
      chip.title = 'Conflict: this file changed after the job, so Rauha will not overwrite it.';
      row.appendChild(chip);
    } else if (view.revertBlock === null) {
      const one = el('button', 'btn sm', 'Revert file');
      one.type = 'button';
      one.disabled = s.busy;
      one.title = `Put ${f.path} back the way it was before the job. You will be asked first.`;
      one.addEventListener('click', () => void revert(jobId, [f.path]));
      row.appendChild(one);
    }
    wrap.appendChild(row);
    if (isOpen) {
      const body = el('div', 'chg-diff');
      const d = s.diffs.get(f.path);
      if (d === undefined || typeof d === 'string') body.appendChild(el('div', 'dim pad', d ?? 'Loading…'));
      else body.appendChild(renderDiff(d, { mode: 'view', hunkTag: (i) => hunkTag(f.path, d, i) }));
      wrap.appendChild(body);
    }
    return wrap;
  };

  /** hunk 머리줄 오른쪽: 되돌릴 수 있으면 Revert hunk 단추, 이미 되돌렸거나 충돌이면 표시 */
  const hunkTag = (path: string, d: CheckpointDiff, i: number): HTMLElement | null => {
    const state = d.hunkStates[i];
    const id = d.hunkIds[i];
    if (state === undefined || id === undefined) return null;
    if (state === 'already') return el('span', 'chip', 'Reverted');
    if (state === 'conflict') {
      const chip = el('span', 'chip yellow', 'Conflict');
      chip.title = 'Conflict: this part of the file changed after the job, so Rauha will not overwrite it.';
      return chip;
    }
    const b = el('button', 'btn sm', 'Revert hunk');
    b.type = 'button';
    b.disabled = s.busy;
    b.title = 'Put only this part of the file back the way it was before the job. You will be asked first.';
    b.addEventListener('click', () => void revertHunk(jobId, path, id));
    return b;
  };

  s.hosts.add(paint);
  if (s.loaded) paint();
  else if (!s.loading) void refresh(jobId);
  return host;
}
