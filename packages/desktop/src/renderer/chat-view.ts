import type { InfraRisk } from '@rauha/core/jobs';
import type { ApprovalSummary } from '../shared/approval-summary.js';
import { providerOf, type AiProviderId } from '../shared/external-ai.js';
import { seedOf, stageBubble, teamChat } from '../shared/team-voice.js';
import { buildAiBar, type AiBarDeps, type ChatTarget } from './ai-bar.js';
import { AI_LOGO_SVG, aiLogoUrl } from './ai-logos.js';
import type { AiResult } from '../shared/external-ai-ipc.js';
import { classifyDiffLine, type ChangeReview } from '../shared/branch-impact.js';
import type { ApprovalChoice, ApprovalView, BoardView, JobView } from '../shared/ipc.js';
import { CHARACTER_ROLES, characterSetId, leadName, spriteFor, type CharacterRole } from './characters.js';
import type { Command } from '../shared/command-book.js';
import { attachSuggest } from './command-suggest.js';
import { attachMentionSuggest } from './mention-suggest.js';
import { recentList } from './recent-files.js';
import { ImageAttachment, ImageDraft, MAX_IMAGE_BYTES, MAX_IMAGES } from '../shared/image-attach.js';
import { askCard } from './ask-card.js';
import { needLabel } from '../shared/ask-form.js';
import { el, isEnterKey } from './dom.js';
import { needsLogin } from '../shared/claude-login.js';
import { loginCard } from './login-view.js';
import { teamBoard } from '../shared/team-board.js';
import { characterStateOf, elapsedText } from './room.js';
import { askDialog } from './git-common.js';
import { flash } from './record-parts.js';
import { ChatScroll } from './chat-scroll.js';
import { canRevise, composerHeight, replyWho, roomLogLine, stopReasonText } from '../shared/chat-text.js';
import { RESET_CONFIRM, resetNotice, type ConversationResetResult } from '../shared/conversation-reset.js';
import { mountStage, paintOnce } from './stage.js';
import { changesPanel } from './changes-view.js';
import { isLimitStop } from '../shared/limit-retry.js';
import { ChatSplit } from '../shared/chat-split.js';
import { answerMarkdown } from '../shared/answer-markdown.js';
import { parseMarkdown } from '../shared/markdown.js';
import { renderMarkdown } from './markdown-view.js';

/** 팀 답 카드: Claude 확장처럼 마크다운(표·코드·소제목·굵게)으로 그린다. 글은 textNode 로만 들어가고 그림은 읽지 않는다. */
function answerCard(text: string): HTMLElement {
  const card = el('div', 'tx tx-md');
  const md = renderMarkdown(parseMarkdown(answerMarkdown(text)), { path: '', loadImage: () => Promise.reject(new Error('No images in answers')) });
  md.classList.add('md-chat');
  card.appendChild(md);
  return card;
}

const STATUS_LABEL: Readonly<Record<JobView['status'], string>> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Needs your answer',
  done: 'Done',
  stopped: 'Stopped',
};

/** 끝난 방이 사라지기까지 보여 주는 시간 */
const ROOM_LINGER_MS = 6000;
/** Main 카드 아래 팀 대화는 최근 이만큼(여러 팀이 같이 돌아도 Main 이 너무 길어지지 않게), 태스크 화면은 거의 다 */
const MAIN_TALK_MAX = 12;
const TASK_TALK_MAX = 80;

const isRole = (r: string): r is CharacterRole => (CHARACTER_ROLES as readonly string[]).includes(r);
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const nameOf = (role: CharacterRole) => spriteFor(role).name;

