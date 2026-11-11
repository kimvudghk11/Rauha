import type { InfraRisk } from '@rauha/core/jobs';
import type { ApprovalSummary } from '../shared/approval-summary.js';
import { classifyDiffLine, type ChangeReview } from '../shared/branch-impact.js';
import type { ApprovalChoice, ApprovalView, BoardView, JobView } from '../shared/ipc.js';
import { CHARACTER_ROLES, leadName, spriteFor, type CharacterRole } from './characters.js';
import type { Command } from '../shared/command-book.js';
import { attachSuggest } from './command-suggest.js';
import { askCard } from './ask-card.js';
import { needLabel } from '../shared/ask-form.js';
import { el, isEnterKey } from './dom.js';
import { needsLogin } from '../shared/claude-login.js';
import { loginCard } from './login-view.js';
import { roomSplit } from '../shared/room-split.js';
import { characterStateOf, elapsedText } from './room.js';
import { askDialog } from './git-common.js';
import { flash } from './record-parts.js';
import { canRevise, composerHeight, replyWho, roomLogLine, stopReasonText } from '../shared/chat-text.js';
import { RESET_CONFIRM, resetNotice, type ConversationResetResult } from '../shared/conversation-reset.js';
import { mountStage, paintOnce } from './stage.js';

const STATUS_LABEL: Readonly<Record<JobView['status'], string>> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Needs your answer',
  done: 'Done',
  stopped: 'Stopped',
};

/** 끝난 방이 사라지기까지 보여 주는 시간 */
const ROOM_LINGER_MS = 6000;

const isRole = (r: string): r is CharacterRole => (CHARACTER_ROLES as readonly string[]).includes(r);
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const nameOf = (role: CharacterRole) => spriteFor(role).name;

export interface ChatActions {
  readonly submit: (text: string) => Promise<JobView | null>;
  readonly stop: (id: string) => void;
  readonly deeper: (id: string) => Promise<JobView | null>;
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
  readonly update: (job: JobView, approvals: readonly ApprovalView[]) => void;
}

/**
 * 채팅 탭: 메인 칸(팀장 캐릭터) + 팀 방 + 맨 위 띠 + 팀 상세. 배치(나란히·위아래·메인만)는 CSS가 .app의 data-mode로 바꾼다.
 * 화면은 board·approvals를 받아 그리기만 한다. 규칙 판단은 main(core)에 있다.
 */
