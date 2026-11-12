import { DOCKER_EXEC_NOTE, DOCKER_INSTALL_URL, DOCKER_LIMIT_NOTE, type ComposeFileView, type DockerApi, type DockerFailure, type DockerLogEvent, type DockerResult, type DockerStatus } from '../shared/docker-api.js';
import { STATE_LABEL, agoLabel, containerMatches, stateTone, type ComposeProjectView, type ContainerView, type ImageView, type NetworkView, type StateFilter, type VolumeView } from '../shared/docker-parse.js';
import { el, isEnterKey } from './dom.js';
import { askDialog } from './git-common.js';
import { button, chipOf, select } from './todo-parts.js';

export interface DockerViewDeps {
  readonly api: DockerApi;
  readonly copy: (text: string) => Promise<boolean>;
  readonly now?: () => number;
  /** 자동 새로고침 간격(밀리초). 기본 5000 */
  readonly refreshMs?: number;
}

type DockerTab = 'containers' | 'images' | 'volumes' | 'networks' | 'compose';
const TABS: readonly (readonly [DockerTab, string])[] = [
  ['containers', 'Containers'],
  ['images', 'Images'],
  ['volumes', 'Volumes'],
  ['networks', 'Networks'],
  ['compose', 'Compose'],
];
const FILTERS: readonly (readonly [StateFilter, string])[] = [
  ['all', 'All'],
  ['running', 'Running'],
  ['stopped', 'Stopped'],
  ['problem', 'Problem'],
];
const TAILS: readonly (readonly [string, string])[] = [
  ['100', 'Last 100 lines'],
  ['200', 'Last 200 lines'],
  ['500', 'Last 500 lines'],
  ['1000', 'Last 1000 lines'],
];
const LOG_KEEP = 400_000;
/* eslint-disable-next-line no-control-regex */
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** 로그 이벤트 창구는 preload 가 하나뿐이라 한 번만 걸고, 지금 보이는 화면이 받는다. */
const sinks = new WeakMap<DockerApi, { current: ((e: DockerLogEvent) => void) | null }>();
function logSink(api: DockerApi): { current: ((e: DockerLogEvent) => void) | null } {
  let s = sinks.get(api);
  if (s === undefined) {
    const made: { current: ((e: DockerLogEvent) => void) | null } = { current: null };
    api.onLogEvent((e) => made.current?.(e));
    sinks.set(api, made);
    s = made;
  }
  return s;
}

const failText = (f: DockerFailure): string => `${f.title}. ${f.message}${f.help === null ? '' : ` ${f.help}`}`;

function td(content: string | Node, cls?: string): HTMLTableCellElement {
  const c = el('td', cls);
  if (typeof content === 'string') c.textContent = content;
  else c.append(content);
  return c;
}
function headRow(cols: readonly (string | readonly [string, string])[]): HTMLTableSectionElement {
  const head = el('thead');
  const tr = el('tr');
  for (const c of cols) {
    const th = el('th', typeof c === 'string' ? undefined : c[1], typeof c === 'string' ? c : c[0]);
    tr.append(th);
  }
  head.append(tr);
  return head;
}
function emptyState(title: string, body: string): HTMLElement {
  const box = el('div', 'empty-state dk-empty');
  box.append(el('b', undefined, title), el('span', 'hint', body));
  return box;
}

/**
 * Docker 탭: docker CLI 가 알려 주는 것을 보고 다룬다(엔진은 Rauha 밖). 화면은 그리기만 하고,
 * 이름 검증·확인 요구·명령 조립은 shared 와 main 이 한다. 화면이 보일 때만 5초마다 새로 읽고, 읽는 중에는 겹쳐 부르지 않는다.
 */
