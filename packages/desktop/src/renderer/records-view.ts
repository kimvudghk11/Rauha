import { RecordBook, RECORD_TAGS, type RecordEntry, type RecordFilter, type RecordTag } from '../shared/record-book.js';
import { decisionLabel, durationText, RecordBookDto, RecordDto, type RecordBookJson, type RecordResult } from '../shared/record-dto.js';
import { el } from './dom.js';

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
}

const NO_FILTER: RecordFilter = { text: '', tag: null, status: 'all', repo: null, divergedOnly: false, since: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS: readonly (readonly [string, string, number | null])[] = [
  ['all', '기간 전체', null],
  ['7', '최근 7일', 7],
  ['30', '최근 30일', 30],
  ['90', '최근 90일', 90],
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
  if (Number.isNaN(t)) return '모름';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 기록 탭: 끝난 작업의 요약을 시간순으로 보여 주고, 검색·태그·상태·레포·기간으로 거른다.
 * 비밀·코드·전체 로그·달러 금액은 기록에 들어오기 전에(RecordEntry) 이미 걸러진다. 화면은 그리기만 한다.
 */
export function buildRecords(deps: RecordsViewDeps) {
  const root = el('section', 'records');
  let book = RecordBook.empty();
  let filter: RecordFilter = NO_FILTER;
  let period = 'all';
  let selected: string | null = null;
  let confirming: string | null = null;
  let loaded = false;

  const head = el('div', 'rhead');
  head.append(el('b', undefined, '기록'), el('span', 'hint', '끝난 작업이 요약으로 쌓여요. 포트폴리오·이력서에 "어떤 문제를 어떻게 풀었나"를 옮겨 쓸 때 써요.'));

  const tools = el('div', 'rtools');
  const search = el('input');
  search.placeholder = '요청·결과·파일·팀·태그 검색';
  search.addEventListener('input', () => {
    filter = { ...filter, text: search.value };
    renderList();
  });
  const toolHost = el('div', 'tselects');
  tools.append(search, toolHost);
  const tagBar = el('div', 'rtags');

  const body = el('div', 'rec');
  const list = el('div', 'rclist pane');
  const detail = el('div', 'rcdet pane');
  body.append(list, detail);

  const foot = el('div', 'rcfoot', '기록은 이 컴퓨터에만 저장돼요. 코드·비밀 값·전체 로그는 담지 않고 요약만 남겨요. 내 AWS(S3)로 보내는 기능은 나중에 열려요.');
  root.append(head, tools, tagBar, body, foot);

  function select<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): HTMLSelectElement {
    const s = el('select');
    for (const [v, label] of options) s.append(Object.assign(el('option', undefined, label), { value: v }));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value as T));
    return s;
  }

  function renderTools(): void {
    const status = select([['all', '상태 전체'], ['done', '끝남'], ['stopped', '멈춤']] as const, filter.status, (v) => {
      filter = { ...filter, status: v };
      renderList();
    });
    const repo = select([['', '레포 전체'] as const, ...book.repos().map((r) => [r, r] as const)], filter.repo ?? '', (v) => {
      filter = { ...filter, repo: v === '' ? null : v };
      renderList();
    });
    const when = select(PERIODS.map(([id, label]) => [id, label] as const), period, (v) => {
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
    diverged.append(box, el('span', undefined, '내가 다르게 골랐어요'));
    const copyAll = el('button', 'btn', '보이는 기록 복사');
    copyAll.type = 'button';
    copyAll.addEventListener('click', () => {
      const shown = book.view(filter);
      void deps.copy(shown.map((e) => RecordDto.toMarkdown(e, whenText)).join('\n\n---\n\n')).then((ok) => say(ok ? `${shown.length}개 기록을 마크다운으로 복사했어요.` : '복사하지 못했어요.'));
    });
    toolHost.replaceChildren(status, repo, when, diverged, copyAll);

    const counts = book.tagCounts();
    tagBar.replaceChildren();
    const chip = (label: string, on: boolean, onClick: () => void) => {
      const b = el('button', `rtag${on ? ' on' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      tagBar.append(b);
    };
    chip(`전체 ${book.entries.length}`, filter.tag === null, () => {
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
  }

  const notice = el('div', 'tnotice');
  notice.hidden = true;
  root.insertBefore(notice, body);
  function say(text: string): void {
    notice.textContent = text;
    notice.hidden = text === '';
  }

  function renderList(): void {
    renderTools();
    const shown = book.view(filter);
    body.classList.toggle('show-detail', selected !== null && shown.some((e) => e.id === selected));
    list.replaceChildren(el('div', 'ph', `기록 ${shown.length}${shown.length !== book.entries.length ? ` / ${book.entries.length}` : ''}`));
    if (!loaded) list.append(el('div', 'rnone', '불러오는 중…'));
    else if (book.entries.length === 0) list.append(el('div', 'rnone', '기록이 아직 없어요. 팀이 작업을 끝내면 요약이 여기에 쌓여요.'));
    else if (shown.length === 0) list.append(el('div', 'rnone', '조건에 맞는 기록이 없어요.'));
    const items = el('div', 'ritems');
    for (const e of shown) items.append(item(e));
    list.append(items);
    renderDetail();
  }

  function item(e: RecordEntry): HTMLElement {
    const b = el('button', `ri${e.id === selected ? ' on' : ''}`);
    b.type = 'button';
    b.append(el('div', 'rt', e.request));
    b.append(el('div', 'rm', `${whenText(e.endedAt)}${e.repo === null ? '' : ` · ${e.repo}`}`));
    const chips = el('div', 'tchips');
    if (e.status === 'stopped') chips.append(el('span', 'chip red', '멈춤'));
    for (const t of e.tags) chips.append(el('span', 'chip purple', tagLabel(t)));
    if (e.divergedFromAi()) chips.append(el('span', 'chip yellow', '내가 다르게 골랐어요'));
    b.append(chips);
    b.addEventListener('click', () => {
      selected = e.id;
      confirming = null;
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

  async function send(op: unknown): Promise<void> {
    let res: RecordResult;
    try {
      res = await deps.api.apply(op);
    } catch {
      res = { ok: false, error: '기록을 저장하지 못했어요.' };
    }
    if (res.ok) {
      book = RecordBookDto.from(res.book).toEntity();
      say('');
    } else say(res.error);
    renderList();
  }

  function renderDetail(): void {
    detail.replaceChildren();
    const e = selected === null ? null : book.get(selected);
    if (e === null) {
      const empty = el('div', 'rnone', book.entries.length === 0 ? '' : '왼쪽에서 기록을 고르면 자세한 내용이 보여요.');
      detail.append(empty);
      return;
    }
    const back = el('button', 'btn rback', '← 목록');
    back.type = 'button';
    back.addEventListener('click', () => {
      selected = null;
      renderList();
    });
    const title = el('div', 'rtitle');
    title.append(el('b', undefined, e.request));
    const meta = el('div', 'tchips');
    meta.append(el('span', 'chip', whenText(e.endedAt)), el('span', 'chip', `걸린 시간 ${durationText(e.durationSeconds())}`));
    meta.append(el('span', e.status === 'done' ? 'chip green' : 'chip red', e.status === 'done' ? '끝남' : `멈춤${e.stopReason === null ? '' : ` · ${e.stopReason}`}`));
    if (e.repo !== null) meta.append(el('span', 'chip blue', e.repo));
    if (e.divergedFromAi()) meta.append(el('span', 'chip yellow', '내가 다르게 골랐어요'));

    detail.append(back, title, meta);

    // 태그: 눌러서 고른다(자동으로 어림한 값을 내가 고칠 수 있다)
    const tagRow = el('div', 'rtags edit');
    for (const t of RECORD_TAGS) {
      const on = e.tags.includes(t.id);
      const b = el('button', `rtag${on ? ' on' : ''}`, t.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        const next = on ? e.tags.filter((x) => x !== t.id) : [...e.tags, t.id];
        void send({ kind: 'tags', id: e.id, tags: next });
      });
      tagRow.append(b);
    }
    detail.append(section('태그 (눌러서 바꿔요)', tagRow));

    detail.append(section('문제(요청)', e.request));
    detail.append(section('접근 · 거친 단계', e.stages.length === 0 ? '모름' : e.stages.join(' → '), ...(e.roles.length === 0 ? [] : [el('div', 'rtext dim', `일한 팀원: ${e.roles.join(', ')}`)])));
    detail.append(section('결과 요약', el('div', 'rtext pre', e.summary)));

    if (e.direction !== null) {
      const d = e.direction;
      const table = el('div', 'rdir');
      const row = (label: string, value: string, mark: boolean) => {
        const r = el('div', `rrow${mark ? ' hl' : ''}`);
        r.append(el('span', 'rl', label), el('span', undefined, value === '' ? '모름' : value));
        table.append(r);
      };
      row('AI 추천', d.recommended, false);
      row('내 선택', d.chosen, e.divergedFromAi());
      if (d.reason !== null) row('이유', d.reason, false);
      detail.append(section('고려한 방향', table));
    }

    if (e.approvals.length > 0) {
      const ul = el('div', 'rapp');
      for (const a of e.approvals) {
        const line = el('div', `rrow${a.decision === 'revise' ? ' hl' : ''}`);
        line.append(el('b', undefined, a.headline), el('span', 'chip', decisionLabel(a.decision)));
        if (a.reason !== '') line.append(el('span', 'dim', `이유: ${a.reason}`));
        if (a.note !== null) line.append(el('span', 'dim', `내 말: ${a.note}`));
        ul.append(line);
      }
      detail.append(section('허락 결정과 이유', ul));
    }

    const filesBox = el('div', 'rfiles');
    for (const f of e.files) filesBox.append(el('div', 'rfile', f));
    if (e.moreFiles > 0) filesBox.append(el('div', 'rfile dim', `외 ${e.moreFiles}개`));
    if (e.hiddenFiles > 0) filesBox.append(el('div', 'rfile dim', `비밀 파일 ${e.hiddenFiles}개는 이름도 남기지 않았어요`));
    detail.append(section('바뀐 파일', e.files.length === 0 && e.hiddenFiles === 0 ? '기록된 바뀐 파일이 없어요' : filesBox));

    const memo = el('textarea');
    memo.rows = 3;
    memo.maxLength = 500;
    memo.value = e.memo;
    memo.placeholder = '면접·포트폴리오에서 말할 것, 배운 점 (비밀 값은 적지 마세요. 적어도 가려져요)';
    const saveMemo = el('button', 'btn', '메모 저장');
    saveMemo.type = 'button';
    saveMemo.addEventListener('click', () => void send({ kind: 'memo', id: e.id, memo: memo.value }));
    detail.append(section('내 메모', memo, saveMemo));

    const actions = el('div', 'tbtns');
    const copy = el('button', 'btn primary', '마크다운으로 복사');
    copy.type = 'button';
    copy.addEventListener('click', () => void deps.copy(RecordDto.toMarkdown(e, whenText)).then((ok) => say(ok ? '마크다운으로 복사했어요.' : '복사하지 못했어요.')));
    actions.append(copy);
    if (confirming === e.id) {
      const yes = el('button', 'btn danger', '정말 지울까요?');
      yes.type = 'button';
      yes.addEventListener('click', () => {
        confirming = null;
        selected = null;
        void send({ kind: 'remove', id: e.id });
      });
      const no = el('button', 'btn', '아니요');
      no.type = 'button';
      no.addEventListener('click', () => {
        confirming = null;
        renderDetail();
      });
      actions.append(yes, no);
    } else {
      const del = el('button', 'btn danger', '기록 지우기');
      del.type = 'button';
      del.addEventListener('click', () => {
        confirming = e.id;
        renderDetail();
      });
      actions.append(del);
    }
    detail.append(actions);
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
      say('기록을 읽지 못했어요.');
      renderList();
    },
  );

  return { root };
}