export interface ChatActions {
  /** images: 입력칸에 붙인 이미지 바이트(없으면 생략) */
  readonly submit: (text: string, images?: readonly Uint8Array[]) => Promise<JobView | null>;
  /** Kiro · ChatGPT(Codex)에게 한 번 묻기(읽기 전용). 없으면 AI 고르기 메뉴를 숨긴다 */
  readonly askOther?: (id: AiProviderId, text: string) => Promise<AiResult<{ readonly text: string; readonly seconds: number }>>;
  /** 작업에 이어서 묻기(답장·후속 질문). 없으면 단추를 숨긴다 */
  readonly followUp?: (parentId: string, text: string, inTask?: boolean) => Promise<JobView | null>;
  /** 채팅 맨 위 AI 고르기 줄(로그인 상태·단추). 없으면 줄을 그리지 않는다 */
  readonly ai?: AiBarDeps;
  readonly stop: (id: string) => void;
  readonly deeper: (id: string) => Promise<JobView | null>;
  /** 한도에 걸려 멈춘 작업을 한도가 풀리면 다시 맡기기. 없으면 단추를 숨긴다 */
  readonly limitRetry?: {
    readonly schedule: (id: string) => Promise<{ readonly ok: true; readonly at: string } | { readonly ok: false; readonly error: string }>;
    readonly cancel: (id: string) => Promise<void>;
    readonly now: () => Promise<Readonly<Record<string, string>>>;
    readonly on: (listener: (retries: Readonly<Record<string, string>>) => void) => void;
  };
  /** 보낸 일을 할 일로 담는다 */
  readonly saveTodo?: (text: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
  readonly answer: (id: string, choice: ApprovalChoice) => void;
  readonly review: (id: string) => Promise<ChangeReview | null>;
  /** `/명령`을 읽어 앱이 처리하고, 팀에 보낼 글을 돌려준다(앱이 처리했으면 null). 없으면 글을 그대로 보낸다. */
  readonly intercept?: (text: string) => Promise<string | null>;
  /** `/`를 치는 동안 보일 명령 후보 */
  readonly suggest?: (text: string) => readonly Command[];
  /** 지금 작업 폴더의 앞 대화를 비운다(기억·지식·파일은 그대로) */
  readonly resetConversation?: () => Promise<ConversationResetResult>;
}

interface RoomEl {
  readonly root: HTMLElement;
  /** turns: 그 태스크의 대화 차례 수(이어서 물었으면 2 이상) */
  readonly update: (job: JobView, approvals: readonly ApprovalView[], turns: number) => void;
}

/**
 * 채팅 탭: 메인 칸(팀장 캐릭터) + 팀 방 + 맨 위 띠 + 팀 상세. 배치(나란히·위아래·메인만)는 CSS가 .app의 data-mode로 바꾼다.
 * 화면은 board·approvals를 받아 그리기만 한다. 규칙 판단은 main(core)에 있다.
 */
export function buildChat(actions: ChatActions) {
  const jobs = new Map<string, JobView>();
  let approvals: readonly ApprovalView[] = [];
  let openId: string | null = null;
  /** 팀 목록에 올릴 태스크의 시작점: 이 화면을 연 때(그 전 일은 Main 대화에만, 도는 일은 남는다) */
  const boardSince = new Date(Date.now() - 2000).toISOString();
  let detailTab: 'summary' | 'log' = 'summary';

  const root = el('section', 'chat');
  root.id = 'chatGrid';

  // ── 메인 칸 ──
  const mainPane = el('div', 'pane mainp');
  const head = el('div', 'ph');
  const headFace = el('canvas', 'sp');
  paintOnce(headFace, 'intake', 2);
  const layoutToggle = el('div', 'seg ltoggle');
  const leadHint = el('span', 'hint');
  const leadHintText = (): string => `Hand work to ${leadName()}. You can send the next task right away.`;
  leadHint.textContent = leadHintText();
  head.append(headFace, el('b', undefined, 'Main'), leadHint, layoutToggle);
  // 누구에게 물을지: 채팅 맨 위 AI 줄(Claude 팀 기본 · Kiro · ChatGPT, 로그인 단추 포함). 바깥 AI 는 읽기 전용 한 번 묻기
  let target: ChatTarget = 'team';
  const aiBar = actions.ai === undefined ? null : buildAiBar(actions.ai, (t) => {
    target = t;
    leadHint.textContent = t === 'team' ? leadHintText() : `Ask ${providerOf(t)?.label ?? ''}. One answer, read-only (it cannot change files).`;
    input.placeholder = t === 'team' ? 'Type a new task…  (@folder to pick a target, @file to attach one)' : `Ask ${providerOf(t)?.label ?? ''}…`;
  });
  /** 바깥 AI 에게 한 번 묻고, 내 말풍선과 답 말풍선을 단다 */
  async function askOther(id: AiProviderId, text: string): Promise<void> {
    const p = providerOf(id);
    if (actions.askOther === undefined || p === null) return;
    empty.remove();
    const me = el('div', 'm me');
    me.appendChild(el('div', 'tx', text));
    const reply = el('div', 'm other-ai');
    const av = el('div', `av ai-av ${id}`);
    const mark = el('img', `ai-logo ${id}`);
    mark.src = aiLogoUrl(AI_LOGO_SVG[id]);
    mark.alt = p.label;
    av.append(mark);
    const body = el('div');
    const tx = el('div', 'tx');
    tx.append(el('span', 'spinner'), ` Asking ${p.label}…`);
    body.append(tx);
    reply.append(av, body);
    msgs.append(me, reply);
    toBottom();
    const r = await actions.askOther(id, text);
    if (r.ok) {
      tx.className = 'tx ai-answer';
      tx.textContent = r.data.text;
      body.append(el('div', 'hint ai-meta', `${p.label} · ${r.data.seconds}s · read-only`));
    } else {
      tx.className = 'tx err';
      tx.textContent = r.error;
    }
    if (scroll.pinned) toBottom();
  }
  /** 화면의 말풍선을 비운다(돌고 있는 작업과 기록은 그대로). /clear 와 '대화 초기화' 단추가 같이 쓴다. */
  function clearVisibleChat(): void {
    msgs.replaceChildren(empty);
    cards.clear();
    for (const j of jobs.values()) {
      reported.add(j.id);
      if (j.status === 'done' || j.status === 'stopped') cleared.add(j.id);
    }
  }
  if (actions.resetConversation !== undefined) {
    const resetConversation = actions.resetConversation;
    const reset = el('button', 'btn sm reset-conv', 'Reset chat');
    reset.title = 'Clears the earlier chat and the carried-over file list. Memory is kept.';
    reset.addEventListener('click', async () => {
      const answer = await askDialog({ ...RESET_CONFIRM, danger: true });
      if (!answer.ok) return;
      reset.disabled = true;
      try {
        const result = await resetConversation();
        // /clear 처럼 화면도 함께 비운다(모델이 기억하는 앞 대화만 비우고 화면은 그대로여서 초기화가 안 된 것처럼 보였다)
        if (result.ok) clearVisibleChat();
        flash(resetNotice(result));
      } finally {
        reset.disabled = false;
      }
    });
    head.appendChild(reset);
  }
  const msgs = el('div', 'msgs');
  const empty = el('div', 'empty');
  const emptyFace = el('canvas', 'sp');
  paintOnce(emptyFace, 'intake', 5);
  empty.append(emptyFace, el('div', undefined, 'What should the team do? You can send several in a row.'));
  msgs.appendChild(empty);
  // 스크롤 자리 기억: 탭을 바꿨다 돌아와도 맨 위로 튀지 않게, 위로 올려 읽는 중이면 맨 아래로 가는 단추를 띄운다
  const scroll = ChatScroll.start();
  const msgsWrap = el('div', 'msgs-wrap');
  const jump = el('button', 'jump-bottom', '↓');
  jump.title = 'Jump to the latest message';
  jump.setAttribute('aria-label', 'Jump to the latest message');
  jump.hidden = true;
  msgsWrap.append(msgs, jump);
  const syncJump = (): void => {
    jump.hidden = scroll.pinned;
  };
  msgs.addEventListener('scroll', () => {
    // 떼어진 동안(다른 탭)의 scrollTop 0 은 사용자가 움직인 자리가 아니다
    if (!msgs.isConnected) return;
    scroll.observe({ top: msgs.scrollTop, client: msgs.clientHeight, height: msgs.scrollHeight });
    syncJump();
  });
  /** Main 이 가려진 동안(팀 화면을 연 동안) 새 말이 왔다: 돌아오면 맨 아래로 */
  let bottomLater = false;
  function toBottom(): void {
    // 가려진 칸은 높이가 0 이라 스크롤도, 맨 아래 기억도 틀어진다 → 보일 때 내린다
    if (msgs.clientHeight === 0) {
      bottomLater = true;
      return;
    }
    bottomLater = false;
    msgs.scrollTop = msgs.scrollHeight;
    scroll.observe({ top: msgs.scrollTop, client: msgs.clientHeight, height: msgs.scrollHeight });
    syncJump();
  }
  jump.addEventListener('click', () => msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' }));
  const composer = el('div', 'composer');
  const input = el('textarea');
  input.placeholder = 'Type a new task…  (@folder to pick a target, @file to attach one)';
  input.rows = 1;
  const hint = el('div', 'hint');
  hint.innerHTML = '<span><span class="kbd">Enter</span> Send</span><span class="more"><span class="kbd">Shift+Enter</span> New line</span><span class="more"><span class="kbd">@</span> Pick folder or file</span><span class="more">Paste or drop images (up to 3)</span>';
  const attachBar = el('div', 'attach-bar');
  attachBar.hidden = true;
  composer.append(attachBar, input, hint);
  // 답을 기다리는 허락·질문 카드. 팀 상세를 열지 않아도 입력칸 바로 위에서 답할 수 있다(안 보여서 작업이 멈춘 듯 보이지 않게).
  const askTray = el('div', 'ask-tray');
  askTray.hidden = true;
  mainPane.append(...(aiBar === null ? [] : [aiBar.root]), head, msgsWrap, askTray, composer);

  // ── 아주 좁을 때 맨 위 띠 ──
  const strip = el('div', 'strip');
  // ── 팀 방들 ──
  const rooms = el('div', 'rooms');
  // ── 팀 상세 ──
  const detail = el('div', 'detail');
  // ── 에이전트 목록(에이전트 창 배치에서만 보인다): Main + 태스크마다 한 줄, 고르면 가운데에 그 대화 ──
  const agents = el('nav', 'agents');
  agents.setAttribute('aria-label', 'Agents');

  root.append(agents, mainPane, strip, rooms, detail);

  // ── Main · 팀 목록 비율: 가운데 손잡이를 끌거나(두 번 누르면 7:3) ←/→ 로 바꾸고, 다음에도 그대로 ──
  const SPLIT_KEY = 'rauha.chat.split';
  const grip = el('div', 'split-grip');
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'Resize Main and team list');
  grip.title = 'Drag to resize · double-click to reset';
  mainPane.appendChild(grip);
  const readSplit = (): string | null => {
    try {
      return localStorage.getItem(SPLIT_KEY);
    } catch {
      return null;
    }
  };
  function applySplit(s: ChatSplit, save: boolean): void {
    const c = s.columns();
    root.style.setProperty('--main-fr', c.main);
    root.style.setProperty('--rooms-fr', c.rooms);
    grip.setAttribute('aria-valuenow', String(s.mainPercent));
    if (!save) return;
    try {
      localStorage.setItem(SPLIT_KEY, s.toStored());
    } catch {
      /* 저장이 막혀 있어도 이번 화면에서는 바뀐 비율로 쓴다 */
    }
  }
  let split = ChatSplit.fromStored(readSplit());
  applySplit(split, false);
  grip.setAttribute('aria-valuemin', String(ChatSplit.MIN));
  grip.setAttribute('aria-valuemax', String(ChatSplit.MAX));
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* 잡을 수 없는 포인터(합성 이벤트 등)면 잡지 않고 끈다 */
    }
    grip.classList.add('drag');
    root.classList.add('resizing');
    const move = (ev: PointerEvent): void => {
      const box = root.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(root).paddingLeft) || 0;
      split = ChatSplit.fromDrag(ev.clientX - box.left - pad, box.width - pad * 2);
      applySplit(split, false);
    };
    const up = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.classList.remove('drag');
      root.classList.remove('resizing');
      applySplit(split, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => {
    split = ChatSplit.fromStored(null);
    applySplit(split, true);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    split = split.nudge(e.key === 'ArrowLeft' ? -5 : 5);
    applySplit(split, true);
  });

  /** talk: Main 카드 아래에 실시간으로 쌓이는 팀 대화, talkSeen: 마지막으로 그린 진행 글 수(같으면 다시 그리지 않는다) */
  const cards = new Map<string, { dot: HTMLElement; state: HTMLElement; stop: HTMLButtonElement; line: HTMLElement; talk: HTMLElement; talkSeen: string }>();
  const reported = new Set<string>();
  /** 끝난 일 카드의 세션 한 줄 자리(한도를 다시 읽은 뒤 채운다) */
  const sessionLines = new Map<string, HTMLElement>();
  function lateSessionLine(job: JobView): void {
    const slot = sessionLines.get(job.id);
    if (slot === undefined || job.sessionLine === undefined || slot.textContent === job.sessionLine) return;
    slot.textContent = job.sessionLine;
    slot.hidden = false;
  }
  /** 화면 지우기(/clear)로 비운 끝난 작업. 다시 그리지 않는다. */
  const cleared = new Set<string>();
  const roomEls = new Map<string, RoomEl>();

  // ── 태스크 대화 묶음(thread): 처음 태스크 + 이어서 물은 것들 ──
  const rootIdOf = (id: string): string => jobs.get(id)?.thread ?? id;
  /** 그 태스크의 대화 차례(처음 태스크부터 시간 순) */
  function threadJobs(rootId: string): JobView[] {
    const first = jobs.get(rootId);
    const rest = [...jobs.values()].filter((j) => j.thread === rootId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    return first === undefined ? rest : [first, ...rest];
  }
  /** 태스크 안에서 이어 물은 마지막 차례(없으면 처음 태스크). Main 카드·팀 방은 이것의 상태를 보인다 */
  const latestInTask = (rootId: string): JobView | undefined => [...threadJobs(rootId)].reverse().find((j) => j.id === rootId || j.inTask);

  // ── 답장(이어서 묻기) ──
  /** 후속 작업 → 앞 작업 id(화면이 만든 이어짐. 작업 상세에서 줄줄이 보인다) */
  const followOf = new Map<string, string>();
  const followDrafts = new Map<string, string>();
  let followFocus: string | null = null;
  let replyTo: JobView | null = null;
  // Main 에서 Enter 는 늘 새 일이다: 쉬는 팀 중 맨 위 팀이 맡는다(shared/team-board.ts). 같은 팀에 이으려면 ↩ Reply 또는 팀 화면에서
  const replyBar = el('div', 'reply-bar');
  replyBar.hidden = true;
  composer.prepend(replyBar);
  function setReply(job: JobView | null): void {
    replyTo = job;
    replyBar.hidden = job === null;
    if (job === null) return void replyBar.replaceChildren();
    const x = el('button', 'link', '✕');
    x.title = 'Cancel the reply';
    x.setAttribute('aria-label', 'Cancel the reply');
    x.addEventListener('click', () => setReply(null));
    replyBar.replaceChildren(el('span', 'dim', '↩ Replying to'), el('b', 'grow', short(job.request, 80)), x);
    input.focus();
  }
  /**
   * 이어서 묻기를 보낸다. 받지 못하면 false.
   * inTask(태스크 안에서): Main 에 새 말풍선 없이 그 태스크 대화 아래로 쌓인다. 아니면(Main 답장) Main 에 인용 달린 말풍선.
   */
  async function sendFollowUp(parent: JobView, text: string, inTask = false): Promise<boolean> {
    if (actions.followUp === undefined) return false;
    const job = await actions.followUp(parent.id, text, inTask);
    if (job === null) return false;
    followOf.set(job.id, parent.id);
    jobs.set(job.id, job);
    // 태스크 안에서 보낸 말도 Main 에 "↩ 팀 안에서" 인용과 함께 올린다(Main 에서도 대화를 따라간다)
    addJob(job);
    if (inTask) {
      updateCard(job);
      renderRooms();
    }
    // 작업판 소식이 먼저 와서 말풍선이 이미 그려졌을 수 있다: 거기에도 인용을 붙인다
    quoteOn(job.id);
    return true;
  }
  /** 내 말풍선 위에 "↩ 앞 요청" 인용(한 번만) */
  const meById = new Map<string, HTMLElement>();
  function quoteOn(id: string): void {
    const job = jobs.get(id);
    const parent = followOf.get(id) ?? job?.thread ?? undefined;
    const me = meById.get(id);
    if (parent === undefined || me === undefined || me.querySelector('.reply-quote') !== null) return;
    const where = job?.inTask === true ? 'In team · ' : '';
    me.prepend(el('div', 'reply-quote', `↩ ${where}${short(jobs.get(rootIdOf(parent))?.request ?? jobs.get(parent)?.request ?? '', 60)}`));
  }

  // ── 보내기 ──
  const send = async () => {
    const typed = input.value;
    if (typed.trim() === '') return;
    if (replyTo !== null && target === 'team' && !typed.trimStart().startsWith('/')) {
      const parent = replyTo;
      input.value = '';
      fit();
      if (await sendFollowUp(parent, typed.trim())) setReply(null);
      else {
        input.value = typed;
        flash('Could not continue that task. Pick and allow a work folder first, or try again.');
      }
      input.focus();
      return;
    }
    input.value = '';
    fit();
    suggest.close();
    mention.close();
    // 바깥 AI 를 골랐으면 그쪽에 한 번 묻는다(슬래시 명령은 그대로 rauha 가 처리)
    if (target !== 'team' && !typed.trimStart().startsWith('/')) {
      if (draft.list().length > 0) flash('Images go to the Claude team only. They stay attached for your next team task.');
      input.focus();
      await askOther(target, typed.trim());
      return;
    }
    const text = actions.intercept === undefined ? typed : await actions.intercept(typed);
    if (text === null) {
      input.focus();
      return;
    }
    // 붙인 이미지는 이 일에만 딸려 간다. 보내는 순간 칩을 비우고, 일을 못 받으면 되돌린다.
    const sent = draft;
    draft = draft.cleared();
    paintAttach();
    const job = await handIn(text, sent.toUploads());
    if (job === null) {
      if (draft.list().length === 0) {
        draft = sent;
        paintAttach();
      }
      // 작업 폴더를 고르고 허락하기 전이면 main이 받지 않는다. 쓴 글을 돌려주고 이유를 알린다(아무 말 없이 사라지지 않게).
      if (input.value.trim() === '') {
        input.value = text;
        fit();
      }
      flash('Pick and allow a work folder first (Settings > Work folder). Your draft is kept.');
    }
    input.focus();
  };
  /** 입력 글을 팀에 넘기고 카드를 단다. main이 받지 않으면(폴더 허락 전) null. */
  // ── 한도 풀리면 다시 맡기기: 작업 id → 다시 맡길 시각. main 이 예약이 바뀔 때마다 알려 준다 ──
  let retries: Readonly<Record<string, string>> = {};
  /** 내가 취소한 예약(빠졌을 때 "다시 맡겼어요"로 보이지 않게) */
  const cancelling = new Set<string>();
  const paintRetry = (b: HTMLButtonElement, id: string, before: Readonly<Record<string, string>>): void => {
    const at = retries[id];
    if (at === undefined && before[id] !== undefined && !cancelling.has(id)) {
      b.textContent = 'Sent again after the limit reset ✓';
      b.disabled = true;
      return;
    }
    cancelling.delete(id);
    b.textContent = at === undefined ? 'Retry when the limit resets' : `Retrying at ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Cancel`;
    b.title = at === undefined ? 'rauha sends the same request again once the limit resets (while rauha is running)' : 'Cancel the scheduled retry';
  };
  const takeRetries = (next: Readonly<Record<string, string>>): void => {
    const before = retries;
    retries = next;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.retry-later')) paintRetry(b, b.dataset['job'] ?? '', before);
  };
  if (actions.limitRetry !== undefined) {
    actions.limitRetry.on(takeRetries);
    void actions.limitRetry.now().then(takeRetries).catch(() => undefined);
  }
  const retryLaterButton = (id: string): HTMLButtonElement => {
    const b = el('button', 'btn sm ghost retry-later');
    b.dataset['job'] = id;
    paintRetry(b, id, {});
    b.addEventListener('click', () => {
      const api = actions.limitRetry;
      if (b.disabled || api === undefined) return;
      b.disabled = true;
      const done = () => (b.disabled = false);
      if (retries[id] !== undefined) {
        cancelling.add(id);
        void api.cancel(id).finally(done);
      } else
        void api
          .schedule(id)
          .then((r) => {
            if (!r.ok) b.textContent = r.error;
          })
          .finally(done);
    });
    return b;
  };
  const handIn = async (text: string, images?: readonly Uint8Array[]): Promise<JobView | null> => {
    const job = await actions.submit(text, images);
    if (job !== null) {
      jobs.set(job.id, job);
      addJob(job);
    }
    return job;
  };
  /** 입력칸 높이: 내용만큼 늘고 최대에서 멈춘다. 높이는 CSSOM으로만 바꾼다(style 속성 문자열을 쓰지 않는다). */
  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${composerHeight(input.scrollHeight)}px`;
  };
  // ── 이미지 붙이기(붙여넣기·끌어다 놓기): png·jpg·webp, 3장, 장당 5MB. 내용(첫 바이트)으로 다시 검사한다. ──
  let draft = ImageDraft.empty();
  function paintAttach(): void {
    attachBar.replaceChildren();
    for (const item of draft.list()) {
      const chip = el('span', 'attach-item');
      const thumb = el('img', 'attach-thumb');
      thumb.alt = '';
      thumb.src = thumbs.get(item.id) ?? '';
      const remove = el('button', 'btn ghost icon sm', '×');
      remove.type = 'button';
      remove.title = 'Remove image';
      remove.setAttribute('aria-label', 'Remove image');
      remove.addEventListener('click', () => {
        draft = draft.remove(item.id);
        thumbs.delete(item.id);
        paintAttach();
        input.focus();
      });
      chip.append(thumb, el('span', 'attach-name', item.label), remove);
      attachBar.appendChild(chip);
    }
    attachBar.hidden = draft.list().length === 0;
  }
  /** 미리보기 그림(data: URL). 내용 검사를 통과한 바이트에서 우리가 정한 형식으로만 만든다. */
  const thumbs = new Map<string, string>();
  const dataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  async function addFiles(files: readonly File[]): Promise<void> {
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        flash('Each image must be 5MB or smaller.');
        continue;
      }
      const made = ImageAttachment.fromBytes(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!made.ok) {
        flash(made.reason === 'too-big' ? 'Each image must be 5MB or smaller.' : 'Only PNG, JPG and WEBP images can be attached.');
        continue;
      }
      const added = draft.add(made.image);
      if (!added.ok) {
        flash(`You can attach up to ${MAX_IMAGES} images.`);
        break;
      }
      draft = added.draft;
      const id = draft.list()[draft.list().length - 1]!.id;
      thumbs.set(id, await dataUrl(new Blob([made.image.bytes as BlobPart], { type: made.image.mime })));
      paintAttach();
    }
  }
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    // 글과 함께 온 붙여넣기는 글로 둔다. 파일만 온 경우(스크린샷 등)에만 이미지로 받는다.
    if (files.length === 0 || (e.clipboardData?.getData('text/plain') ?? '') !== '') return;
    e.preventDefault();
    void addFiles(files);
  });
  const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');
  composer.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    composer.classList.add('drop');
  });
  composer.addEventListener('dragleave', (e) => {
    if (e.relatedTarget instanceof Node && composer.contains(e.relatedTarget)) return;
    composer.classList.remove('drop');
  });
  composer.addEventListener('drop', (e) => {
    composer.classList.remove('drop');
    if (!hasFiles(e)) return;
    e.preventDefault();
    void addFiles([...(e.dataTransfer?.files ?? [])]);
  });

  const suggest = attachSuggest(input, composer, (t) => actions.suggest?.(t) ?? []);
  const mention = attachMentionSuggest(
    input,
    composer,
    {
      files: async () => {
        const r = await window.rauha.code.files();
        return r.ok ? r.paths : [];
      },
      folders: async () => (await window.rauha.listRepos()).map((r) => r.name),
      recent: recentList,
    },
    fit,
  );
  input.addEventListener('input', () => {
    suggest.update();
    mention.update();
    fit();
  });
  input.addEventListener('keydown', (e) => {
    if (suggest.key(e) || mention.key(e)) {
      e.preventDefault();
      return;
    }
    if (isEnterKey(e) && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });

  function castCanvases(cast: readonly CharacterRole[], scale: number): HTMLElement {
    const wrap = el('span', 'cast');
    for (const role of cast) {
      const c = el('canvas', 'sp');
      paintOnce(c, role, scale);
      wrap.appendChild(c);
    }
    return wrap;
  }

  function addJob(job: JobView): void {
    // 태스크 안에서 이어 물은 것도 Main 에 올린다(인용 "↩ In team · …" 으로 어느 팀 대화인지 보인다)
    if (cards.has(job.id) || cleared.has(job.id)) return;
    empty.remove();
    const me = el('div', 'm me');
    me.appendChild(el('div', 'tx', job.request));
    const reply = el('div', 'm');
    const av = el('div', 'av');
    const face = el('canvas', 'sp');
    paintOnce(face, 'intake', 2);
    av.appendChild(face);
    const body = el('div');
    const tx = el('div', 'tx', '팀에 넘겼어요.');
    const hand = el('div', 'hand');
    const dot = el('span', 'dot');
    const line = el('span', 'handline', short(job.request, 40));
    const state = el('span', 'state');
    const go = el('button', 'link go', 'View progress →');
    go.addEventListener('click', () => open(job.id));
    const stop = el('button', 'btn sm danger', 'Stop');
    // 태스크 안에서 이어 물은 차례가 돌고 있으면 그것을 멈춘다
    stop.addEventListener('click', () => actions.stop((latestInTask(job.id) ?? job).id));
    hand.append(dot, line, state, go);
    if (actions.saveTodo !== undefined) {
      const keep = el('button', 'link keep', 'Save to Todo');
      keep.title = 'Save this task in the Todo tab';
      keep.addEventListener('click', () => {
        keep.disabled = true;
        void actions.saveTodo!(job.request).then((res) => {
          keep.textContent = res.ok ? 'Saved ✓' : 'Could not save';
          keep.title = res.ok ? 'You can see it in the Todo tab' : res.error;
          keep.disabled = res.ok;
        });
      });
      hand.append(keep);
    }
    if (actions.followUp !== undefined) {
      // 답장: 이 작업에 이어서 묻기(같은 레포, 앞 요청·결과를 맥락으로)
      const re = el('button', 'link reply', '↩ Reply');
      re.title = 'Continue this task: your next message builds on its request and result';
      re.addEventListener('click', () => setReply(job));
      hand.append(re);
    }
    hand.append(stop);
    tx.appendChild(hand);
    meById.set(job.id, me);
    quoteOn(job.id);
    // 팀원끼리 주고받는 말: 팀 화면을 열지 않아도 Main 에서 결과가 나오기 전까지 실시간으로 따라간다
    const talk = el('div', 'team-chat main-talk');
    talk.hidden = true;
    body.append(el('div', 'who lead-name', leadName()), tx, talk);
    reply.append(av, body);
    msgs.append(me, reply);
    cards.set(job.id, { dot, state, stop, line, talk, talkSeen: '' });
    toBottom();
  }

  /** 진행 글 → 팀원 얼굴·이름·말풍선 줄(성격은 말투로만, shared/team-voice.ts). 직책 대신 지금 컨셉의 캐릭터 이름으로 부른다 */
  function talkOf(t: JobView, max: number): { readonly role: string; readonly who: string; readonly text: string }[] {
    const titleOf = new Map(t.notes.filter((n) => n.role !== null).map((n) => [n.role as string, n.roleName ?? '']));
    return teamChat(t.notes.map((n) => (n.role !== null && isRole(n.role) ? { ...n, roleName: nameOf(n.role) } : n)), max, { set: characterSetId(), seed: seedOf(rootIdOf(t.id)) }).map((l) => ({ ...l, who: `${l.who}${titleOf.get(l.role) ? ` · ${titleOf.get(l.role)}` : ''}` }));
  }

  function paintTalk(box: HTMLElement, lines: readonly { readonly role: string; readonly who: string; readonly text: string }[]): void {
    for (const line of lines) {
      const row = el('div', 'tc-line');
      const face = el('canvas', 'sp tc-face');
      paintOnce(face, (isRole(line.role) ? line.role : 'intake') as CharacterRole, 2);
      const say = el('div', 'tc-say');
      say.append(el('div', 'tc-who', line.who), el('div', 'tc-bubble', line.text));
      row.append(face, say);
      box.appendChild(row);
    }
  }

  function updateCard(job: JobView): void {
    // 태스크 안 차례가 바뀌면 그 차례의 카드와 함께 그 태스크의 처음 카드도 고친다
    if (job.inTask && job.thread !== null) {
      const first = jobs.get(job.thread);
      if (first !== undefined) updateCard(first);
    }
    const card = cards.get(job.id);
    if (card === undefined) return;
    // 처음 태스크 카드는 태스크 안에서 이어 물은 마지막 차례의 상태를 보인다
    const now = job.thread === null ? (latestInTask(job.id) ?? job) : job;
    const turns = job.thread === null ? threadJobs(job.id).filter((j) => j.id === job.id || j.inTask).length : 1;
    card.dot.className = `dot ${now.status}`;
    card.state.textContent = `· ${STATUS_LABEL[now.status]}${now.stopReason !== null ? ` (${stopReasonText(now.stopReason)})` : ''}${turns > 1 ? ` · ${turns} turns in this task` : ''}`;
    card.stop.hidden = now.status === 'done' || now.status === 'stopped';
    // 팀 대화는 진행 글이 늘었을 때만 다시 그린다(보드가 자주 갱신돼도 캔버스를 매번 새로 칠하지 않게)
    const seen = `${now.id}:${now.notes.length}`;
    if (card.talkSeen !== seen) {
      card.talkSeen = seen;
      const lines = talkOf(now, MAIN_TALK_MAX);
      const follow = scroll.pinned;
      card.talk.replaceChildren();
      paintTalk(card.talk, lines);
      card.talk.hidden = lines.length === 0;
      if (follow) toBottom();
    }
  }

  /** 끝난 일의 결과는 메인(팀장)이 한 번 말해 준다. 태스크 안에서 이어 물은 것의 결과도 Main 에 올린다 */
  function report(job: JobView): void {
    if (reported.has(job.id)) return lateSessionLine(job);
    if (job.status !== 'done' && job.status !== 'stopped') return;
    reported.add(job.id);
    const m = el('div', 'm');
    const av = el('div', 'av');
    const face = el('canvas', 'sp');
    paintOnce(face, 'intake', 2, job.status === 'done' ? 'done' : 'stuck');
    av.appendChild(face);
    const body = el('div');
    const text = job.result ?? (job.status === 'done' ? '끝났어요.' : `멈췄어요: ${stopReasonText(job.stopReason)}`);
    const card = answerCard(text);
    // 로그인이 필요해서 멈춘 일: 터미널로 보내지 않고 이 카드에서 바로 로그인한다
    if (job.status === 'stopped' && needsLogin(`${text} ${job.stopReason ?? ''}`)) card.appendChild(loginCard());
    // 지식 없이 먼저 답한 깊은 답: 그 답 카드 안에 작게 알린다(알림·로그가 아니다)
    if (job.knowledgeMissing) card.appendChild(el('div', 'kn', 'Repo info is not read yet. It is loading in the background, so later questions will be more accurate.'));
    // 팀원이 찾아본 도구(Grep·Read 횟수): 폴더를 제대로 훑었는지 보이게 작게 한 줄. 쓴 도구가 없으면 줄이 없다.
    if (job.toolsLine !== null) card.appendChild(el('div', 'kn', `Looked up: ${job.toolsLine}`));
    // 이 일이 세션 한도를 얼마나 썼는지(시작·끝 사용률 차이). 끝난 뒤 한도를 다시 읽어야 알아서 보통 조금 늦게 온다.
    const session = el('div', 'kn', job.sessionLine ?? '');
    session.hidden = job.sessionLine === undefined;
    sessionLines.set(job.id, session);
    card.appendChild(session);
    // 코드를 고친 일이면 무엇이 바뀌었는지 보고 되돌릴 수 있다(바뀐 게 없으면 숨는다)
    card.appendChild(changesPanel(job.id, 'card'));
    // 멈춘 일은 같은 요청을 그대로 다시 맡길 수 있다(로그인 때문이면 로그인한 뒤 누른다)
    if (job.status === 'stopped') {
      const again = el('button', 'btn sm retry', 'Retry');
      again.addEventListener('click', () => {
        if (again.disabled) return;
        again.disabled = true;
        void handIn(job.request).then((next) => {
          again.textContent = next === null ? 'Allow a work folder first' : 'Sent again ✓';
          again.disabled = next !== null;
        });
      });
      // 한도에 걸려 멈춘 일은 한도가 풀리면 다시 맡기기를 옆에 둔다
      if (actions.limitRetry !== undefined && isLimitStop(job.stopReason)) {
        const row = el('div', 'retry-row');
        row.append(again, retryLaterButton(job.id));
        card.appendChild(row);
      } else card.appendChild(again);
    }
    // 가볍게 답한 질문만 더 깊게 다시 답할 수 있다
    if (job.canGoDeeper) {
      const deeper = el('button', 'btn sm deeper', 'Go deeper');
      deeper.addEventListener('click', () => {
        deeper.disabled = true;
        void actions.deeper(job.id);
      });
      card.appendChild(deeper);
    }
    body.append(el('div', 'who', replyWho(leadName(), job.request)), card);
    m.append(av, body);
    msgs.appendChild(m);
    toBottom();
  }

  // ── 팀 방 ──
  function buildRoom(job: JobView): RoomEl {
    const room = el('div', 'pane room');
    room.addEventListener('click', () => open(job.id));
    const rh = el('div', 'ph');
    const dot = el('span', 'dot');
    const title = el('b');
    const time = el('span', 'time');
    rh.append(dot, title, time);
    const stageBox = el('div', 'stage');
    const canvas = el('canvas', 'sp');
    stageBox.appendChild(canvas);
    const bubble = el('span', 'bub t');
    stageBox.appendChild(bubble);
    const steps = el('div', 'steps');
    const stepLabels = el('div', 'stepl');
    const log = el('div', 'log');
    const follow = el('div', 'room-follow');
    follow.hidden = true;
    room.append(rh, follow, stageBox, steps, stepLabels, log);
    let current = job;
    mountStage(canvas, {
      scale: 3,
      rows: 20,
      fit: true,
      actors: () => current.cast.filter(isRole).map((role) => ({ role, state: characterStateOf(current) })),
      // 컨셉 배경과 소품 사이를 오가는 팀원(카페: 커피머신 ↔ 설거지대, 왕국: 왕좌·훈련장 …)
      scene: characterSetId,
      // 작업마다 낮·저녁·밤이 달라 매번 같은 무대가 아니다(같은 작업이면 그대로)
      variant: () => seedOf(rootIdOf(current.id)) % 3,
    });
    return {
      root: room,
      update(next, pend, turns) {
        current = next;
        dot.className = `dot ${next.status}`;
        // 제목은 처음 태스크, 이어서 물었으면 그 말을 아래 줄에(Main 에 안 보여도 여기서 따라간다)
        const first = jobs.get(rootIdOf(next.id)) ?? next;
        title.textContent = short(first.request, 28);
        follow.hidden = turns < 2;
        follow.textContent = turns < 2 ? '' : `↩ ${short(next.request, 60)} · turn ${turns}`;
        const mineAsks = pend.filter((p) => p.jobId === next.id);
        const need = mineAsks.length > 0;
        time.textContent = need ? needLabel(mineAsks) : next.status === 'queued' ? 'Queued' : elapsedText(next.queuedAt, next.endedAt, Date.now());
        time.className = need ? 'time chip yellow' : 'time';
        bubble.textContent = next.status === 'done' || next.status === 'stopped' ? stageBubble(characterSetId(), next.status, seedOf(next.id)) : (next.lastLine !== null ? short(next.lastLine, 18) : '시작하는 중');
        bubble.classList.toggle('t', next.status === 'running');
        steps.replaceChildren(...next.steps.map((s) => el('i', s.state === 'done' ? 'd' : 'n')));
        stepLabels.replaceChildren(...next.steps.map((s) => el('span', undefined, s.label)));
        log.textContent = roomLogLine(next.status, next.lastLine);
      },
    };
  }

  /** 끝난 방은 잠시 보였다가 사라진다. 열어 둔 방은 남긴다. */
  const roomVisible = (job: JobView, key: string): boolean => {
    if (job.status === 'queued') return false;
    if (key === openId) return true;
    if (job.endedAt === null) return true;
    return Date.now() - Date.parse(job.endedAt) < ROOM_LINGER_MS;
  };

  /** 기다리는 팀 칸(일이 들어오면 위 칸부터 태스크 팀으로 바뀐다) */
  const idleEls = new Map<number, HTMLElement>();
  function idleRoom(n: number): HTMLElement {
    let box = idleEls.get(n);
    if (box !== undefined) return box;
    box = el('div', 'pane room idle');
    const rh = el('div', 'ph');
    rh.append(el('span', 'dot idle'), el('b', undefined, `Team ${n}`), el('span', 'time', 'Ready'));
    const face = el('canvas', 'sp');
    paintOnce(face, 'intake', 2, 'idle');
    const body = el('div', 'idle-body');
    body.append(face, el('span', undefined, 'Waiting for work'));
    box.append(rh, body);
    idleEls.set(n, box);
    return box;
  }

  function renderRooms(): void {
    // 팀 목록: 새 일은 그때 쉬는 팀 중 맨 위 팀이 맡는다. 끝난 팀은 다음 일이 올 때까지 마지막 일을 보이며 자리를 지킨다.
    // 이어서 물은 차례가 돌면 같은 방에서 같은 팀이 다시 움직인다
    const roots = [...jobs.values()].filter((j) => j.thread === null && !cleared.has(j.id));
    // 팀은 일꾼: 새 일은 그때 쉬는 팀 중 맨 위 팀이 맡는다(shared/team-board.ts)
    const slots = teamBoard(
      roots.map((j) => {
        const turns = threadJobs(j.id);
        const last = turns.at(-1) ?? j;
        const live = turns.some((t) => t.status !== 'done' && t.status !== 'stopped');
        return { id: j.id, queuedAt: j.queuedAt, thread: null, live, endedAt: live ? null : last.endedAt, activeAt: last.queuedAt };
      }),
      boardSince,
    );
    const taskIds = new Set(slots.flatMap((s) => (s.kind === 'task' ? [s.id] : [])));
    for (const [id, r] of [...roomEls]) {
      if (!taskIds.has(id)) {
        r.root.remove();
        roomEls.delete(id);
      }
    }
    const order: HTMLElement[] = [];
    for (const s of slots) {
      if (s.kind === 'idle') {
        order.push(idleRoom(s.n));
        continue;
      }
      const job = threadJobs(s.id).at(-1) ?? jobs.get(s.id)!;
      let r = roomEls.get(s.id);
      if (r === undefined) {
        r = buildRoom(job);
        roomEls.set(s.id, r);
      }
      r.update(job, approvals, threadJobs(s.id).length);
      r.root.classList.toggle('on', s.id === openId);
      order.push(r.root);
    }
    // 순서가 바뀐 칸만 옮긴다(그대로면 DOM 을 건드리지 않는다)
    order.forEach((node, i) => {
      if (rooms.children[i] !== node) rooms.insertBefore(node, rooms.children[i] ?? null);
    });
    while (rooms.children.length > order.length) rooms.lastElementChild?.remove();
    rooms.classList.remove('none');
    renderAgents();
    // 아주 좁을 때 띠에는 도는 일과 방금 끝난 일만
    renderStrip(slots.flatMap((s) => (s.kind === 'task' ? [threadJobs(s.id).at(-1) ?? jobs.get(s.id)!] : [])).filter((j) => roomVisible(j, rootIdOf(j.id))));
  }

  /**
   * 에이전트 창의 왼쪽 목록: 맨 위 "+ New agent"와 Main, 그 아래 태스크(처음 요청 기준)를 최근 것부터.
   * 줄마다 상태 점·제목·지금 단계(또는 내 확인이 필요함)·걸린 시간. 다시 그릴 때 같은 줄 요소를 고쳐 쓴다(깜빡임 없게).
   */
  const agentRows = new Map<string, { row: HTMLButtonElement; dot: HTMLElement; title: HTMLElement; sub: HTMLElement; badge: HTMLElement }>();
  const agentHead = el('div', 'ag-head');
  const newAgent = el('button', 'btn sm ag-new', '+ New agent');
  newAgent.title = 'Start a new task in Main';
  newAgent.addEventListener('click', () => {
    if (openId !== null) close();
    renderAgents();
    input.focus();
  });
  agentHead.append(el('b', undefined, 'Agents'), newAgent);
  const mainRow = el('button', 'ag-row ag-main');
  const mainFace = el('canvas', 'sp');
  paintOnce(mainFace, 'intake', 1);
  mainRow.append(mainFace, el('span', 'ag-title', 'Main'), el('span', 'ag-sub', 'Talk to the lead'));
  mainRow.addEventListener('click', () => {
    if (openId !== null) close();
    renderAgents();
    input.focus();
  });
  const agentList = el('div', 'ag-list');
  agents.append(agentHead, mainRow, agentList);

  function renderAgents(): void {
    mainRow.classList.toggle('on', openId === null);
    const roots = [...jobs.values()].filter((j) => j.thread === null && !cleared.has(j.id)).sort((a, b) => (latestInTask(b.id)?.queuedAt ?? b.queuedAt).localeCompare(latestInTask(a.id)?.queuedAt ?? a.queuedAt));
    const keep = new Set(roots.map((j) => j.id));
    for (const [id, r] of [...agentRows]) {
      if (!keep.has(id)) {
        r.row.remove();
        agentRows.delete(id);
      }
    }
    roots.forEach((first, i) => {
      const last = latestInTask(first.id) ?? first;
      let r = agentRows.get(first.id);
      if (r === undefined) {
        const row = el('button', 'ag-row');
        const dot = el('span', 'dot');
        const title = el('span', 'ag-title');
        const sub = el('span', 'ag-sub');
        const badge = el('span', 'ag-badge');
        row.append(dot, title, badge, sub);
        row.addEventListener('click', () => open(first.id));
        r = { row, dot, title, sub, badge };
        agentRows.set(first.id, r);
      }
      const mine = approvals.filter((a) => threadJobs(first.id).some((t) => t.id === a.jobId));
      r.dot.className = `dot ${last.status}`;
      r.title.textContent = short(first.request, 48);
      r.row.title = first.request;
      r.badge.textContent = mine.length > 0 ? '!' : '';
      r.badge.hidden = mine.length === 0;
      const step = last.steps.find((s) => s.state !== 'done')?.label ?? last.steps.at(-1)?.label ?? STATUS_LABEL[last.status];
      const when = last.status === 'queued' ? 'Queued' : elapsedText(last.queuedAt, last.endedAt, Date.now());
      r.sub.textContent = mine.length > 0 ? needLabel(mine) : last.status === 'queued' ? 'Queued' : last.status === 'running' ? `${step} · ${when}` : `${STATUS_LABEL[last.status]} · ${when}`;
      r.row.classList.toggle('on', openId === first.id);
      r.row.classList.toggle('need', mine.length > 0);
      if (agentList.children[i] !== r.row) agentList.insertBefore(r.row, agentList.children[i] ?? null);
    });
    while (agentList.children.length > roots.length) agentList.lastElementChild?.remove();
  }

  function renderStrip(visible: readonly JobView[]): void {
    strip.replaceChildren();
    for (const job of visible) {
      const chip = el('button', 'chip stripchip');
      const dot = el('span', `dot ${job.status}`);
      const face = el('canvas', 'sp');
      paintOnce(face, (job.cast[0] && isRole(job.cast[0]) ? job.cast[0] : 'intake') as CharacterRole, 1, characterStateOf(job) === 'rest' ? 'idle' : 'idle');
      const label = el('span', undefined, job.steps.at(-1)?.label ?? STATUS_LABEL[job.status]);
      chip.append(dot, face, label);
      chip.addEventListener('click', () => open(job.id));
      strip.appendChild(chip);
    }
    strip.hidden = visible.length === 0;
  }

  // ── 팀 상세 ──
  function open(id: string): void {
    // 이어진 차례를 열어도 그 태스크 대화 전체를 연다
    if (openId !== rootIdOf(id)) detailStick = true;
    openId = rootIdOf(id);
    root.closest('.app')?.setAttribute('data-detail', '1');
    renderDetail();
    renderRooms();
    renderAskTray();
  }
  function close(): void {
    openId = null;
    root.closest('.app')?.setAttribute('data-detail', '0');
    detail.replaceChildren();
    renderRooms();
    renderAskTray();
    if (bottomLater && scroll.pinned) requestAnimationFrame(toBottom);
  }

  const reviews = new Map<string, Promise<ChangeReview | null>>();

  const yesNo = (v: boolean | null, yes: string, no: string) => (v === null ? 'Unknown' : v ? yes : no);
  const deployText = (v: 'yes' | 'no' | 'unknown') => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Unknown');

  /** 코드 허락의 정리: 보호 브랜치별 영향 표, 바뀐 파일, diff. git으로 계산한 값이다. */
  function reviewBox(a: ApprovalView): HTMLElement {
    const box = el('div', 'review', 'Checking changes…');
    let pending = reviews.get(a.id);
    if (pending === undefined) {
      pending = actions.review(a.id).catch(() => null);
      reviews.set(a.id, pending);
    }
    void pending.then((r) => {
      box.replaceChildren();
      if (r === null) {
        box.textContent = 'Cannot show changes: the repo for this request is unknown.';
        return;
      }
      const table = el('table', 'impact');
      const head = el('tr');
      for (const h of ['Branch', 'Ahead', 'Behind', 'Conflicts', 'Auto-deploy']) head.appendChild(el('th', undefined, h));
      table.appendChild(head);
      for (const i of r.impacts) {
        const row = el('tr');
        const cells = i.exists
          ? [i.branch, i.ahead === null ? 'Unknown' : `${i.ahead}`, i.behind === null ? 'Unknown' : `${i.behind}`, yesNo(i.conflicts, 'Conflict', 'None'), deployText(i.autoDeploy)]
          : [i.branch, 'No branch', '', '', deployText(i.autoDeploy)];
        cells.forEach((c, n) => row.appendChild(el('td', n === 3 && c === 'Conflict' ? 'bad' : undefined, c)));
        table.appendChild(row);
      }
      box.appendChild(el('div', 'sub', `Current branch: ${r.branch ?? '(detached HEAD)'}`));
      box.appendChild(table);
      if (r.files.length === 0) {
        box.appendChild(el('div', 'sub', 'No changed files.'));
        return;
      }
      const files = el('ul', 'files');
      for (const f of r.files) files.appendChild(el('li', undefined, `${f.path}  ${f.additions === null ? '' : `+${f.additions} -${f.deletions}`}`));
      box.appendChild(files);
      const diff = el('details');
      diff.appendChild(el('summary', undefined, `Show diff${r.truncated ? ' (first part only)' : ''}`));
      const pre = el('pre', 'diff');
      for (const line of r.diff.split('\n')) pre.appendChild(el('div', `dl ${classifyDiffLine(line)}`, line === '' ? ' ' : line));
      diff.appendChild(pre);
      box.appendChild(diff);
    });
    return box;
  }

  /** 인프라 허락의 위험도 표. 명령에서 읽을 수 있는 것만 채우고 나머지는 모른다고 쓴다(추측하지 않는다). */
  function riskTable(s: ApprovalSummary, risk: InfraRisk | null): HTMLElement {
    const rows: [string, string][] = [
      ['Environment', s.environment ?? 'Unknown'],
      ['Account · Region', [s.profile, s.region].filter((x) => x !== null).join(' · ') || 'Unknown'],
      ['Scope', risk?.scope ?? 'Unknown'],
      ['Downtime', risk?.downtime === 'none' ? 'None' : risk?.downtime === 'brief' ? 'Brief' : risk?.downtime === 'long' ? 'Long' : 'Unknown'],
      ['Cost direction', risk?.cost === 'up' ? 'Up' : risk?.cost === 'down' ? 'Down' : risk?.cost === 'same' ? 'Same' : 'Unknown'],
      ['Time to roll back', risk?.rollback ?? 'Unknown'],
      ['Applied to qa first', risk?.qaFirst === true ? 'Yes' : risk?.qaFirst === false ? 'No' : 'Unknown'],
    ];
    const table = el('table', 'impact risk');
    for (const [k, val] of rows) {
      const tr = el('tr');
      tr.append(el('th', undefined, k), el('td', val === 'Unknown' ? 'dim' : undefined, val));
      table.appendChild(tr);
    }
    return table;
  }

  /** 입력칸 위 대기 카드: 상세에 이미 보이는 작업의 카드는 겹쳐 그리지 않는다. */
  function renderAskTray(): void {
    const shown = approvals.filter((a) => a.jobId !== openId);
    askTray.replaceChildren();
    askTray.hidden = shown.length === 0;
    for (const a of shown) {
      const job = jobs.get(a.jobId);
      const box = el('div', 'ask-item');
      if (job !== undefined) box.appendChild(el('div', 'sub', `Needs your answer · ${short(job.request, 60)}`));
      box.appendChild(approvalCard(a));
      askTray.appendChild(box);
    }
  }

  function approvalCard(a: ApprovalView): HTMLElement {
    if (a.ask !== null) return askCard(a, actions.answer);
    const card = el('div', `approval ${a.summary.kind}`);
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Permission request');
    card.appendChild(el('div', 'ah', `Permission needed · ${a.summary.headline}`));
    card.appendChild(el('div', 'who', `Requested by: ${a.roleName}`));
    if (a.summary.risks.length > 0) {
      const ul = el('ul');
      for (const r of a.summary.risks) ul.appendChild(el('li', undefined, r));
      card.appendChild(ul);
    }
    const facts = el('div', 'facts');
    if (a.summary.kind === 'code') {
      facts.append(
        el('span', 'chip', a.summary.protectedBranch !== null ? `Protected branch: ${a.summary.protectedBranch}` : 'Not a protected branch'),
        el('span', 'chip', a.summary.forcePush ? 'Force push' : 'Normal push'),
      );
    } else if (a.summary.kind === 'infra') {
      facts.append(el('span', 'chip', `Environment: ${a.summary.environment ?? 'Unknown'}`), el('span', 'chip', 'Cost: direction only (unknown)'));
    }
    if (facts.childElementCount > 0) card.appendChild(facts);
    if (a.summary.kind === 'code') card.appendChild(reviewBox(a));
    if (a.summary.kind === 'infra') card.appendChild(riskTable(a.summary, a.risk));
    const raw = el('details');
    raw.append(el('summary', undefined, 'Raw command'), el('pre', undefined, `${a.tool}: ${a.detail}`));
    card.appendChild(raw);
    const note = el('input', 'note');
    note.placeholder = 'Revise: describe what to change';
    const row = el('div', 'btns');
    const btn = (label: string, cls: string, choice: () => ApprovalChoice) => {
      const b = el('button', cls === '' ? 'btn' : `btn ${cls}`, label);
      b.addEventListener('click', () => {
        if (b.disabled) return;
        for (const other of row.querySelectorAll('button')) other.disabled = true; // 이중 처리 방지
        actions.answer(a.id, choice());
      });
      return b;
    };
    row.append(
      btn('Allow once', 'primary', () => ({ kind: 'once' })),
      btn('Allow for this job', '', () => ({ kind: 'job' })),
      btn('Revise', '', () => ({ kind: 'revise', note: note.value })),
      btn('Deny', 'danger', () => ({ kind: 'deny' })),
    );
    // 어떻게 바꿀지 적기 전에는 '다르게 해 줘'를 누를 수 없다
    const revise = row.children[2] as HTMLButtonElement;
    revise.disabled = !canRevise(note.value);
    revise.title = 'Describe the change in the box above';
    note.addEventListener('input', () => (revise.disabled = !canRevise(note.value)));
    card.append(note, row);
    return card;
  }

  /** 태스크 화면 맨 아래 입력칸: 이 태스크의 같은 팀에 이어서 시킨다(Main 에 새 카드 없이 이 대화 아래로 쌓인다) */
  function followBox(rootId: string, last: JobView): HTMLElement {
    const box = el('div', 'follow dfoot');
    const ask = el('textarea', 'follow-input');
    ask.rows = 2;
    // 상세는 진행될 때마다 다시 그려진다: 쓰던 글과 커서 자리를 태스크마다 기억한다
    ask.value = followDrafts.get(rootId) ?? '';
    ask.addEventListener('input', () => followDrafts.set(rootId, ask.value));
    if (followFocus === rootId)
      queueMicrotask(() => {
        ask.focus();
        ask.setSelectionRange(ask.value.length, ask.value.length);
      });
    ask.addEventListener('focus', () => (followFocus = rootId));
    ask.addEventListener('blur', () => {
      if (ask.isConnected) followFocus = null;
    });
    // 차례가 도는 동안 다음 차례를 보내면 같은 레포에서 둘이 겹친다 → 끝난 뒤(또는 멈춘 뒤) 보낸다. 글은 미리 써 둘 수 있다
    const busy = last.status !== 'done' && last.status !== 'stopped';
    ask.placeholder = 'Ask this team to continue…';
    const go = el('button', 'btn primary', 'Continue with this team');
    go.disabled = busy;
    go.addEventListener('click', async () => {
      const text = ask.value.trim();
      if (text === '' || go.disabled) return;
      go.disabled = true;
      const ok = await sendFollowUp(last, text, true);
      if (ok) {
        ask.value = '';
        followDrafts.delete(rootId);
        followFocus = rootId;
        detailStick = true;
        renderDetail();
      } else {
        go.disabled = false;
        flash('Could not continue that task. Pick and allow a work folder first, or try again.');
      }
    });
    // Main 입력칸과 같은 키: Enter 보내기, Shift+Enter 줄바꿈(Ctrl/⌘+Enter 도 보내기로 둔다)
    ask.addEventListener('keydown', (e) => {
      if (!isEnterKey(e) || e.shiftKey) return;
      e.preventDefault();
      go.click();
    });
    const row = el('div', 'btns');
    row.append(el('span', 'hint grow', busy ? 'The team is still on the last turn. You can type now and send when it finishes (or Stop it).' : 'Enter to send · Shift+Enter for a new line. Same team, same conversation.'), go);
    box.append(ask, row);
    return box;
  }

  /** 태스크 대화의 한 차례: 내 말 → 팀 대화 → (도는 중이면 작업 중 표시) → 팀장의 결과. Main 처럼 위에서 아래로 */
  function turnBlock(t: JobView, body: HTMLElement): void {
    const me = el('div', 'm me');
    me.appendChild(el('div', 'tx', t.request));
    body.appendChild(me);
    for (const a of approvals.filter((x) => x.jobId === t.id)) body.appendChild(approvalCard(a));
    // 팀 대화: 실제 진행 글을 팀원 얼굴·이름·말풍선으로(태스크 화면은 처음부터 끝까지 다)
    const talk = talkOf(t, TASK_TALK_MAX);
    const over = t.status === 'done' || t.status === 'stopped';
    if (talk.length > 0 || !over) {
      const box = el('div', 'team-chat');
      paintTalk(box, talk);
      if (!over) {
        const typing = el('div', 'tc-line tc-typing');
        const what = t.status === 'queued' ? 'Waiting in the queue' : t.status === 'waiting' ? 'Waiting for your permission or choice' : `${t.roleName ?? 'Team'} is working`;
        typing.append(el('span', 'dim', what), el('span', 'tc-dots', '…'));
        box.appendChild(typing);
      }
      body.appendChild(box);
    }
    if (!over) return;
    const m = el('div', 'm');
    const av = el('div', 'av');
    const face = el('canvas', 'sp');
    paintOnce(face, 'intake', 2, t.status === 'done' ? 'done' : 'stuck');
    av.appendChild(face);
    const say = el('div');
    const tx = answerCard(t.result ?? (t.status === 'done' ? 'Done.' : `Stopped: ${stopReasonText(t.stopReason)}`));
    if (t.status === 'stopped' && needsLogin(`${t.result ?? ''} ${t.stopReason ?? ''}`)) tx.appendChild(loginCard());
    tx.appendChild(changesPanel(t.id, 'detail'));
    say.append(el('div', 'who lead-name', leadName()), tx);
    m.append(av, say);
    body.appendChild(m);
  }

  /** 태스크 대화 스크롤: 맨 아래에 있었으면 새 말이 와도 맨 아래(Main 과 같다), 위로 올려 읽는 중이면 그 자리 */
  let detailStick = true;
  let detailTop = 0;

  function renderDetail(): void {
    detail.replaceChildren();
    const first = openId === null ? undefined : jobs.get(openId);
    if (first === undefined) return;
    const turns = threadJobs(first.id);
    const last = turns.at(-1) ?? first;

    const main = el('div', 'pane');
    const ph = el('div', 'ph');
    const castAll: CharacterRole[] = [];
    for (const t of turns) for (const r of t.cast) if (isRole(r) && !castAll.includes(r)) castAll.push(r);
    const cast = castCanvases(castAll.length > 1 ? castAll.filter((r) => r !== 'intake').slice(-4) : castAll, 2);
    const back = el('button', 'btn', '← Main');
    back.addEventListener('click', close);
    const stop = el('button', 'btn danger', 'Stop');
    stop.hidden = last.status === 'done' || last.status === 'stopped';
    stop.addEventListener('click', () => actions.stop(last.id));
    const actionsBox = el('span', 'right');
    actionsBox.append(back, stop);
    ph.append(el('span', `dot ${last.status}`), cast, el('b', undefined, short(first.request, 40)), actionsBox);

    const tabs = el('div', 'tabs dtabs');
    for (const [id, label] of [['summary', 'Conversation'], ['log', 'Raw log']] as const) {
      const b = el('button', detailTab === id ? 'tab sm on' : 'tab sm', label);
      b.addEventListener('click', () => {
        detailTab = id;
        detailStick = true;
        renderDetail();
      });
      tabs.appendChild(b);
    }

    const body = el('div', 'dbody');
    if (detailTab === 'log') {
      body.classList.add('term');
      for (const t of turns) {
        if (turns.length > 1) body.appendChild(el('div', 'dim', `── ${short(t.request, 60)} ──`));
        for (const n of t.notes) {
          const line = el('div');
          if (n.roleName !== null) line.appendChild(el('span', 'c', `${n.roleName} `));
          line.append(n.message);
          body.appendChild(line);
        }
      }
      if (turns.every((t) => t.notes.length === 0)) body.appendChild(el('div', 'dim', 'No log yet.'));
    } else {
      body.classList.add('dchat');
      for (const t of turns) turnBlock(t, body);
    }
    body.addEventListener('scroll', () => {
      detailTop = body.scrollTop;
      detailStick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    });
    main.append(ph, tabs, body);
    if (detailTab === 'summary' && actions.followUp !== undefined) main.appendChild(followBox(first.id, last));

    const side = el('div', 'dside');
    const tl = el('div', 'pane');
    tl.appendChild(el('div', 'ph', 'Steps'));
    const list = el('div', 'tl');
    if (last.steps.length === 0) list.appendChild(el('div', 'x', 'No steps yet.'));
    for (const s of last.steps) {
      const row = el('div', `s ${s.state === 'done' ? 'd' : 'n'}`);
      row.append(el('span', 'k'), el('div', 't', s.label));
      list.appendChild(row);
    }
    tl.appendChild(list);
    side.appendChild(tl);
    detail.append(main, side);
    body.scrollTop = detailStick ? body.scrollHeight : detailTop;
  }

  // ── 레이아웃 토글(A 나란히 · B 위아래) ──
  function layoutButtons(current: 'A' | 'B' | 'C', pick: (l: 'A' | 'B' | 'C') => void): void {
    layoutToggle.replaceChildren();
    for (const [id, label] of [['C', 'Agents'], ['A', 'Side by side'], ['B', 'Stacked']] as const) {
      const b = el('button', current === id ? 'on' : '', label);
      b.addEventListener('click', () => pick(id));
      layoutToggle.appendChild(b);
    }
  }

  // 1초마다 걸린 시간을 새로 쓰고 지난 방을 치운다(방이 있을 때만).
  setInterval(() => {
    if (roomEls.size > 0 && !document.hidden) renderRooms();
  }, 1000);

  return {
    root,
    layoutButtons,
    /** 다른 탭에서 돌아와 다시 붙었을 때: 떼어지며 0 으로 돌아간 스크롤을 기억한 자리(맨 아래였으면 새 맨 아래)로 되돌린다 */
    onShow(): void {
      msgs.scrollTop = scroll.restoreTop({ client: msgs.clientHeight, height: msgs.scrollHeight });
      syncJump();
    },
    /** 캐릭터 테마가 바뀌었을 때 메인 칸의 얼굴과 이름 안내를 새로 그린다(이미 쌓인 말풍선은 그대로) */
    repaintCharacters(): void {
      paintOnce(headFace, 'intake', 2);
      paintOnce(emptyFace, 'intake', 5);
      leadHint.textContent = leadHintText();
      // 이미 쓴 팀장 이름표도 새 컨셉 이름으로
      for (const n of root.querySelectorAll<HTMLElement>('.lead-name')) n.textContent = leadName();
      // 팀 대화 줄은 컨셉마다 이름·말투가 달라서, 이미 그린 카드도 새 컨셉으로 다시 쓴다
      for (const [id, card] of cards) {
        card.talkSeen = '';
        const job = jobs.get(id);
        if (job !== undefined) updateCard(job);
      }
    },
    /** 명령 결과 같은 안내를 메인 칸에 말풍선으로 보인다 */
    notice(content: string | HTMLElement): void {
      empty.remove();
      const m = el('div', 'm');
      const av = el('div', 'av');
      const face = el('canvas', 'sp');
      paintOnce(face, 'intake', 2);
      av.appendChild(face);
      const tx = el('div', 'tx');
      if (typeof content === 'string') tx.textContent = content;
      else tx.appendChild(content);
      const body = el('div');
      body.append(el('div', 'who lead-name', leadName()), tx);
      m.append(av, body);
      msgs.appendChild(m);
      toBottom();
    },
    /** 채팅 화면을 비운다(돌고 있는 작업과 기록은 그대로) */
    clearScreen: clearVisibleChat,
    /** 앱을 다시 켠 뒤 지난 일을 말풍선으로 되살린다(끝난 일은 결과 카드까지, 돌던 일은 중단됨) */
    restore(past: readonly JobView[]): void {
      for (const job of past) {
        if (jobs.has(job.id)) continue;
        jobs.set(job.id, job);
        addJob(job);
        updateCard(job);
        report(job);
      }
    },
    jobList: (): readonly JobView[] => [...jobs.values()],
    board(view: BoardView): void {
      for (const job of view.jobs) {
        jobs.set(job.id, job);
        addJob(job);
        updateCard(job);
        report(job);
      }
      renderRooms();
      if (openId !== null) renderDetail();
    },
    approvals(list: readonly ApprovalView[]): void {
      approvals = list;
      renderAskTray();
      renderRooms();
      if (openId !== null) renderDetail();
    },
    open,
    focus: () => input.focus(),
    /** 입력칸에 글을 채워 넣는다(보내지는 않는다). 이미 적은 글이 있으면 뒤에 이어 붙인다. */
    fill(text: string): void {
      input.value = input.value.trim() === '' ? text : `${input.value.trimEnd()}
${text}`;
      input.dispatchEvent(new Event('input'));
      input.focus();
    },
    /** 이름 표시용: 역할 이름 */
    roleName: nameOf,
  };
}