export function buildDocker(deps: DockerViewDeps) {
  const api = deps.api;
  const now = deps.now ?? Date.now;
  const root = el('section', 'docker');
  let tab: DockerTab = 'containers';
  let status: DockerStatus | null = null;
  let containers: readonly ContainerView[] = [];
  let images: readonly ImageView[] = [];
  let volumes: readonly VolumeView[] = [];
  let networks: readonly NetworkView[] = [];
  let composeFiles: readonly ComposeFileView[] = [];
  let projects: readonly ComposeProjectView[] = [];
  let skipped = 0;
  let query = '';
  let filter: StateFilter = 'all';
  let selected: string | null = null;
  let tail = 200;
  let loading = false;
  let loaded = false;
  let logSeq = 0;
  let logText = '';
  let composeOut = '';
  const pending = new Set<string>();

  // ── 머리줄 ──
  const chipHost = el('span');
  const versionHint = el('span', 'hint grow');
  const refreshBtn = button('Refresh', 'btn', () => void refresh(true));
  const head = el('div', 'rhead dk-head');
  head.append(el('b', undefined, 'Docker'), chipHost, versionHint, refreshBtn);
  const limit = el('div', 'hint', DOCKER_LIMIT_NOTE);
  const notice = el('div', 'notice');
  notice.hidden = true;
  let actionNote = '';
  let listNote = '';
  const paintNotice = (): void => {
    const text = actionNote !== '' ? actionNote : listNote;
    notice.textContent = text;
    notice.hidden = text === '';
  };
  const say = (text: string): void => {
    actionNote = text;
    paintNotice();
  };
  const problemHost = el('div');
  const tabsRow = el('div', 'tabs');
  const tabButtons = new Map<DockerTab, HTMLButtonElement>();
  for (const [id, label] of TABS) {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (tab === id) return;
      tab = id;
      say('');
      paintTools();
      paintBody();
      void refresh(true);
    });
    tabButtons.set(id, b);
    tabsRow.append(b);
  }
  const tools = el('div', 'bar dk-tools');
  const body = el('div', 'pane dk-list');
  const scroller = el('div', 'dk-scroll');
  body.append(scroller);

  // ── 로그·exec ──
  const logPane = el('div', 'pane dk-logs');
  const logTitle = el('b', undefined, 'Logs');
  const logName = el('span', 'hint grow dk-log-name');
  const tailSel = select(TAILS, String(tail), (v) => {
    tail = Number(v);
    void loadLogs();
  });
  tailSel.classList.add('sm');
  const logRefresh = button('Refresh', 'btn sm', () => void loadLogs());
  const logCopy = button('Copy', 'btn sm', () => void deps.copy(logText));
  const logHead = el('div', 'ph');
  logHead.append(logTitle, logName, tailSel, logRefresh, logCopy);
  const logPre = el('pre', 'dk-log mono');
  const execInput = el('input', 'dk-exec-input');
  execInput.placeholder = 'Run one command, e.g. ls /';
  execInput.spellcheck = false;
  execInput.setAttribute('aria-label', 'Command to run inside the container');
  execInput.title = DOCKER_EXEC_NOTE;
  const execBtn = button('Run', 'btn sm run', () => void runExec());
  const execBar = el('div', 'bar dk-exec');
  execBar.append(execInput, execBtn);
  execInput.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      void runExec();
    }
  });
  logPane.append(logHead, logPre, execBar);
  const main = el('div', 'dk-main');
  main.append(body, logPane);
  root.append(head, limit, notice, problemHost, tabsRow, tools, main);

  // ── 그리기 ──
  function paintStatus(): void {
    chipHost.replaceChildren();
    problemHost.replaceChildren();
    if (status === null) {
      chipHost.append(chipOf('Checking…'));
      return;
    }
    if (status.ready) {
      chipHost.append(chipOf('Connected', 'green'));
      versionHint.textContent = `Engine ${status.serverVersion ?? '?'} · CLI ${status.clientVersion ?? '?'}`;
      return;
    }
    chipHost.append(chipOf('Not running', 'red'));
    versionHint.textContent = status.clientVersion === null ? '' : `CLI ${status.clientVersion}`;
    const f = status.failure;
    if (f === null) return;
    const card = el('div', 'item dk-problem');
    card.append(el('b', undefined, f.title), el('div', 'dim', f.message));
    if (f.help !== null) card.append(el('div', 'hint', f.help));
    if (f.link !== null) {
      const a = el('a', 'link', 'Install Docker');
      a.href = f.link === DOCKER_INSTALL_URL ? f.link : DOCKER_INSTALL_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      card.append(a);
    }
    problemHost.append(card);
  }

  function paintTools(): void {
    for (const [id, b] of tabButtons) b.classList.toggle('on', id === tab);
    tools.replaceChildren();
    if (tab !== 'containers') return;
    const search = el('input', 'dk-search grow');
    search.placeholder = 'Search name, image or port';
    search.spellcheck = false;
    search.value = query;
    search.setAttribute('aria-label', 'Search containers');
    search.addEventListener('input', () => {
      query = search.value;
      paintBody();
    });
    tools.append(search);
    for (const [id, label] of FILTERS) {
      const chip = el('button', `chip${filter === id ? ' on' : ''}`, label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        filter = id;
        paintTools();
        paintBody();
      });
      tools.append(chip);
    }
  }

  const act = (label: string, cls: string, key: string, run: () => Promise<DockerResult<unknown>>): HTMLButtonElement => {
    const b = button(label, cls, () => void perform(key, run));
    b.disabled = pending.has(key) || status?.ready !== true;
    return b;
  };

  function actionsCell(buttons: readonly HTMLElement[]): HTMLTableCellElement {
    const box = el('div', 'dk-actions');
    box.append(...buttons);
    for (const b of buttons) b.addEventListener('click', (e) => e.stopPropagation());
    return td(box, 'dk-end');
  }

  function containerRow(c: ContainerView): HTMLTableRowElement {
    const tr = el('tr', c.name === selected ? 'sel' : undefined);
    const name = el('div', 'dk-name');
    name.append(el('b', undefined, c.name));
    if (c.project !== null) name.append(el('span', 'hint', c.project));
    const state = chipOf(STATE_LABEL[c.state], stateTone(c.state));
    state.title = c.status;
    const buttons: HTMLElement[] = [];
    if (c.canStart) buttons.push(act('Start', 'btn sm run', `start:${c.id}`, () => api.start(c.name)));
    if (c.canStop) buttons.push(act('Stop', 'btn sm', `stop:${c.id}`, () => api.stop(c.name)), act('Restart', 'btn sm', `restart:${c.id}`, () => api.restart(c.name)));
    buttons.push(act('Remove', 'btn sm danger', `rm:${c.id}`, () => removeContainer(c)));
    tr.append(td(name), td(c.image, 'dk-opt2'), td(state), td(c.ports.join(', ') || '-', 'dk-opt dim'), td(agoLabel(c.createdAt, Math.floor(now() / 1000)), 'dk-opt dim'), actionsCell(buttons));
    tr.addEventListener('click', () => select_(c.name));
    return tr;
  }

  function paintContainers(): void {
    const shown = containers.filter((c) => containerMatches(c, query, filter));
    if (containers.length === 0) return void scroller.replaceChildren(emptyState('No containers', 'Containers you create with docker run or compose show up here, running or stopped.'));
    if (shown.length === 0) return void scroller.replaceChildren(emptyState('Nothing matches', 'Change the search words or the status filter.'));
    const table = el('table', 'tbl dk-table');
    table.append(headRow(['Name', ['Image', 'dk-opt2'], 'Status', ['Ports', 'dk-opt'], ['Created', 'dk-opt'], '']));
    const tbody = el('tbody');
    for (const c of shown) tbody.append(containerRow(c));
    table.append(tbody);
    scroller.replaceChildren(table);
    if (skipped > 0) scroller.append(el('div', 'hint dk-skip', `${skipped} line(s) from docker could not be read and were skipped.`));
  }

  function paintImages(): void {
    if (images.length === 0) return void scroller.replaceChildren(emptyState('No images', 'Images you pull or build show up here.'));
    const table = el('table', 'tbl dk-table');
    table.append(headRow(['Image', ['ID', 'dk-opt'], 'Size', ['Created', 'dk-opt'], 'Used', '']));
    const tbody = el('tbody');
    for (const i of images) {
      const tr = el('tr');
      const used = i.inUse ? chipOf('In use', 'green') : chipOf('Unused');
      tr.append(td(i.ref), td(i.id, 'dk-opt dim mono'), td(i.size), td(agoLabel(i.createdAt, Math.floor(now() / 1000)), 'dk-opt dim'), td(used), actionsCell([act('Remove', 'btn sm danger', `rmi:${i.id}`, () => removeNamed('image', i.ref, (confirm) => api.imageRemove({ ref: i.ref, confirm })))]));
      tbody.append(tr);
    }
    table.append(tbody);
    scroller.replaceChildren(table);
  }

  function paintVolumes(): void {
    if (volumes.length === 0) return void scroller.replaceChildren(emptyState('No volumes', 'Named volumes created by containers show up here.'));
    const table = el('table', 'tbl dk-table');
    table.append(headRow(['Name', ['Driver', 'dk-opt'], '']));
    const tbody = el('tbody');
    for (const v of volumes) {
      const tr = el('tr');
      tr.append(td(v.name), td(v.driver, 'dk-opt dim'), actionsCell([act('Remove', 'btn sm danger', `vrm:${v.name}`, () => removeNamed('volume', v.name, (confirm) => api.volumeRemove({ name: v.name, confirm })))]));
      tbody.append(tr);
    }
    table.append(tbody);
    scroller.replaceChildren(table);
  }

  function paintNetworks(): void {
    if (networks.length === 0) return void scroller.replaceChildren(emptyState('No networks', 'Docker networks show up here.'));
    const table = el('table', 'tbl dk-table');
    table.append(headRow(['Name', ['Driver', 'dk-opt'], ['Scope', 'dk-opt'], '']));
    const tbody = el('tbody');
    for (const n of networks) {
      const tr = el('tr');
      const remove = act('Remove', 'btn sm danger', `nrm:${n.name}`, () => removeNamed('network', n.name, (confirm) => api.networkRemove({ name: n.name, confirm })));
      if (n.builtin) {
        remove.disabled = true;
        remove.title = 'Docker keeps this network built in';
      }
      tr.append(td(n.name), td(n.driver, 'dk-opt dim'), td(n.scope, 'dk-opt dim'), actionsCell([remove]));
      tbody.append(tr);
    }
    table.append(tbody);
    scroller.replaceChildren(table);
  }

  function paintCompose(): void {
    const frag = document.createDocumentFragment();
    if (composeFiles.length === 0) frag.append(emptyState('No compose files', 'Rauha looks for docker-compose.yml or compose.yaml in your work folder. Pick a work folder in Settings.'));
    else {
      const table = el('table', 'tbl dk-table');
      table.append(headRow(['Compose file', '']));
      const tbody = el('tbody');
      for (const f of composeFiles) {
        const tr = el('tr');
        const op = (label: string, cls: string, o: 'ps' | 'up' | 'down' | 'logs'): HTMLButtonElement => act(label, cls, `c:${o}:${f.path}`, () => runCompose(f, o));
        const name = el('div', 'dk-name');
        name.append(el('b', undefined, f.path), el('span', 'hint', f.folder));
        tr.append(td(name), actionsCell([op('Status', 'btn sm', 'ps'), op('Up', 'btn sm run', 'up'), op('Logs', 'btn sm', 'logs'), op('Down', 'btn sm danger', 'down')]));
        tbody.append(tr);
      }
      table.append(tbody);
      frag.append(table);
    }
    if (projects.length > 0) {
      const t2 = el('table', 'tbl dk-table');
      t2.append(headRow(['Project', 'Status']));
      const b2 = el('tbody');
      for (const p of projects) {
        const tr = el('tr');
        tr.append(td(p.name), td(chipOf(p.status || 'Unknown', p.running ? 'green' : '')));
        b2.append(tr);
      }
      t2.append(b2);
      frag.append(t2);
    }
    if (composeOut !== '') frag.append(el('pre', 'dk-log mono dk-compose-out', composeOut));
    scroller.replaceChildren(frag);
  }

  function paintBody(): void {
    logPane.hidden = tab !== 'containers' || status?.ready !== true;
    if (status?.ready === false || (status === null && !loaded)) {
      scroller.replaceChildren(emptyState(status === null ? 'Checking Docker…' : 'Docker is not running', status === null ? 'Asking the docker CLI for its state.' : 'Start your Docker engine, then press Refresh. Nothing is listed until it answers.'));
      return;
    }
    if (tab === 'containers') paintContainers();
    else if (tab === 'images') paintImages();
    else if (tab === 'volumes') paintVolumes();
    else if (tab === 'networks') paintNetworks();
    else paintCompose();
  }

  // ── 동작 ──
  async function perform(key: string, run: () => Promise<DockerResult<unknown>>): Promise<void> {
    if (pending.has(key)) return;
    pending.add(key);
    paintBody();
    try {
      const r = await run();
      if (!r.ok) {
        if (r.failure.kind !== 'cancelled' && r.failure.kind !== 'confirm') say(failText(r.failure));
      } else say('');
    } finally {
      pending.delete(key);
    }
    await refresh(true);
  }

  /** 지우기 전에 확인 창. 취소하면 아무것도 부르지 않는다(null 이 아니라 취소 실패로 돌려준다). */
  async function removeContainer(c: ContainerView): Promise<DockerResult<null>> {
    const a = await askDialog({ title: `Remove container ${c.name}?`, body: c.canStop ? 'It is still running, so Docker will refuse unless you stop it first. Its data inside the container is lost.' : 'The container and its writable layer are deleted. Named volumes stay.', okLabel: 'Remove', danger: true });
    return a.ok ? api.remove({ id: c.name, confirm: true }) : cancelled();
  }
  async function removeNamed(kind: string, name: string, run: (confirm: boolean) => Promise<DockerResult<null>>): Promise<DockerResult<null>> {
    const a = await askDialog({ title: `Remove ${kind} ${name}?`, body: kind === 'volume' ? 'The data in the volume is deleted and cannot be brought back.' : 'Docker refuses if something still uses it.', okLabel: 'Remove', danger: true });
    return a.ok ? run(true) : cancelled();
  }
  const cancelled = (): DockerResult<null> => ({ ok: false, failure: { kind: 'cancelled', title: 'Cancelled', message: 'Nothing was changed.', help: null, link: null } });

  async function runCompose(f: ComposeFileView, op: 'ps' | 'up' | 'down' | 'logs'): Promise<DockerResult<unknown>> {
    if (op === 'down') {
      const a = await askDialog({ title: `Stop and remove ${f.path}?`, body: 'Runs docker compose down: containers and networks of this project are removed. Volumes stay.', okLabel: 'Down', danger: true });
      if (!a.ok) return cancelled();
    }
    const r = await api.compose({ file: f.path, op, confirm: op === 'down', tail: 200 });
    if (r.ok) {
      composeOut = op === 'ps' ? (r.data.services.map((s) => `${s.service || s.name}\t${STATE_LABEL[s.state]}\t${s.status}`).join('\n') || 'No services are created yet.') : r.data.output || `docker compose ${op} finished.`;
    }
    return r;
  }

  function select_(name: string): void {
    selected = name;
    paintBody();
    void loadLogs();
  }

  function setLog(text: string): void {
    logText = text.length > LOG_KEEP ? text.slice(-LOG_KEEP) : text;
    logPre.textContent = logText;
    logPre.scrollTop = logPre.scrollHeight;
  }

  async function loadLogs(): Promise<void> {
    logName.textContent = selected ?? '';
    if (selected === null) return setLog('Select a container above to see its latest log lines.');
    const mine = ++logSeq;
    let streamId: string | null = null;
    let buffer = '';
    setLog('Loading…');
    logSink(api).current = (e) => {
      if (mine !== logSeq || (streamId !== null && e.streamId !== streamId)) return;
      if (e.type === 'out') {
        buffer += e.data.replace(ANSI, '');
        setLog(buffer);
      } else if (e.note !== null) setLog(`${buffer}\n${e.note}`);
      else if (buffer === '') setLog('No log lines yet.');
    };
    const r = await api.logs({ id: selected, tail });
    if (mine !== logSeq) return;
    if (!r.ok) return setLog(failText(r.failure));
    streamId = r.data.streamId;
  }

  async function runExec(): Promise<void> {
    const line = execInput.value.trim();
    if (selected === null || line === '' || pending.has('exec')) return;
    pending.add('exec');
    execBtn.disabled = true;
    try {
      const r = await api.exec({ id: selected, line });
      setLog(`${logText}\n$ ${line}\n${r.ok ? `${r.data.output}${r.data.exitCode === 0 ? '' : `\n[exit ${r.data.exitCode ?? '?'}]`}` : failText(r.failure)}\n`);
      execInput.value = '';
    } finally {
      pending.delete('exec');
      execBtn.disabled = false;
    }
  }

  async function refresh(force: boolean): Promise<void> {
    if (loading) return;
    if (!force && (!root.isConnected || root.offsetParent === null || document.hidden)) return;
    loading = true;
    refreshBtn.disabled = true;
    try {
      status = await api.status();
      paintStatus();
      if (status.ready) await loadTab();
      else {
        containers = [];
        images = [];
        volumes = [];
        networks = [];
      }
      loaded = true;
      paintNotice();
      paintBody();
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  }

  async function loadTab(): Promise<void> {
    listNote = '';
    const fail = (f: DockerFailure): void => {
      listNote = failText(f);
    };
    if (tab === 'containers') {
      const r = await api.containers();
      if (r.ok) ((containers = r.data.containers), (skipped = r.data.skipped));
      else fail(r.failure);
    } else if (tab === 'images') {
      const r = await api.images();
      if (r.ok) images = r.data.images;
      else fail(r.failure);
    } else if (tab === 'volumes') {
      const r = await api.volumes();
      if (r.ok) volumes = r.data.volumes;
      else fail(r.failure);
    } else if (tab === 'networks') {
      const r = await api.networks();
      if (r.ok) networks = r.data.networks;
      else fail(r.failure);
    } else {
      const [files, list] = await Promise.all([api.composeFind(), api.composeList()]);
      if (files.ok) composeFiles = files.data;
      if (list.ok) projects = list.data;
      else fail(list.failure);
    }
  }

  const timer = window.setInterval(() => {
    if (!root.isConnected) window.clearInterval(timer);
    else void refresh(false);
  }, deps.refreshMs ?? 5000);

  paintStatus();
  paintTools();
  paintBody();
  setLog('Select a container above to see its latest log lines.');
  void refresh(true);

  return { root, refresh: () => refresh(true) };
}
