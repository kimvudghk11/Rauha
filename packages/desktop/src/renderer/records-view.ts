import { RecordBook, RECORD_TAGS, type RecordEntry, type RecordFilter, type RecordTag } from '../shared/record-book.js';
import { RecordBookDto, RecordDto, type RecordBookJson, type RecordResult } from '../shared/record-dto.js';
import { activeFilterKeys, copiedText, DECISION_CHIP, deleteDialog, moveRowSelection, pickBarState, primaryRecordAction, rangeBetween, shortDuration, type RecordView } from '../shared/record-ui.js';
import { buildBlogPanel, type BlogPanelDeps } from './blog-view.js';
import { el } from './dom.js';
import { askDialog } from './git-common.js';
import { actionButton, flash, iconButton, openChoiceMenu } from './record-parts.js';

export interface RecordsViewDeps {
  readonly api: {
    get(): Promise<RecordBookJson>;
    apply(op: unknown): Promise<RecordResult>;
    onChange(listener: (book: RecordBookJson) => void): void;
  };
  /** 지금 시각(밀리초). 기간 필터에 쓴다 */
  now(): number;
  /** 글을 클립보드에 복사한다. 못 하면 false */
  copy(text: string): Promise<boolean>;
  /** 블로그 글(정리 노트·초안·저장). 없으면 블로그 단추를 숨긴다 */
  readonly blog?: Pick<BlogPanelDeps, 'api' | 'names'>;
}

