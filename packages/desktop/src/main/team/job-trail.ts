import type { PermissionAnswer } from '@rauha/core';
import type { ApprovalDecision, ApprovalNote, Direction } from '../../shared/record-book.js';

/** 허락 창구의 답 → 기록에 남길 결정. 한 줄 메모가 붙은 거절은 "고쳐서 다시 해 달라"는 뜻이다. */
export function decisionOf(answer: PermissionAnswer): { readonly decision: ApprovalDecision; readonly note: string | null } {
  switch (answer.kind) {
    case 'allow':
      return { decision: 'once', note: null };
    case 'allow-always':
      return { decision: 'job', note: null };
    case 'deny':
      return answer.note === null || answer.note.trim() === '' ? { decision: 'deny', note: null } : { decision: 'revise', note: answer.note };
  }
}

export interface Trail {
  readonly approvals: readonly ApprovalNote[];
  /** 작업이 바꾼 파일. 알아내지 못했으면 null */
  readonly files: readonly string[] | null;
  readonly repo: string | null;
  /** 분석에서 사용자가 방향을 고른 기록(AI 추천과 내 선택). 고른 적이 없으면 null */
  readonly direction: Direction | null;
}

const EMPTY: Trail = { approvals: [], files: null, repo: null, direction: null };

/**
 * 작업이 도는 동안 기록에 쓸 것을 모아 둔다(허락 결정·바뀐 파일·레포·고른 방향).
 * 작업이 끝나 기록으로 옮기면 비운다. 앱이 꺼지면 사라지는 메모리 전용이다.
 */
export class JobTrail {
  private readonly trails = new Map<string, Trail>();

  approval(jobId: string, note: ApprovalNote): void {
    const t = this.trails.get(jobId) ?? EMPTY;
    this.trails.set(jobId, { ...t, approvals: [...t.approvals, note] });
  }

  files(jobId: string, files: readonly string[]): void {
    this.trails.set(jobId, { ...(this.trails.get(jobId) ?? EMPTY), files });
  }

  repo(jobId: string, repo: string): void {
    this.trails.set(jobId, { ...(this.trails.get(jobId) ?? EMPTY), repo });
  }

  /** 사용자가 고른 방향. 한 작업에서 한 번이고, 다시 오면 마지막 것을 남긴다. */
  direction(jobId: string, direction: Direction): void {
    this.trails.set(jobId, { ...(this.trails.get(jobId) ?? EMPTY), direction });
  }

  /** 모은 것을 꺼내고 지운다 */
  take(jobId: string): Trail {
    const t = this.trails.get(jobId) ?? EMPTY;
    this.trails.delete(jobId);
    return t;
  }
}
