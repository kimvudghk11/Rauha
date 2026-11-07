import type { PermissionAnswer, PermissionRequest } from '@rauha/core';

/** 사용자에게 가 있는 허락 요청 하나 */
export interface PendingApproval {
  readonly id: string;
  readonly jobId: string;
  readonly request: PermissionRequest;
  readonly at: string;
}

interface Waiting extends PendingApproval {
  readonly resolve: (answer: PermissionAnswer) => void;
}

/**
 * 허락 요청 창구. 팀원이 묻는 허락을 모아 두고 화면의 답을 기다린다.
 * 작업을 멈추면 그 작업의 요청은 거절로 닫는다. 판정 규칙은 여기가 아니라 팀원 쪽 도구 가드에 있다.
 */
export class Approvals {
  private readonly waiting = new Map<string, Waiting>();

  constructor(
    private readonly deps: { readonly newId: () => string; readonly now: () => string; readonly onChange: (pending: readonly PendingApproval[]) => void },
  ) {}

  ask(jobId: string, request: PermissionRequest): Promise<PermissionAnswer> {
    return new Promise((resolve) => {
      const id = this.deps.newId();
      this.waiting.set(id, { id, jobId, request, at: this.deps.now(), resolve });
      this.changed();
    });
  }

  /** 화면이 고른 답을 전한다. 모르는 요청이면 아무 일 없다. */
  answer(id: string, answer: PermissionAnswer): void {
    const w = this.waiting.get(id);
    if (w === undefined) return;
    this.waiting.delete(id);
    w.resolve(answer);
    this.changed();
  }

  /** 작업이 멈추거나 끝났을 때 그 작업이 기다리던 요청을 거절로 닫는다. */
  closeJob(jobId: string): void {
    let closed = false;
    for (const w of [...this.waiting.values()]) {
      if (w.jobId !== jobId) continue;
      this.waiting.delete(w.id);
      w.resolve({ kind: 'deny', note: null });
      closed = true;
    }
    if (closed) this.changed();
  }

  pending(): readonly PendingApproval[] {
    return [...this.waiting.values()].map(({ resolve: _resolve, ...rest }) => rest);
  }

  private changed(): void {
    this.deps.onChange(this.pending());
  }
}
