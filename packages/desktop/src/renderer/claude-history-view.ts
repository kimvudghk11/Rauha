import type { TranscriptEntry } from '../shared/claude-history.js';
import type { ClaudeHistoryApi, ClaudeSessionView } from '../shared/claude-history-ipc.js';
import { el, isEnterKey } from './dom.js';
import { button } from './todo-parts.js';

export interface ClaudeHistoryDeps {
  readonly api: ClaudeHistoryApi;
  readonly now: () => number;
  readonly copy: (text: string) => Promise<boolean>;
}

const ago = (iso: string, now: number): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  if (m < 1440 * 14) return `${Math.floor(m / 1440)} d ago`;
  return iso.slice(0, 10);
};
const folderName = (cwd: string): string => cwd.split(/[\\/]/).filter((s) => s !== '').pop() ?? cwd;

/**
 * Claude 대화 내역: 이 컴퓨터에서 Claude Code 로 한 모든 대화(터미널·VS Code·rauha). 왼쪽 목록(검색), 오른쪽 대화(읽기만).
 * claude.ai 웹·앱의 대화는 서버에만 있어 여기 없다.
 */
export function buildClaudeHistory(deps: ClaudeHistoryDeps) {
  const root = el('div', 'chist');
  let sessions: readonly ClaudeSessionView[] = [];
  let selected: string | null = null;
  let query = '';
  let folder = '';

  const tools = el('div', 'chist-tools-bar');
  const search = el('input');
  search.placeholder = 'Search titles and folders';
  search.setAttribute('aria-label', 'Search Claude conversations');
  search.addEventListener('input', () => ((query = search.value), paintList()));
  const folderSel = el('select');
  folderSel.setAttribute('aria-label', 'Project folder');
  folderSel.addEventListener('change', () => ((folder = folderSel.value), paintList()));
  const refresh = button('Refresh', 'btn sm', () => void load());
  const count = el('span', 'hint');
  // rauha 팀원처럼 프로그램이 시작한 대화(<endpoint>… 로 시작)는 기본으로 숨긴다
  let showAuto = false;
  const autoBox = el('input');
  autoBox.type = 'checkbox';
  autoBox.addEventListener('change', () => ((showAuto = autoBox.checked), paintList()));
  const autoLabel = el('label', 'hint chist-auto');
  const autoText = el('span', undefined, 'Show automated runs');
  autoLabel.append(autoBox, autoText);
  autoLabel.title = 'Conversations started by programs (for example rauha teammates), not typed by you';
  tools.append(search, folderSel, autoLabel, refresh, count);

  const body = el('div', 'chist-body');
  const list = el('div', 'chist-list pane');
  const detail = el('div', 'chist-detail pane');
  body.append(list, detail);
  const foot = el('div', 'hint chist-foot', 'Read from Claude Code’s own files on this computer (projects/*.jsonl), read-only. Conversations on claude.ai or the Claude app live on Anthropic’s servers and are not shown here.');
  root.append(tools, body, foot);

  const shown = (): ClaudeSessionView[] => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => (showAuto || !s.automated) && (folder === '' || s.cwd === folder) && (q === '' || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)));
  };

  function paintFolders(): void {
    const folders = [...new Map(sessions.map((s) => [s.cwd, 0])).keys()].sort((a, b) => folderName(a).localeCompare(folderName(b)));
    folderSel.replaceChildren();
    const all = el('option', undefined, `All folders (${folders.length})`);
    all.value = '';
    folderSel.append(all);
    for (const f of folders) {
      const o = el('option', undefined, `${folderName(f)} — ${f}`);
      o.value = f;
      folderSel.append(o);
    }
    folderSel.value = folders.includes(folder) ? folder : '';
  }

  function paintList(): void {
    list.replaceChildren();
    const items = shown();
    count.textContent = `${items.length} of ${sessions.length} conversations`;
    autoText.textContent = `Show automated runs (${sessions.filter((s) => s.automated).length})`;
    if (items.length === 0) return void list.append(el('div', 'hint pad', sessions.length === 0 ? 'No Claude Code conversations found on this computer.' : 'Nothing matches.'));
    const now = deps.now();
    for (const s of items.slice(0, 500)) {
      const row = el('div', `chist-row${s.id === selected ? ' on' : ''}`);
      row.tabIndex = 0;
      row.title = `${s.cwd}\n${s.source}`;
      const meta = el('span', 'dim chist-meta', `${folderName(s.cwd)} · ${ago(s.updatedAt, now)}${s.source === '~/.claude' ? '' : ` · ${s.source}`}`);
      row.append(el('span', 'chist-title', s.title), meta);
      const pick = (): void => void openSession(s);
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) pick();
      });
      list.append(row);
    }
  }

  function bubble(e: TranscriptEntry): HTMLElement {
    const b = el('div', `chist-msg ${e.role}`);
    b.append(el('div', 'chist-who', e.role === 'user' ? 'You' : 'Claude'));
    if (e.text !== '') b.append(el('div', 'chist-text', e.text));
    if (e.tools !== undefined && e.tools.length > 0) {
      const t = el('div', 'chist-tools mono');
      for (const line of e.tools.slice(0, 12)) t.append(el('div', undefined, `▸ ${line}`));
      if (e.tools.length > 12) t.append(el('div', 'dim', `+ ${e.tools.length - 12} more tool calls`));
      b.append(t);
    }
    return b;
  }

  async function openSession(s: ClaudeSessionView): Promise<void> {
    selected = s.id;
    paintList();
    detail.replaceChildren(el('div', 'hint pad', 'Opening…'));
    const r = await deps.api.open(s.id);
    if (selected !== s.id) return;
    if (!r.ok) return void detail.replaceChildren(el('div', 'err pad', r.error));
    const head = el('div', 'bar chist-head');
    const session = s.id.split('/').pop() ?? '';
    head.append(
      el('b', 'grow', s.title),
      button('Copy resume command', 'btn sm', async () => {
        const cmd = `cd "${s.cwd}" && claude --resume ${session}`;
        const ok = await deps.copy(cmd);
        head.querySelector('.chist-copied')?.remove();
        head.append(el('span', 'hint chist-copied', ok ? 'Copied — paste it in a terminal to continue this conversation.' : 'Could not copy.'));
      }),
    );
    const sub = el('div', 'hint chist-sub', `${s.cwd} · started ${s.startedAt.slice(0, 16).replace('T', ' ')} · ${r.data.entries.length} messages${r.data.truncated ? ' (first part only)' : ''}`);
    const msgs = el('div', 'chist-msgs');
    for (const e of r.data.entries) msgs.append(bubble(e));
    detail.replaceChildren(head, sub, msgs);
    detail.scrollTop = 0;
  }

  async function load(): Promise<void> {
    list.replaceChildren(el('div', 'hint pad', 'Reading conversations…'));
    const r = await deps.api.list();
    if (!r.ok) return void list.replaceChildren(el('div', 'err pad', r.error));
    sessions = r.data.sessions;
    paintFolders();
    paintList();
    if (selected === null) detail.replaceChildren(el('div', 'hint pad', `Pick a conversation on the left. Reading from ${r.data.roots.join(' and ')}.`));
  }
  void load();
  return { root };
}
