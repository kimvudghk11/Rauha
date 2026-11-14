import type { TranscriptEntry } from '../shared/claude-history.js';
import type { ClaudeHistoryApi, ClaudeSessionView } from '../shared/claude-history-ipc.js';
import { actionSummary, groupTurns, touchedFiles, type Turn } from '../shared/conversation-turns.js';
import { RecordEntry } from '../shared/record-book.js';
import { buildBlogPanel, type BlogPanelDeps } from './blog-view.js';
import { el, isEnterKey } from './dom.js';
import { button } from './todo-parts.js';

export interface ClaudeHistoryDeps {
  readonly api: ClaudeHistoryApi;
  readonly now: () => number;
  readonly copy: (text: string) => Promise<boolean>;
  /** 대화 하나로 블로그 글 쓰기(기록 탭의 블로그 패널을 그대로 쓴다). 없으면 단추를 숨긴다 */
  readonly blog?: Omit<BlogPanelDeps, 'copy'>;
}

/** 출처 칩: 모든 대화 / Claude Code / Kiro / ChatGPT */
type SourceKind = 'all' | 'claude' | 'kiro' | 'codex';
const SOURCE_LABEL: Readonly<Record<SourceKind, string>> = { all: 'All', claude: 'Claude Code', kiro: 'Kiro', codex: 'ChatGPT' };
const kindOf = (s: ClaudeSessionView): SourceKind => (s.id.startsWith('kiro') ? 'kiro' : s.id.startsWith('codex:') ? 'codex' : 'claude');

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
  // 출처 칩과 "내 질문만" 보기
  let kind: SourceKind = 'all';
  let onlyMine = false;
  const chips = el('div', 'chist-sources');
  const paintChips = (): void => {
    chips.replaceChildren(
      ...(['all', 'claude', 'kiro', 'codex'] as const).map((k) => {
        const n = k === 'all' ? sessions.length : sessions.filter((s) => kindOf(s) === k).length;
        const b = el('button', `chist-chip${k === kind ? ' on' : ''}`, `${SOURCE_LABEL[k]} ${n}`);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(k === kind));
        b.addEventListener('click', () => ((kind = k), paintChips(), paintList()));
        return b;
      }),
    );
  };
  tools.append(search, folderSel, autoLabel, refresh, count);

  const body = el('div', 'chist-body');
  const list = el('div', 'chist-list pane');
  const detail = el('div', 'chist-detail pane');
  body.append(list, detail);
  const foot = el('div', 'hint chist-foot', 'Read-only, from files on this computer: Claude Code (terminal · VS Code · rauha accounts), Kiro CLI, Codex CLI. Chats on claude.ai, the Claude app or chatgpt.com live on their servers and are not shown here.');
  root.append(chips, tools, body, foot);

  const shown = (): ClaudeSessionView[] => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => (kind === 'all' || kindOf(s) === kind) && (showAuto || !s.automated) && (folder === '' || s.cwd === folder) && (q === '' || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)));
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
      const meta = el('span', 'dim chist-meta', `${folderName(s.cwd)} · ${ago(s.updatedAt, now)}`);
      const top = el('span', 'chist-rtop');
      top.append(el('span', `chist-src ${kindOf(s)}`, kindOf(s) === 'claude' ? (s.source === '~/.claude' ? 'Claude Code' : s.source.replace('rauha account', 'rauha')) : s.source), meta);
      row.append(el('span', 'chist-title', s.title), top);
      const pick = (): void => void openSession(s);
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) pick();
      });
      list.append(row);
    }
  }

  /** 질문 카드: 위에 "You asked"(내 말), 아래에 "<AI> did"(한 일 요약 → 답, 길면 접힘) */
  function turnCard(t: Turn, n: number, who: string): HTMLElement {
    const card = el('section', 'chist-turn');
    const ask = el('div', 'chist-ask');
    ask.append(el('div', 'chist-label', t.ask === '' ? 'Start' : `You asked · #${n}`));
    if (t.ask !== '') ask.append(el('div', 'chist-text', t.ask));
    card.append(ask);
    if (onlyMine) return card;
    const did = el('div', 'chist-did');
    did.append(el('div', 'chist-label', `${who} did`));
    const acts = actionSummary(t.tools);
    if (acts.length > 0) {
      const ul = el('div', 'chist-acts');
      for (const a of acts) {
        const line = el('div', 'chist-act');
        line.append(el('b', undefined, `${a.label} ${a.count}`), el('span', 'dim mono', a.sample.join(' · ') + (a.count > a.sample.length ? ' …' : '')));
        ul.append(line);
      }
      did.append(ul);
    }
    if (t.answer !== '') {
      const long = t.answer.length > 600;
      const text = el('div', `chist-text chist-answer${long ? ' folded' : ''}`, t.answer);
      did.append(text);
      if (long) {
        const more = el('button', 'link', 'Show the full answer');
        more.type = 'button';
        more.addEventListener('click', () => {
          const folded = text.classList.toggle('folded');
          more.textContent = folded ? 'Show the full answer' : 'Show less';
        });
        did.append(more);
      }
    } else if (acts.length === 0) did.append(el('div', 'dim', 'No answer recorded.'));
    card.append(did);
    return card;
  }

  /** 대화 하나를 기록 하나로 바꿔 블로그 패널에 넘긴다(비밀 가리기·요약은 RecordEntry 가 한다) */
  function asRecord(s: ClaudeSessionView, entries: readonly TranscriptEntry[]): RecordEntry | null {
    const turns = groupTurns(entries);
    const asks = turns.map((t) => t.ask).filter((x) => x !== '');
    try {
      return RecordEntry.capture({
        id: `conv-${s.id}`,
        request: asks[0] ?? s.title,
        result: turns.map((t) => [t.ask === '' ? '' : `Q: ${t.ask}`, t.answer].filter((x) => x !== '').join('\n')).join('\n\n'),
        status: 'done',
        stopReason: null,
        roles: [s.source],
        stages: [],
        queuedAt: s.startedAt || s.updatedAt,
        endedAt: s.updatedAt,
        repo: folderName(s.cwd) || null,
        files: touchedFiles(turns.flatMap((t) => t.tools)),
        approvals: [],
        direction: null,
      });
    } catch {
      return null;
    }
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
    const turns = groupTurns(r.data.entries);
    const who = kindOf(s) === 'kiro' ? 'Kiro' : kindOf(s) === 'codex' ? 'ChatGPT' : 'Claude';
    const sub = el('div', 'hint chist-sub', `${s.cwd} · started ${s.startedAt.slice(0, 16).replace('T', ' ')} · ${turns.filter((t) => t.ask !== '').length} questions${r.data.truncated ? ' (first part only)' : ''}`);
    const mine = el('label', 'hint chist-auto');
    const mineBox = el('input');
    mineBox.type = 'checkbox';
    mineBox.checked = onlyMine;
    mine.append(mineBox, el('span', undefined, 'Only my questions'));
    const msgs = el('div', 'chist-msgs');
    const paintTurns = (): void => void msgs.replaceChildren(...turns.map((t, i) => turnCard(t, i + 1, who)));
    mineBox.addEventListener('change', () => ((onlyMine = mineBox.checked), paintTurns()));
    paintTurns();
    if (deps.blog !== undefined) {
      const blogDeps = { ...deps.blog, copy: deps.copy };
      head.append(button('✍ Blog post', 'btn sm', () => {
        const rec = asRecord(s, r.data.entries);
        if (rec === null) return;
        detail.replaceChildren(buildBlogPanel(blogDeps, [rec], () => void openSession(s)));
        detail.scrollTop = 0;
      }));
    }
    if (kindOf(s) !== 'claude') head.querySelector('button')?.remove();
    sub.append(' · ', mine);
    detail.replaceChildren(head, sub, msgs);
    detail.scrollTop = 0;
  }

  async function load(): Promise<void> {
    list.replaceChildren(el('div', 'hint pad', 'Reading conversations…'));
    const r = await deps.api.list();
    if (!r.ok) return void list.replaceChildren(el('div', 'err pad', r.error));
    sessions = r.data.sessions;
    paintChips();
    paintFolders();
    paintList();
    if (selected === null) detail.replaceChildren(el('div', 'hint pad', `Pick a conversation on the left. Reading from ${r.data.roots.join(' and ')}.`));
  }
  void load();
  return { root };
}
