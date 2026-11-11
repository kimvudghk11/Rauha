import type { StashView } from '../shared/git-stash.js';
import { el, isEnterKey } from './dom.js';
import type { GitCtx } from './git-common.js';
import { ago } from './git-format.js';

const MESSAGE_MAX = 100;

/**
 * Stash 탭: 바뀐 파일을 잠깐 치워 두고(Stash changes), 목록에서 다시 꺼낸다(Apply는 남기고, Pop은 지운다).
 * Drop은 되돌릴 수 없어 확인 창을 거친다. 동작이 도는 동안 단추를 잠가 같은 동작이 두 번 일어나지 않게 한다.
 */
export function buildStash(ctx: GitCtx) {
  const root = el('div', 'glist gpanel');
  const tools = el('div', 'gtools gstash-tools');
  const message = el('input', 'ginput');
  message.placeholder = 'Message (optional)';
  message.maxLength = MESSAGE_MAX;
  message.setAttribute('aria-label', 'Stash message');
  const untracked = el('input');
  untracked.type = 'checkbox';
  untracked.checked = true;
  const untrackedLabel = el('label', 'hint gstash-check');
  untrackedLabel.append(untracked, 'Include new files');
  untrackedLabel.title = 'Also stash files git does not track yet. Files ignored by .gitignore are never touched.';
  const create = el('button', 'btn', 'Stash changes');
  create.type = 'button';
  tools.append(message, untrackedLabel, create);
  const list = el('div', 'gfiles');
  root.append(tools, list);

  let busy = false;
  /** 한 번에 한 동작만 한다. 도는 동안 모든 단추를 잠근다. */
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    root.querySelectorAll('button, input').forEach((n) => ((n as HTMLButtonElement | HTMLInputElement).disabled = true));
    try {
      await action();
    } finally {
      busy = false;
      // 목록은 곧 다시 그려지지만, 위쪽 입력칸과 단추는 여기서 풀어 준다
      tools.querySelectorAll('button, input').forEach((n) => ((n as HTMLButtonElement | HTMLInputElement).disabled = false));
    }
  }

  async function stashNow(): Promise<void> {
    const done = await ctx.call('stash', { message: message.value, includeUntracked: untracked.checked });
    if (done === null) return;
    message.value = '';
    await ctx.changed();
  }

  async function bring(s: StashView, fn: 'stashApply' | 'stashPop'): Promise<void> {
    const done = await ctx.call(fn, { index: s.index, hash: s.hash });
    if (done === null) return;
    await ctx.changed();
    if (done.conflicts === true) ctx.goto('conflicts');
  }

  async function drop(s: StashView): Promise<void> {
    const a = await ctx.ask({ title: 'Drop this stash?', body: `${s.message}\nstash@{${s.index}}\nThe saved changes are removed from the list. This cannot be undone from the app.`, okLabel: 'Drop', danger: true });
    if (!a.ok) return;
    await ctx.call('stashDrop', { index: s.index, hash: s.hash });
  }

  function draw(rows: readonly StashView[]): void {
    list.replaceChildren();
    if (rows.length === 0) {
      list.appendChild(el('div', 'dim pad', 'No stashes. Stash changes to put them aside and get a clean working folder.'));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    list.appendChild(el('div', 'gall', `Stashes ${rows.length} · latest first`));
    for (const s of rows) {
      const row = el('div', 'gf row-item gcm');
      const info = el('span', 'gname');
      info.title = s.message;
      info.append(el('b', undefined, s.message === '' ? '(no message)' : s.message), el('div', 'dim', `${s.branch === '' ? 'unknown branch' : s.branch} · ${ago(s.at, now)} · stash@{${s.index}}`));
      row.appendChild(info);
      const btn = (label: string, title: string, go: () => Promise<void>, danger = false) => {
        const b = el('button', danger ? 'btn sm danger' : 'btn sm', label);
        b.type = 'button';
        b.title = title;
        b.addEventListener('click', () => void run(go).then(refresh));
        row.appendChild(b);
      };
      btn('Apply', 'Apply these changes and keep the stash', () => bring(s, 'stashApply'));
      btn('Pop', 'Apply these changes and remove the stash from the list', () => bring(s, 'stashPop'));
      btn('Drop', 'Remove this stash without applying it', () => drop(s), true);
      list.appendChild(row);
    }
  }

  async function refresh(): Promise<void> {
    draw((await ctx.call('stashList', undefined as never)) ?? []);
  }

  create.addEventListener('click', () => void run(stashNow).then(refresh));
  message.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) void run(stashNow).then(refresh);
  });
  return { root, refresh };
}
