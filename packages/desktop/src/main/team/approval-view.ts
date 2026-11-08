import type { PermissionAnswer } from '@rauha/core';
import { ROLE_INFO } from '@rauha/core/jobs';
import { summarizeRequest } from '../../shared/approval-summary.js';
import { ASK_CUSTOM_LIMIT, ASK_REASON_LIMIT, type AskView } from '../../shared/ask-card.js';
import type { ApprovalChoice, ApprovalView } from '../../shared/ipc.js';
import type { AskPayload, AskReply, PendingApproval } from './approvals.js';

/** 알아볼 수 없는 답(화면이 잘못 보낸 것). 창구가 무시한다. */
export type IgnoredAnswer = { readonly kind: 'ignore' };

const REVERSIBILITY: Readonly<Record<string, string>> = { easy: '쉬움', medium: '보통', hard: '어려움' };

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

/**
 * 허락 화면의 버튼 → 팀원에게 돌려줄 답. "이번 작업 동안 허락"은 allow-always(그 실행 동안 같은 명령은 다시 묻지 않는다).
 * 질문 카드의 답도 여기서 바꾼다. 화면이 보낸 값은 믿지 않고 모양을 다시 확인한다(알아볼 수 없으면 무시).
 */
export function answerFor(choice: ApprovalChoice): PermissionAnswer | AskReply | IgnoredAnswer {
  switch (choice.kind) {
    case 'once':
      return { kind: 'allow' };
    case 'job':
      return { kind: 'allow-always' };
    case 'revise': {
      const note = text(choice.note, 2000);
      return { kind: 'deny', note: note === '' ? null : note };
    }
    case 'deny':
      return { kind: 'deny', note: null };
    case 'pick': {
      const id = text(choice.id, 40);
      const reason = text(choice.reason, ASK_REASON_LIMIT);
      return id === '' ? { kind: 'ignore' } : { kind: 'pick', id, ...(reason !== '' ? { reason } : {}), ...(choice.goOn === true ? { goOn: true } : {}) };
    }
    case 'custom': {
      const own = text(choice.text, ASK_CUSTOM_LIMIT);
      const reason = text(choice.reason, ASK_REASON_LIMIT);
      return own === '' ? { kind: 'ignore' } : { kind: 'custom', text: own, ...(reason !== '' ? { reason } : {}), ...(choice.goOn === true ? { goOn: true } : {}) };
    }
    case 'proceed':
      return { kind: 'proceed' };
    case 'stop':
      return { kind: 'stop' };
    default:
      return { kind: 'ignore' };
  }
}

/** 질문 카드(core의 카드) → 화면용 */
export function askViewOf(ask: AskPayload): AskView {
  if (ask.kind === 'directions') {
    const c = ask.card;
    return {
      kind: 'directions',
      headline: `고칠 방향을 골라 주세요 · ${c.title}`,
      symptom: c.symptom,
      options: c.options.map((o) => ({ ...o, reversibility: REVERSIBILITY[o.reversibility] ?? o.reversibility, recommended: o.id === c.recommendedId })),
      recommendedReason: c.recommendedReason,
      canGoOn: c.canGoOn,
      docPath: c.docPath,
    };
  }
  const c = ask.card;
  return { kind: 'approval', headline: `설계와 계획을 확인해 주세요 · ${c.title}`, chosen: c.chosen, goal: c.goal, steps: c.steps, risks: c.risks, docPath: c.docPath };
}

export function approvalView(p: PendingApproval, protectedBranches?: readonly string[]): ApprovalView {
  const ask = p.ask === null ? null : askViewOf(p.ask);
  const summary = summarizeRequest(p.request, protectedBranches);
  return {
    id: p.id,
    jobId: p.jobId,
    role: p.request.role,
    roleName: ROLE_INFO[p.request.role].name,
    tool: p.request.tool,
    detail: p.request.detail,
    reason: p.request.reason,
    at: p.at,
    summary: ask === null ? summary : { ...summary, kind: 'other', headline: ask.headline, risks: [] },
    risk: p.request.risk ?? null,
    ask,
  };
}