const NO_FILTER: RecordFilter = { text: '', tag: null, status: 'all', repo: null, divergedOnly: false, since: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS: readonly (readonly [string, string, number | null])[] = [
  ['all', 'Any time', null],
  ['7', 'Last 7 days', 7],
  ['30', 'Last 30 days', 30],
  ['90', 'Last 90 days', 90],
];
const tagLabel = (id: RecordTag): string => RECORD_TAGS.find((t) => t.id === id)?.label ?? id;

/** 클립보드에 복사한다. 막혀 있으면 false */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

let latest: ((book: RecordBookJson) => void) | null = null;
let listening = false;

/** 이 PC의 시간대로 보여 주는 날짜·시각. 읽을 수 없으면 "모름". */
export function whenText(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Unknown';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


/**
 * 기록 탭: 끝난 작업의 요약을 시간순으로 보여 주고, 검색·태그·상태·레포·기간으로 거른다.
 * 비밀·코드·전체 로그·달러 금액은 기록에 들어오기 전에(RecordEntry) 이미 걸러진다. 화면은 그리기만 한다.
 * 버튼 규칙: 한 화면에 강조는 하나(shared/record-ui.ts primaryRecordAction), 지우기는 위험 색 + 확인, 모두 아이콘 + 글자.
 */
export function buildRecords(deps: RecordsViewDeps) {
  const root = el('section', 'records');
  let book = RecordBook.empty();
  let filter: RecordFilter = NO_FILTER;
  let period = 'all';
  let selected: string | null = null;
  /** Shift+클릭 범위 선택의 기준 줄 */
  let lastPicked: string | null = null;
  /** 블로그 글로 묶거나 복사·삭제하려고 체크한 기록 */
  const picked = new Set<string>();
  /** 블로그 글 패널로 정리 중인 기록 번호들. null이면 일반 상세 */
  let blogIds: string[] | null = null;
  /** 열어 둔 블로그 패널. 새 기록이 들어와 목록이 다시 그려져도 쓰던 글·체크를 잃지 않게 그대로 둔다 */
  let blogPanel: { readonly key: string; readonly node: HTMLElement } | null = null;
  let loaded = false;
  /** 다시 그린 뒤 키보드 초점을 돌려줄 줄 */
  let pendingFocus: string | null = null;

  const head = el('div', 'rhead');
  head.append(el('b', undefined, 'Records'), el('span', 'hint', 'Finished jobs pile up here as summaries. Use them for "what problem, how solved" in a portfolio or resume.'));

  const tools = el('div', 'rtools');
  const search = el('input');
  search.placeholder = 'Search request, result, files, team, tags';
  search.setAttribute('aria-label', 'Search records');
  const searchBox = el('div', 'rsearch');
  const searchClear = iconButton('close', 'Clear search', () => {
    search.value = '';
    filter = { ...filter, text: '' };
    searchClear.hidden = true;
    renderList();
    search.focus();
  });
  searchClear.hidden = true;
  searchBox.append(search, searchClear);
  search.addEventListener('input', () => {
    filter = { ...filter, text: search.value };
    searchClear.hidden = search.value === '';
    renderList();
  });
  const toolHost = el('div', 'tselects');
  tools.append(searchBox, toolHost);
  const tagBar = el('div', 'rtags bar');

  const body = el('div', 'rec');
  const list = el('div', 'rclist pane');
  const detail = el('div', 'rcdet pane');
  body.append(list, detail);

  const foot = el('div', 'rcfoot', 'Records stay on this computer. Only summaries are kept: no code, secrets or full logs. Sending to your AWS (S3) opens later.');
  root.append(head, tools, tagBar, body, foot);

  function select<T extends string>(options: readonly (readonly [T, string])[], value: T, label: string, onChange: (v: T) => void): HTMLSelectElement {
    const s = el('select');
    s.setAttribute('aria-label', label);
    for (const [v, text] of options) s.append(Object.assign(el('option', undefined, text), { value: v }));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value as T));
    return s;
  }

  const filterKeys = (): string[] => activeFilterKeys({ text: filter.text, tag: filter.tag, status: filter.status, repo: filter.repo, divergedOnly: filter.divergedOnly, period });

  function clearFilters(): void {
    filter = NO_FILTER;
    period = 'all';
    search.value = '';
    searchClear.hidden = true;
    renderList();
  }

  function renderTools(): void {
    const status = select([['all', 'All statuses'], ['done', 'Done'], ['stopped', 'Stopped']] as const, filter.status, 'Filter by status', (v) => {
      filter = { ...filter, status: v };
      renderList();
    });
    const repo = select([['', 'All repos'] as const, ...book.repos().map((r) => [r, r] as const)], filter.repo ?? '', 'Filter by repo', (v) => {
      filter = { ...filter, repo: v === '' ? null : v };
      renderList();
    });
    const when = select(PERIODS.map(([id, label]) => [id, label] as const), period, 'Filter by period', (v) => {
      period = v;
      const days = PERIODS.find(([id]) => id === v)?.[2] ?? null;
      filter = { ...filter, since: days === null ? null : new Date(deps.now() - days * DAY_MS).toISOString() };
      renderList();
    });
    const diverged = el('label', 'tg');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = filter.divergedOnly;
    box.addEventListener('change', () => {
      filter = { ...filter, divergedOnly: box.checked };
      renderList();
    });
    diverged.append(box, el('span', undefined, 'I chose differently'));
    const copyAll = actionButton({
      label: 'Copy visible',
      icon: 'copy',
      title: 'Copy the records shown in the list as Markdown',
      onClick: () => {
        const shown = book.view(filter);
        void deps.copy(shown.map((e) => RecordDto.toMarkdown(e, whenText)).join('\n\n---\n\n')).then((ok) => done(ok, shown.length));
      },
    });
    copyAll.disabled = book.view(filter).length === 0;
    copyAll.classList.add('end');
    toolHost.replaceChildren(status, repo, when, diverged, copyAll);

    const counts = book.tagCounts();
    tagBar.replaceChildren();
    const chip = (label: string, on: boolean, onClick: () => void) => {
      const b = el('button', `chip${on ? ' on' : ''}`, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', onClick);
      tagBar.append(b);
    };
    chip(`All ${book.entries.length}`, filter.tag === null, () => {
      filter = { ...filter, tag: null };
      renderList();
    });
    for (const t of RECORD_TAGS) {
      if (counts[t.id] === 0 && filter.tag !== t.id) continue;
      chip(`${t.label} ${counts[t.id]}`, filter.tag === t.id, () => {
        filter = { ...filter, tag: filter.tag === t.id ? null : t.id };
        renderList();
      });
    }
    const n = filterKeys().length;
    if (n > 0) {
      const clear = actionButton({ label: 'Clear filters', icon: 'close', kind: 'ghost', small: true, title: `Clear all ${n} active filter(s)`, onClick: clearFilters });
      clear.classList.add('end');
      tagBar.append(clear);
    }
  }

  const notice = el('div', 'notice');
  notice.hidden = true;
  notice.setAttribute('role', 'alert');
  root.insertBefore(notice, body);
  /** 오류·안내 줄(다음 동작 때 사라진다) */
  function say(text: string): void {
    notice.textContent = text;
    notice.hidden = text === '';
  }
  /** 복사 결과: 됐으면 잠깐 뜨는 알림, 안 됐으면 줄로 */
  function done(ok: boolean, count: number): void {
    if (ok) {
      say('');
      flash(copiedText(count, true), root);
    } else say(copiedText(count, false));
  }

  function currentView(shown: readonly RecordEntry[]): RecordView {
    if (blogIds !== null) return 'blog';
    return selected !== null && shown.some((e) => e.id === selected) ? 'detail' : 'none';
  }

  function renderList(): void {
    const active = document.activeElement;
    const holder = active instanceof HTMLElement && list.contains(active) ? active.closest<HTMLElement>('[data-id]') : null;
    const refocus = pendingFocus ?? holder?.dataset['id'] ?? null;
    const refocusInput = pendingFocus === null && active instanceof HTMLInputElement;
    pendingFocus = null;

    renderTools();
    const shown = book.view(filter);
    const view = currentView(shown);
    body.classList.toggle('show-detail', view !== 'none');
    for (const id of [...picked]) if (!book.has(id)) picked.delete(id);
    list.replaceChildren(el('div', 'ph', `Records ${shown.length}${shown.length !== book.entries.length ? ` / ${book.entries.length}` : ''}`));
    if (book.entries.length > 0) list.append(pickBar(shown, view));
    if (!loaded) {
      const wait = el('div', 'empty-state rnone');
      wait.append(el('span', 'spinner'), document.createTextNode('Loading…'));
      list.append(wait);
    } else if (book.entries.length === 0) {
      const none = el('div', 'empty-state rnone');
      none.append(el('b', undefined, 'No records yet'), el('span', 'hint', 'When a team finishes a job, its summary appears here.'));
      list.append(none);
    } else if (shown.length === 0) {
      const none = el('div', 'empty-state rnone');
      none.append(el('b', undefined, 'No records match'));
      if (filterKeys().length > 0) none.append(actionButton({ label: 'Clear filters', icon: 'close', small: true, onClick: clearFilters }));
      list.append(none);
    }
    const items = el('div', 'ritems');
    items.setAttribute('role', 'list');
    const firstId = shown[0]?.id ?? null;
    const tabId = refocus !== null && shown.some((e) => e.id === refocus) ? refocus : selected !== null && shown.some((e) => e.id === selected) ? selected : firstId;
    for (const e of shown) items.append(pickRow(e, e.id === tabId));
    items.addEventListener('keydown', (ev) => onItemsKey(ev, shown, items));
    items.addEventListener('focusin', (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>('.ri');
      if (row === null) return;
      for (const r of Array.from(items.querySelectorAll<HTMLElement>('.ri'))) r.tabIndex = r === row ? 0 : -1;
    });
    list.append(items);
    renderDetail(view);
    if (refocus !== null) {
      const holderNode = Array.from(items.children).find((n) => (n as HTMLElement).dataset['id'] === refocus);
      holderNode?.querySelector<HTMLElement>(refocusInput ? 'input' : '.ri')?.focus();
    }
  }

  /** ↑↓·Home·End로 줄 옮기기, x로 체크 */
  function onItemsKey(ev: KeyboardEvent, shown: readonly RecordEntry[], items: HTMLElement): void {
    const target = ev.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-id]');
    const id = row?.dataset['id'] ?? null;
    if (ev.key === 'x' && id !== null && target.classList.contains('ri')) {
      ev.preventDefault();
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      pendingFocus = id;
      renderList();
      return;
    }
    const next = moveRowSelection(shown.map((e) => e.id), id, ev.key);
    if (next === null) return;
    ev.preventDefault();
    const node = Array.from(items.children).find((n) => (n as HTMLElement).dataset['id'] === next)?.querySelector<HTMLElement>('.ri');
    node?.focus();
    node?.scrollIntoView({ block: 'nearest' });
  }

  /** 선택 목록 위 작업줄: 앞에 "3개 선택", 전체 선택·선택 해제, 고른 기록으로 블로그 글·복사·삭제 */
  function pickBar(shown: readonly RecordEntry[], view: RecordView): HTMLElement {
    const s = pickBarState([...picked], shown.map((e) => e.id));
    const wrap = el('div', 'rpick');
    const top = el('div', 'bar');
    top.append(el('span', `grow rpick-sum${s.canClear ? ' on' : ''}`, s.summary));
    const all = actionButton({
      label: 'Select all',
      title: 'Check every record shown',
      onClick: () => {
        for (const e of shown) picked.add(e.id);
        renderList();
      },
    });
    all.disabled = !s.canSelectAll;
    const none = actionButton({
      label: 'Clear selection',
      icon: 'close',
      kind: 'ghost',
      onClick: () => {
        picked.clear();
        lastPicked = null;
        renderList();
      },
    });
    none.disabled = !s.canClear;
    top.append(all, none);
    wrap.append(top);

    const acts = el('div', 'bar');
    {
      if (deps.blog !== undefined) {
        const make = actionButton({
          label: 'Blog post',
          icon: 'doc',
          kind: primaryRecordAction(picked.size, view) === 'pick-blog' ? 'primary' : undefined,
          title: 'Make a blog post outline from the checked records',
          onClick: () => openBlog([...picked]),
        });
        make.disabled = !s.canBlog;
        acts.append(make);
      }
      const copy = actionButton({
        label: 'Copy',
        icon: 'copy',
        title: 'Copy the checked records as Markdown',
        onClick: () => {
          const chosen = book.entries.filter((e) => picked.has(e.id));
          void deps.copy(chosen.map((e) => RecordDto.toMarkdown(e, whenText)).join('\n\n---\n\n')).then((ok) => done(ok, chosen.length));
        },
      });
      copy.disabled = !s.canCopy;
      const del = actionButton({
        label: 'Delete',
        icon: 'trash',
        kind: 'danger',
        title: 'Delete the checked records (asks first)',
        onClick: () => void askRemove([...picked]),
      });
      del.disabled = !s.canDelete;
      del.classList.add('end');
      acts.append(copy, del);
    }
    wrap.append(acts);
    return wrap;
  }

  /** 지우기 확인 창(앱 공통 confirm). 무엇을 몇 개 지우는지, 되돌릴 수 없다는 것을 말하고 취소가 먼저 선택돼 있다 */
  async function askRemove(ids: readonly string[]): Promise<void> {
    const d = deleteDialog(ids.map((id) => book.get(id)?.request ?? 'Unknown'));
    const res = await askDialog({ title: d.title, body: d.body, okLabel: d.okLabel, danger: true });
    if (res.ok) await removeMany(ids);
  }

  async function removeMany(ids: readonly string[]): Promise<void> {
    let last: RecordBookJson | null = null;
    let removed = 0;
    for (const id of ids) {
      let res: RecordResult;
      try {
        res = await deps.api.apply({ kind: 'remove', id });
      } catch {
        res = { ok: false, error: 'Could not delete the records.' };
      }
      if (!res.ok) {
        say(res.error);
        break;
      }
      last = res.book;
      removed += 1;
      picked.delete(id);
      if (selected === id) selected = null;
    }
    if (last !== null) {
      book = RecordBookDto.from(last).toEntity();
      flash(`Deleted ${removed} record(s)`, root);
    }
    renderList();
  }

  function openBlog(ids: string[]): void {
    blogIds = ids.filter((id) => book.has(id));
    blogPanel = null;
    renderList();
    detail.scrollTop = 0;
  }

  /** 목록 한 줄: 블로그 글·복사·삭제에 쓸 체크 칸 + 기록 */
  function pickRow(e: RecordEntry, tab: boolean): HTMLElement {
    const row = el('div', `rpickrow${picked.has(e.id) ? ' picked' : ''}`);
    row.dataset['id'] = e.id;
    row.setAttribute('role', 'listitem');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = picked.has(e.id);
    box.title = 'Check to group (copy, blog post, delete). Shift+click selects a range';
    box.setAttribute('aria-label', `Check ${e.request}`);
    box.tabIndex = -1;
    box.addEventListener('click', (ev) => {
      const ids = ev.shiftKey ? rangeBetween(book.view(filter).map((x) => x.id), lastPicked, e.id) : [e.id];
      for (const id of ids) {
        if (box.checked) picked.add(id);
        else picked.delete(id);
      }
      lastPicked = e.id;
      renderList();
    });
    row.append(box, item(e, tab));
    return row;
  }

  /** 한 줄: 요청(말줄임) / 상태·태그 칩 / 시각 · 걸린 시간 · 레포 */
  function item(e: RecordEntry, tab: boolean): HTMLElement {
    const b = el('button', `ri${e.id === selected ? ' on' : ''}`);
    b.type = 'button';
    b.tabIndex = tab ? 0 : -1;
    b.title = 'Click or press Enter to open (x: check)';
    b.append(el('div', 'rt', e.request));
    const chips = el('div', 'tchips');
    chips.append(el('span', e.status === 'done' ? 'chip green' : 'chip red', e.status === 'done' ? 'Done' : 'Stopped'));
    for (const t of e.tags.slice(0, 2)) chips.append(el('span', 'chip purple', tagLabel(t)));
    if (e.tags.length > 2) chips.append(el('span', 'chip', `+${e.tags.length - 2}`));
    if (e.divergedFromAi()) chips.append(el('span', 'chip yellow', 'Chose differently'));
    b.append(chips);
    b.append(el('div', 'rm', `${whenText(e.endedAt)} · ${shortDuration(e.durationSeconds())}${e.repo === null ? '' : ` · ${e.repo}`}`));
    b.addEventListener('click', () => {
      selected = e.id;
      blogIds = null;
      blogPanel = null;
      renderList();
      detail.scrollTop = 0;
    });
    return b;
  }

  function section(title: string, ...nodes: (HTMLElement | string)[]): HTMLElement {
    const s = el('div', 'rsec');
    s.append(el('div', 'rsect', title));
    for (const n of nodes) s.append(typeof n === 'string' ? el('div', 'rtext', n) : n);
    return s;
  }

  async function send(op: unknown, okText?: string): Promise<void> {
    let res: RecordResult;
    try {
      res = await deps.api.apply(op);
    } catch {
      res = { ok: false, error: 'Could not save the record.' };
    }
    if (res.ok) {
      book = RecordBookDto.from(res.book).toEntity();
      say('');
      if (okText !== undefined) flash(okText, root);
    } else say(res.error);
    renderList();
  }

  /** 되돌아가기(Esc도 같다): 상세·블로그 패널을 닫고 방금 보던 줄에 초점을 돌려준다 */
  function goBack(): void {
    pendingFocus = blogIds !== null ? (blogIds[0] ?? selected) : selected;
    blogIds = null;
    blogPanel = null;
    selected = null;
    renderList();
  }

  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    const t = ev.target as HTMLElement;
    if (t === search) {
      if (search.value !== '') {
        ev.preventDefault();
        search.value = '';
        filter = { ...filter, text: '' };
        searchClear.hidden = true;
        renderList();
      }
      return;
    }
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (t instanceof HTMLInputElement && t.type !== 'checkbox') return;
    if (blogIds !== null || selected !== null) {
      ev.preventDefault();
      goBack();
    }
  });

  function renderDetail(view: RecordView): void {
    detail.replaceChildren();
    if (blogIds !== null && deps.blog !== undefined) {
      const chosen = blogIds.map((id) => book.get(id)).filter((e): e is RecordEntry => e !== null);
      const key = blogIds.join(',');
      if (blogPanel === null || blogPanel.key !== key) {
        blogPanel = {
          key,
          node: buildBlogPanel({ ...deps.blog, copy: deps.copy }, chosen, goBack),
        };
      }
      detail.append(blogPanel.node);
      return;
    }
    const e = selected === null ? null : book.get(selected);
    if (e === null || view !== 'detail') {
      const empty = el('div', 'empty-state rnone');
      if (book.entries.length > 0) empty.append(el('b', undefined, 'Pick a record'), el('span', 'hint', 'Click a record on the left to see details. Move with ↑↓ and open with Enter.'));
      detail.append(empty);
      return;
    }

    // 위쪽 한 줄(스크롤해도 고정): 되돌아가기 · 블로그 글 · 복사(강조) · 지우기(위험, 맨 오른쪽)
    const bar = el('div', 'bar rdbar');
    bar.append(actionButton({ label: 'List', icon: 'back', title: 'Back to the list (Esc)', onClick: goBack }));
    if (deps.blog !== undefined) {
      const blog = actionButton({ label: 'Blog post', icon: 'doc', title: 'Make a blog post outline from this record', onClick: () => openBlog([e.id]) });
      blog.classList.add('end');
      bar.append(blog);
    }
    const copy = actionButton({
      label: 'Copy',
      icon: 'copy',
      kind: primaryRecordAction(picked.size, view) === 'detail-copy' ? 'primary' : undefined,
      title: 'Copy this record as Markdown',
      onClick: () => void deps.copy(RecordDto.toMarkdown(e, whenText)).then((ok) => done(ok, 1)),
    });
    if (deps.blog === undefined) copy.classList.add('end');
    const del = actionButton({
      label: 'Delete',
      icon: 'trash',
      kind: 'danger',
      title: 'Delete this record (asks first)',
      onClick: () => void askRemove([e.id]),
    });
    bar.append(copy, del);
    detail.append(bar);

    const title = el('div', 'rtitle');
    const heading = el('b', undefined, e.request);
    heading.title = e.request;
    title.append(heading);
    const meta = el('div', 'tchips');
    meta.append(el('span', e.status === 'done' ? 'chip green' : 'chip red', e.status === 'done' ? 'Done' : `Stopped${e.stopReason === null ? '' : ` · ${e.stopReason}`}`));
    meta.append(el('span', 'chip', whenText(e.endedAt)), el('span', 'chip', `Took ${shortDuration(e.durationSeconds())}`));
    if (e.repo !== null) meta.append(el('span', 'chip blue', e.repo));
    if (e.divergedFromAi()) meta.append(el('span', 'chip yellow', 'I chose differently'));
    detail.append(title, meta);

    // 태그: 칩을 누르면 메뉴가 열려 바꿀 수 있다(작은 ▾). 자동으로 어림한 값을 내가 고칠 수 있다
    const tagRow = el('div', 'rtags');
    const openTags = (anchor: HTMLElement) =>
      openChoiceMenu(
        anchor,
        'Tags (click to toggle)',
        RECORD_TAGS.map((t) => {
          const on = e.tags.includes(t.id);
          return { label: t.label, on, pick: () => void send({ kind: 'tags', id: e.id, tags: on ? e.tags.filter((x) => x !== t.id) : [...e.tags, t.id] }) };
        }),
      );
    const tagChip = (text: string): HTMLButtonElement => {
      const b = el('button', 'chip purple');
      b.type = 'button';
      b.title = 'Click to change tags';
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.append(document.createTextNode(text), el('span', 'rcaret', '▾'));
      b.addEventListener('click', () => openTags(b));
      return b;
    };
    if (e.tags.length === 0) tagRow.append(tagChip('No tags'));
    for (const t of e.tags) tagRow.append(tagChip(tagLabel(t)));
    detail.append(section('Tags (click to change)', tagRow));

    detail.append(section('Problem (request)', e.request));
    detail.append(section('Approach · stages', e.stages.length === 0 ? 'Unknown' : e.stages.join(' → '), ...(e.roles.length === 0 ? [] : [el('div', 'rtext dim', `Team members: ${e.roles.join(', ')}`)])));
    detail.append(section('Result summary', el('div', 'rtext pre', e.summary)));

    if (e.direction !== null) {
      const d = e.direction;
      const table = el('div', 'rdir');
      const row = (label: string, value: string, mark: boolean) => {
        const r = el('div', `rrow${mark ? ' hl' : ''}`);
        r.append(el('span', 'rl', label), el('span', undefined, value === '' ? 'Unknown' : value));
        table.append(r);
      };
      row('AI recommended', d.recommended, false);
      row('My choice', d.chosen, e.divergedFromAi());
      if (d.reason !== null) row('Reason', d.reason, false);
      detail.append(section('Directions considered', table));
    }

    if (e.approvals.length > 0) {
      const ul = el('div', 'rapp');
      for (const a of e.approvals) {
        const line = el('div', `rrow${a.decision === 'revise' ? ' hl' : ''}`);
        line.append(el('b', undefined, a.headline), el('span', 'chip', DECISION_CHIP[a.decision]));
        if (a.reason !== '') line.append(el('span', 'dim', `Reason: ${a.reason}`));
        if (a.note !== null) line.append(el('span', 'dim', `My note: ${a.note}`));
        ul.append(line);
      }
      detail.append(section('Approvals and reasons', ul));
    }

    const filesBox = el('div', 'rfiles');
    for (const f of e.files) filesBox.append(el('div', 'rfile', f));
    if (e.moreFiles > 0) filesBox.append(el('div', 'rfile dim', `+${e.moreFiles} more`));
    if (e.hiddenFiles > 0) filesBox.append(el('div', 'rfile dim', `${e.hiddenFiles} secret file(s) were not even named`));
    detail.append(section('Changed files', e.files.length === 0 && e.hiddenFiles === 0 ? 'No changed files recorded' : filesBox));

    const memo = el('textarea');
    memo.rows = 3;
    memo.maxLength = 500;
    memo.value = e.memo;
    memo.setAttribute('aria-label', 'My memo');
    memo.placeholder = 'What to say in interviews or a portfolio, what you learned (do not write secrets; they get hidden anyway)';
    const saveMemo = actionButton({ label: 'Save memo', icon: 'save', onClick: () => void send({ kind: 'memo', id: e.id, memo: memo.value }, 'Memo saved') });
    saveMemo.disabled = true;
    memo.addEventListener('input', () => {
      saveMemo.disabled = memo.value === e.memo;
    });
    detail.append(section('My memo', memo, saveMemo));
  }

  function replace(json: RecordBookJson): void {
    book = RecordBookDto.from(json).toEntity();
    renderList();
  }

  latest = replace;
  if (!listening) {
    listening = true;
    deps.api.onChange((json) => latest?.(json));
  }
  renderList();
  void deps.api.get().then(
    (json) => {
      loaded = true;
      replace(json);
    },
    () => {
      loaded = true;
      say('Could not load the records.');
      renderList();
    },
  );

  return { root };
}
