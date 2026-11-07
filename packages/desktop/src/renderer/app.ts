import type { BoardView, JobView, RauhaApi } from '../shared/ipc.js';
import { spriteFor, type CharacterRole, type Sprite } from './characters.js';
import { statusText } from './status-line.js';
import { TABS, type TabId } from './tabs.js';

declare global {
  interface Window {
    readonly rauha: RauhaApi;
  }
}

const STATUS_LABEL: Readonly<Record<JobView['status'], string>> = {
  queued: '대기',
  running: '진행 중',
  waiting: '기다림',
  done: '끝',
  stopped: '멈춤',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls !== undefined) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

// ── 캐릭터 ──────────────────────────────────────────────

interface Drawn {
  readonly canvas: HTMLCanvasElement;
  readonly sprite: Sprite;
  readonly scale: number;
}
const drawn: Drawn[] = [];

function paint(d: Drawn, frame: number): void {
  const ctx = d.canvas.getContext('2d');
  if (ctx === null) return;
  const rows = d.sprite.frames[frame] ?? d.sprite.frames[0]!;
  ctx.clearRect(0, 0, d.canvas.width, d.canvas.height);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = d.sprite.palette[ch];
      if (color === undefined) return;
      ctx.fillStyle = color;
      ctx.fillRect(x * d.scale, y * d.scale, d.scale, d.scale);
    }),
  );
}

/** 픽셀 캐릭터 캔버스. 흐려지지 않게 정수 배로만 키운다. */
function character(role: CharacterRole, scale: number): HTMLCanvasElement {
  const sprite = spriteFor(role);
  const canvas = el('canvas', 'sp');
  canvas.width = sprite.frames[0]![0]!.length * scale;
  canvas.height = sprite.frames[0]!.length * scale;
  const d = { canvas, sprite, scale };
  drawn.push(d);
  paint(d, 0);
  return canvas;
}

let tick = 0;
setInterval(() => {
  tick += 1;
  const blink = tick % 14 === 0;
  for (const d of drawn) if (d.sprite.frames.length > 1 && d.canvas.isConnected) paint(d, blink ? 1 : 0);
}, 230);

// ── 탭 ─────────────────────────────────────────────────

const tabsNav = document.getElementById('tabs')!;
const screen = document.getElementById('screen')!;
let current: TabId = 'chat';

function icon(path: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  for (const d of path.split(' M').map((p, i) => (i === 0 ? p : `M${p}`))) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function renderTabs(): void {
  tabsNav.replaceChildren();
  const add = (t: (typeof TABS)[number]) => {
    const b = el('button');
    b.title = t.label;
    b.classList.toggle('on', t.id === current);
    b.append(icon(t.icon), el('span', undefined, t.label));
    b.addEventListener('click', () => show(t.id));
    tabsNav.appendChild(b);
  };
  TABS.filter((t) => !t.bottom).forEach(add);
  tabsNav.appendChild(el('span', 'spacer'));
  TABS.filter((t) => t.bottom).forEach(add);
}

function show(id: TabId): void {
  current = id;
  renderTabs();
  const tab = TABS.find((t) => t.id === id)!;
  if (tab.ready) screen.replaceChildren(chat.root);
  else {
    const soon = el('div', 'soon');
    soon.append(el('b', undefined, tab.label), el('span', undefined, '곧 열려요'));
    screen.replaceChildren(soon);
  }
}

// ── 채팅 ───────────────────────────────────────────────

function buildChat() {
  const root = el('section', 'chat');
  const pane = el('div', 'pane');
  const head = el('div', 'ph');
  head.append(character('delfi', 2), el('b', undefined, '메인'), el('span', 'hint', 'Delfi에게 일을 맡겨요. 맡긴 뒤에도 바로 다음 일을 보낼 수 있어요.'));
  const msgs = el('div', 'msgs');
  const empty = el('div', 'empty');
  empty.append(character('delfi', 5), el('div', undefined, '무엇을 맡길까요? 여러 개를 연달아 보내도 돼요.'));
  msgs.appendChild(empty);

  const composer = el('div', 'composer');
  const input = el('textarea');
  input.placeholder = '새 업무를 입력하세요…';
  input.rows = 1;
  const hint = el('div', 'hint');
  hint.innerHTML = '<span><span class="kbd">Enter</span> 보내기</span><span class="more"><span class="kbd">Shift+Enter</span> 줄바꿈</span><span class="more">지금은 연습용 작업으로 돌아요</span>';
  composer.append(input, hint);
  pane.append(head, msgs, composer);
  root.appendChild(pane);

  const cards = new Map<string, { dot: HTMLElement; state: HTMLElement; stop: HTMLButtonElement }>();

  const send = async () => {
    const text = input.value;
    if (text.trim() === '') return;
    input.value = '';
    const job = await window.rauha.submit(text);
    if (job !== null) addJob(job);
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });

  function addJob(job: JobView): void {
    if (cards.has(job.id)) return;
    empty.remove();
    const me = el('div', 'm me');
    me.appendChild(el('div', 'tx', job.request));
    const reply = el('div', 'm');
    const av = el('div', 'av');
    av.appendChild(character('delfi', 2));
    const body = el('div');
    const tx = el('div', 'tx', '팀에 넘겼어요.');
    const hand = el('div', 'hand');
    const dot = el('span', 'dot');
    const state = el('span', 'state');
    const stop = el('button', 'stop', '멈추기');
    stop.addEventListener('click', () => window.rauha.stop(job.id));
    hand.append(dot, el('span', undefined, '연습용 작업'), state, stop);
    tx.appendChild(hand);
    body.append(el('div', 'who', 'Delfi'), tx);
    reply.append(av, body);
    msgs.append(me, reply);
    cards.set(job.id, { dot, state, stop });
    update(job);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function update(job: JobView): void {
    const card = cards.get(job.id);
    if (card === undefined) return;
    card.dot.className = `dot ${job.status}`;
    card.state.textContent = `· ${STATUS_LABEL[job.status]}${job.stopReason !== null ? ` (${job.stopReason})` : ''}`;
    card.stop.hidden = job.status === 'done' || job.status === 'stopped';
  }

  return {
    root,
    board(view: BoardView): void {
      for (const job of view.jobs) {
        addJob(job);
        update(job);
      }
    },
    focus: () => input.focus(),
  };
}

const chat = buildChat();

function renderStatus(view: BoardView): void {
  document.getElementById('status-jobs')!.textContent = statusText(view);
  document.getElementById('status-limit')!.textContent = `동시에 ${view.limit}개까지`;
}

window.rauha.onBoard((view) => {
  chat.board(view);
  renderStatus(view);
});
void window.rauha.boardNow().then((view) => {
  chat.board(view);
  renderStatus(view);
});

show('chat');
chat.focus();
