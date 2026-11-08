import type { AskOptionView } from '../shared/ask-card.js';
import { customChoice, pickChoice, reversibilityTone, reviseChoice } from '../shared/ask-form.js';
import type { ApprovalChoice, ApprovalView } from '../shared/ipc.js';
import { el } from './dom.js';

type Send = (id: string, choice: ApprovalChoice) => void;

const list = (label: string, items: readonly string[]): HTMLElement | null => (items.length === 0 ? null : el('div', 'hint', `${label}: ${items.join(' / ')}`));

function optionBox(o: AskOptionView, canGoOn: boolean, reason: HTMLInputElement, send: (c: ApprovalChoice) => void): HTMLElement {
  const box = el('div', o.recommended ? 'item opt rec' : 'item opt');
  const head = el('div', 'facts');
  head.appendChild(el('b', undefined, `${o.id}. ${o.title}`));
  if (o.recommended) head.appendChild(el('span', 'chip blue', 'AI 추천'));
  head.appendChild(el('span', `chip ${reversibilityTone(o.reversibility)}`, `되돌리기 ${o.reversibility}`));
  box.append(head, el('div', undefined, o.summary));
  for (const line of [list('장점', o.pros), list('단점', o.cons), o.risk === '' ? null : list('위험', [o.risk]), list('손댈 곳', o.touches)]) if (line !== null) box.appendChild(line);
  const row = el('div', 'btns');
  const pick = el('button', o.recommended ? 'btn sm primary' : 'btn sm', '이 방향으로');
  pick.addEventListener('click', () => send(pickChoice(o.id, reason.value, false)));
  row.appendChild(pick);
  if (canGoOn) {
    const goOn = el('button', 'btn sm', '고르고 설계·계획까지');
    goOn.addEventListener('click', () => send(pickChoice(o.id, reason.value, true)));
    row.appendChild(goOn);
  }
  box.appendChild(row);
  return box;
}

/** 분석의 질문 카드(방향 고르기·계획 승인). 규칙은 core·main에 있고 여기서는 그리기와 답 보내기만 한다. */
export function askCard(a: ApprovalView, answer: Send): HTMLElement {
  const ask = a.ask!;
  const card = el('div', 'approval ask');
  card.appendChild(el('div', 'ah', ask.headline));
  const send = (c: ApprovalChoice | null, input?: HTMLInputElement): void => {
    if (c === null) input?.focus();
    else answer(a.id, c);
  };
  const stop = el('button', 'btn sm danger', '여기서 멈추기');
  stop.addEventListener('click', () => answer(a.id, { kind: 'stop' }));

  if (ask.kind === 'directions') {
    card.appendChild(el('div', undefined, `증상: ${ask.symptom}`));
    const reason = el('input', 'sm');
    reason.placeholder = '이유 한 줄(선택)';
    const opts = el('div', 'opts');
    for (const o of ask.options) opts.appendChild(optionBox(o, ask.canGoOn, reason, (c) => send(c)));
    card.append(opts, el('div', 'hint', `AI 추천 이유: ${ask.recommendedReason}`), reason);
    const own = el('input', 'sm');
    own.placeholder = '직접 쓴 방향';
    const ownBtn = el('button', 'btn sm', '내가 쓴 방향으로');
    ownBtn.addEventListener('click', () => send(customChoice(own.value, reason.value, false), own));
    const row = el('div', 'btns');
    row.append(ownBtn, stop);
    card.append(own, row);
  } else {
    card.append(el('div', undefined, `고른 방향: ${ask.chosen}`), el('div', undefined, `목표: ${ask.goal}`));
    const steps = el('ol');
    for (const s of ask.steps) steps.appendChild(el('li', undefined, s.title));
    card.appendChild(steps);
    if (ask.risks.length > 0) card.appendChild(el('div', 'hint', `확인하지 못한 것: ${ask.risks.join(' / ')}`));
    const note = el('input', 'sm');
    note.placeholder = '고칠 점이 있으면 적어요';
    const go = el('button', 'btn sm primary', '이대로 고치기');
    go.addEventListener('click', () => answer(a.id, { kind: 'proceed' }));
    const revise = el('button', 'btn sm', '고칠 점 적고 다시');
    revise.addEventListener('click', () => send(reviseChoice(note.value), note));
    const row = el('div', 'btns');
    row.append(go, revise, stop);
    card.append(note, row);
  }
  if (ask.docPath !== null) card.appendChild(el('div', 'hint', `문서: ${ask.docPath}`));
  return card;
}
