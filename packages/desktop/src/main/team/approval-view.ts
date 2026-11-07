import type { PermissionAnswer } from '@rauha/core';
import { ROLE_INFO } from '@rauha/core/jobs';
import { summarizeRequest } from '../../shared/approval-summary.js';
import type { ApprovalChoice, ApprovalView } from '../../shared/ipc.js';
import type { PendingApproval } from './approvals.js';

/** 허락 화면의 버튼 → 팀원에게 돌려줄 답. "이번 작업 동안 허락"은 allow-always(그 실행 동안 같은 명령은 다시 묻지 않는다). */
export function answerFor(choice: ApprovalChoice): PermissionAnswer {
  switch (choice.kind) {
    case 'once':
      return { kind: 'allow' };
    case 'job':
      return { kind: 'allow-always' };
    case 'revise': {
      const note = choice.note.trim();
      return { kind: 'deny', note: note === '' ? null : note };
    }
    case 'deny':
      return { kind: 'deny', note: null };
  }
}

export function approvalView(p: PendingApproval, protectedBranches?: readonly string[]): ApprovalView {
  return {
    id: p.id,
    jobId: p.jobId,
    role: p.request.role,
    roleName: ROLE_INFO[p.request.role].name,
    tool: p.request.tool,
    detail: p.request.detail,
    reason: p.request.reason,
    at: p.at,
    summary: summarizeRequest(p.request, protectedBranches),
  };
}