export function buildChat(actions: ChatActions) {
  const jobs = new Map<string, JobView>();
  let approvals: readonly ApprovalView[] = [];
  let openId: string | null = null;
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
  const composer = el('div', 'composer');
  const input = el('textarea');
  input.placeholder = 'Type a new task…  (@folder to pick a target)';
  input.rows = 1;
  const hint = el('div', 'hint');
  hint.innerHTML = '<span><span class="kbd">Enter</span> Send</span><span class="more"><span class="kbd">Shift+Enter</span> New line</span><span class="more"><span class="kbd">@</span> Pick folder</span>';
  composer.append(input, hint);
  mainPane.append(head, msgs, composer);

  // ── 아주 좁을 때 맨 위 띠 ──
  const strip = el('div', 'strip');
  // ── 팀 방들 ──
  const rooms = el('div', 'rooms');
  // ── 팀 상세 ──
  const detail = el('div', 'detail');

  root.append(mainPane, strip, rooms, detail);

  const cards = new Map<string, { dot: HTMLElement; state: HTMLElement; stop: HTMLButtonElement; line: HTMLElement }>();
  const reported = new Set<string>();
  /** 화면 지우기(/clear)로 비운 끝난 작업. 다시 그리지 않는다. */
  const cleared = new Set<string>();
  const roomEls = new Map<string, RoomEl>();

  // ── 보내기 ──
  const send = async () => {
    const typed = input.value;
    if (typed.trim() === '') return;
    input.value = '';
    fit();
    suggest.close();
    const text = actions.intercept === undefined ? typed : await actions.intercept(typed);
    if (text === null) {
      input.focus();
      return;
    }
    const job = await handIn(text);
    if (job === null) {
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
  const handIn = async (text: string): Promise<JobView | null> => {
    const job = await actions.submit(text);
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
  const suggest = attachSuggest(input, composer, (t) => actions.suggest?.(t) ?? []);
  input.addEventListener('input', () => {
    suggest.update();
    fit();
  });
  input.addEventListener('keydown', (e) => {
    if (suggest.key(e)) {
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
    stop.addEventListener('click', () => actions.stop(job.id));
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
    hand.append(stop);
    tx.appendChild(hand);
    body.append(el('div', 'who', leadName()), tx);
    reply.append(av, body);
    msgs.append(me, reply);
    cards.set(job.id, { dot, state, stop, line });
    msgs.scrollTop = msgs.scrollHeight;
  }

  function updateCard(job: JobView): void {
    const card = cards.get(job.id);
    if (card === undefined) return;
    card.dot.className = `dot ${job.status}`;
    card.state.textContent = `· ${STATUS_LABEL[job.status]}${job.stopReason !== null ? ` (${stopReasonText(job.stopReason)})` : ''}`;
    card.stop.hidden = job.status === 'done' || job.status === 'stopped';
  }

  /** 끝난 일의 결과는 메인(팀장)이 한 번 말해 준다 */
  function report(job: JobView): void {
    if (reported.has(job.id) || (job.status !== 'done' && job.status !== 'stopped')) return;
    reported.add(job.id);
    const m = el('div', 'm');
    const av = el('div', 'av');
    const face = el('canvas', 'sp');
    paintOnce(face, 'intake', 2, job.status === 'done' ? 'done' : 'stuck');
    av.appendChild(face);
    const body = el('div');
    const text = job.result ?? (job.status === 'done' ? '끝났어요.' : `멈췄어요: ${stopReasonText(job.stopReason)}`);
    const card = el('div', 'tx', text);
    // 로그인이 필요해서 멈춘 일: 터미널로 보내지 않고 이 카드에서 바로 로그인한다
    if (job.status === 'stopped' && needsLogin(`${text} ${job.stopReason ?? ''}`)) card.appendChild(loginCard());
    // 지식 없이 먼저 답한 깊은 답: 그 답 카드 안에 작게 알린다(알림·로그가 아니다)
    if (job.knowledgeMissing) card.appendChild(el('div', 'kn', 'Repo info is not read yet. It is loading in the background, so later questions will be more accurate.'));
    // 팀원이 찾아본 도구(Grep·Read 횟수): 폴더를 제대로 훑었는지 보이게 작게 한 줄. 쓴 도구가 없으면 줄이 없다.
    if (job.toolsLine !== null) card.appendChild(el('div', 'kn', `Looked up: ${job.toolsLine}`));
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
      card.appendChild(again);
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
    msgs.scrollTop = msgs.scrollHeight;
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
    room.append(rh, stageBox, steps, stepLabels, log);
    let current = job;
    mountStage(canvas, {
      scale: 3,
      rows: 20,
      fit: true,
      actors: () => current.cast.filter(isRole).map((role) => ({ role, state: characterStateOf(current) })),
    });
    return {
      root: room,
      update(next, pend) {
        current = next;
        dot.className = `dot ${next.status}`;
        title.textContent = short(next.request, 28);
        const mineAsks = pend.filter((p) => p.jobId === next.id);
        const need = mineAsks.length > 0;
        time.textContent = need ? needLabel(mineAsks) : next.status === 'queued' ? 'Queued' : elapsedText(next.queuedAt, next.endedAt, Date.now());
        time.className = need ? 'time chip yellow' : 'time';
        bubble.textContent = next.status === 'done' ? '끝!' : next.status === 'stopped' ? '멈췄어요' : (next.lastLine !== null ? short(next.lastLine, 18) : '시작하는 중');
        bubble.classList.toggle('t', next.status === 'running');
        steps.replaceChildren(...next.steps.map((s) => el('i', s.state === 'done' ? 'd' : 'n')));
        stepLabels.replaceChildren(...next.steps.map((s) => el('span', undefined, s.label)));
        log.textContent = roomLogLine(next.status, next.lastLine);
      },
    };
  }

  /** 끝난 방은 잠시 보였다가 사라진다. 열어 둔 방은 남긴다. */
  const roomVisible = (job: JobView): boolean => {
    if (job.status === 'queued') return false;
    if (job.id === openId) return true;
    if (job.endedAt === null) return true;
    return Date.now() - Date.parse(job.endedAt) < ROOM_LINGER_MS;
  };

  function renderRooms(): void {
    const visible = [...jobs.values()].filter(roomVisible);
    for (const [id, r] of [...roomEls]) {
      if (!visible.some((j) => j.id === id)) {
        r.root.remove();
        roomEls.delete(id);
      }
    }
    for (const job of visible) {
      let r = roomEls.get(job.id);
      if (r === undefined) {
        r = buildRoom(job);
        roomEls.set(job.id, r);
        rooms.appendChild(r.root);
      }
      r.update(job, approvals);
    }
    rooms.classList.toggle('none', visible.length === 0);
    root.dataset['split'] = roomSplit(visible.length);
    renderStrip(visible);
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
    openId = id;
    root.closest('.app')?.setAttribute('data-detail', '1');
    renderDetail();
    renderRooms();
  }
  function close(): void {
    openId = null;
    root.closest('.app')?.setAttribute('data-detail', '0');
    detail.replaceChildren();
    renderRooms();
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

  function renderDetail(): void {
    detail.replaceChildren();
    const job = openId === null ? undefined : jobs.get(openId);
    if (job === undefined) return;
    const mine = approvals.filter((a) => a.jobId === job.id);

    const main = el('div', 'pane');
    const ph = el('div', 'ph');
    const cast = castCanvases(job.cast.filter(isRole), 2);
    const back = el('button', 'btn', '← Main');
    back.addEventListener('click', close);
    const stop = el('button', 'btn danger', 'Stop');
    stop.hidden = job.status === 'done' || job.status === 'stopped';
    stop.addEventListener('click', () => actions.stop(job.id));
    const actionsBox = el('span', 'right');
    actionsBox.append(back, stop);
    ph.append(el('span', `dot ${job.status}`), cast, el('b', undefined, short(job.request, 40)), actionsBox);

    const tabs = el('div', 'tabs dtabs');
    for (const [id, label] of [['summary', 'Summary'], ['log', 'Raw log']] as const) {
      const b = el('button', detailTab === id ? 'tab sm on' : 'tab sm', label);
      b.addEventListener('click', () => {
        detailTab = id;
        renderDetail();
      });
      tabs.appendChild(b);
    }

    const body = el('div', 'dbody');
    if (detailTab === 'log') {
      body.classList.add('term');
      for (const n of job.notes) {
        const line = el('div');
        if (n.roleName !== null) line.appendChild(el('span', 'c', `${n.roleName} `));
        line.append(n.message);
        body.appendChild(line);
      }
      if (job.notes.length === 0) body.appendChild(el('div', 'dim', 'No log yet.'));
    } else {
      for (const a of mine) body.appendChild(approvalCard(a));
      const now = el('div', 'sumline');
      now.textContent = job.status === 'done' ? 'Done.' : job.status === 'stopped' ? `Stopped${job.stopReason !== null ? ` · ${job.stopReason}` : ''}` : job.status === 'waiting' ? 'Waiting for a permission or a choice.' : job.status === 'queued' ? 'Waiting in the queue.' : `${job.roleName ?? 'Team'}: ${job.lastLine ?? 'starting'}`;
      body.appendChild(now);
      if (job.result !== null) body.appendChild(el('div', 'result', job.result));
      if (job.status === 'stopped' && needsLogin(`${job.result ?? ''} ${job.stopReason ?? ''}`)) body.appendChild(loginCard());
      const doneNotes = job.notes.filter((n) => n.role !== null).slice(-8);
      if (doneNotes.length > 0) {
        body.appendChild(el('div', 'sub', 'So far'));
        const ul = el('ul');
        for (const n of doneNotes) ul.appendChild(el('li', undefined, `${n.roleName}: ${n.message}`));
        body.appendChild(ul);
      }
    }
    main.append(ph, tabs, body);

    const side = el('div', 'dside');
    const tl = el('div', 'pane');
    tl.appendChild(el('div', 'ph', 'Steps'));
    const list = el('div', 'tl');
    if (job.steps.length === 0) list.appendChild(el('div', 'x', 'No steps yet.'));
    for (const s of job.steps) {
      const row = el('div', `s ${s.state === 'done' ? 'd' : 'n'}`);
      row.append(el('span', 'k'), el('div', 't', s.label));
      list.appendChild(row);
    }
    tl.appendChild(list);
    side.appendChild(tl);
    detail.append(main, side);
  }

  // ── 레이아웃 토글(A 나란히 · B 위아래) ──
  function layoutButtons(current: 'A' | 'B', pick: (l: 'A' | 'B') => void): void {
    layoutToggle.replaceChildren();
    for (const [id, label] of [['A', 'Side by side'], ['B', 'Stacked']] as const) {
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
    /** 캐릭터 테마가 바뀌었을 때 메인 칸의 얼굴과 이름 안내를 새로 그린다(이미 쌓인 말풍선은 그대로) */
    repaintCharacters(): void {
      paintOnce(headFace, 'intake', 2);
      paintOnce(emptyFace, 'intake', 5);
      leadHint.textContent = leadHintText();
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
      body.append(el('div', 'who', leadName()), tx);
      m.append(av, body);
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
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
