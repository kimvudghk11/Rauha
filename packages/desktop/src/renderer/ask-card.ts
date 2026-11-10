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
  if (o.recommended) head.appendChild(el('span', 'chip blue', 'AI pick'));
  head.appendChild(el('span', `chip ${reversibilityTone(o.reversibility)}`, `Undo: ${o.reversibility}`));
  box.append(head, el('div', undefined, o.summary));
  for (const line of [list('Pros', o.pros), list('Cons', o.cons), o.risk === '' ? null : list('Risk', [o.risk]), list('Touches', o.touches)]) if (line !== null) box.appendChild(line);
  const row = el('div', 'btns');
  const pick = el('button', o.recommended ? 'btn sm primary' : 'btn sm', 'Go this way');
  pick.addEventListener('click', () => send(pickChoice(o.id, reason.value, false)));
  row.appendChild(pick);
  if (canGoOn) {
    const goOn = el('button', 'btn sm', 'Pick and continue to design');
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
  const stop = el('button', 'btn sm danger', 'Stop here');
  stop.addEventListener('click', () => answer(a.id, { kind: 'stop' }));

  if (ask.kind === 'directions') {
    card.appendChild(el('div', undefined, `Symptom: ${ask.symptom}`));
    const reason = el('input', 'sm');
    reason.placeholder = 'One-line reason (optional)';
    const opts = el('div', 'opts');
    for (const o of ask.options) opts.appendChild(optionBox(o, ask.canGoOn, reason, (c) => send(c)));
    card.append(opts, el('div', 'hint', `Why AI picked it: ${ask.recommendedReason}`), reason);
    const own = el('input', 'sm');
    own.placeholder = 'Your own direction';
    const ownBtn = el('button', 'btn sm', 'Use my direction');
    ownBtn.addEventListener('click', () => send(customChoice(own.value, reason.value, false), own));
    const row = el('div', 'btns');
    row.append(ownBtn, stop);
    card.append(own, row);
  } else {
    card.append(el('div', undefined, `Chosen direction: ${ask.chosen}`), el('div', undefined, `Goal: ${ask.goal}`));
    const steps = el('ol');
    for (const s of ask.steps) steps.appendChild(el('li', undefined, s.title));
    card.appendChild(steps);
    if (ask.risks.length > 0) card.appendChild(el('div', 'hint', `Not verified: ${ask.risks.join(' / ')}`));
    const note = el('input', 'sm');
    note.placeholder = 'Describe anything to change';
    const go = el('button', 'btn sm primary', 'Apply as is');
    go.addEventListener('click', () => answer(a.id, { kind: 'proceed' }));
    const revise = el('button', 'btn sm', 'Revise and redo');
    revise.addEventListener('click', () => send(reviseChoice(note.value), note));
    const row = el('div', 'btns');
    row.append(go, revise, stop);
    card.append(note, row);
  }
  if (ask.docPath !== null) card.appendChild(el('div', 'hint', `Doc: ${ask.docPath}`));
  return card;
}
