import type { ApprovalCard, ApprovalReply, DirectionCard, DirectionReply, PermissionAnswer, PermissionRequest } from '@rauha/core';

/** 사용자에게 가 있는 질문 카드 하나: 분석의 방향 고르기, 설계·계획 승인 */
export type AskPayload = { readonly kind: 'directions'; readonly card: DirectionCard } | { readonly kind: 'approval'; readonly card: ApprovalCard };
export type AskReply = DirectionReply | ApprovalReply;

/** 사용자에게 가 있는 허락 요청(또는 질문 카드) 하나. 질문 카드이면 ask가 있다. */
export interface PendingApproval {
  readonly id: string;
  readonly jobId: string;
  readonly request: PermissionRequest;
  readonly at: string;
  readonly ask: AskPayload | null;
}

type Waiting =
  | (PendingApproval & { readonly ask: null; readonly resolve: (answer: PermissionAnswer) => void })
  | (PendingApproval & { readonly ask: AskPayload; readonly resolve: (reply: AskReply) => void });

const ASKER: Readonly<Record<AskPayload['kind'], PermissionRequest['role']>> = { directions: 'debugger', approval: 'designer' };

/** 질문 카드를 허락 카드 목록에 함께 담기 위한 설명(화면은 ask가 있으면 질문 카드로 그린다) */
function askRequest(payload: AskPayload): PermissionRequest {
  return { role: ASKER[payload.kind], tool: 'rauha:ask', detail: payload.card.title, reason: payload.kind === 'directions' ? '고칠 방향을 골라 주세요' : '설계와 계획을 보고 승인해 주세요' };
}

/**
 * 허락 요청 창구. 팀원이 묻는 허락과 분석의 질문 카드를 모아 두고 화면의 답을 기다린다.
 * 작업을 멈추면 그 작업의 요청은 거절(질문 카드는 그만두기)로 닫는다. 판정 규칙은 여기가 아니라 팀원 쪽 도구 가드와 분석 도메인에 있다.
 */
export class Approvals {
  private readonly waiting = new Map<string, Waiting>();

  constructor(
    private readonly deps: { readonly newId: () => string; readonly now: () => string; readonly onChange: (pending: readonly PendingApproval[]) => void },
  ) {}

  ask(jobId: string, request: PermissionRequest): Promise<PermissionAnswer> {
    return new Promise((resolve) => {
      const id = this.deps.newId();
      this.waiting.set(id, { id, jobId, request, at: this.deps.now(), ask: null, resolve });
      this.changed();
    });
  }

  /**
   * 분석의 질문 카드. signal이 꺼지면(기다림 한도, 작업 멈춤) 카드를 닫고 그만두기로 답한다.
   * 이미 꺼져 있으면 카드를 띄우지 않는다.
   */
  askCard(jobId: string, payload: AskPayload, signal: AbortSignal): Promise<AskReply> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve({ kind: 'stop' });
      const id = this.deps.newId();
      this.waiting.set(id, { id, jobId, request: askRequest(payload), at: this.deps.now(), ask: payload, resolve });
      signal.addEventListener('abort', () => this.close(id), { once: true });
      this.changed();
    });
  }

  /** 화면이 고른 답을 전한다. 모르는 요청이거나 그 요청에 맞지 않는 답이면 아무 일 없다(카드는 계속 기다린다). */
  answer(id: string, answer: PermissionAnswer | AskReply | { readonly kind: 'ignore' }): void {
    const w = this.waiting.get(id);
    if (w === undefined) return;
    if (w.ask === null) {
      if (answer.kind !== 'allow' && answer.kind !== 'allow-always' && answer.kind !== 'deny') return;
      this.waiting.delete(id);
      w.resolve(answer);
    } else {
      const reply = this.askReplyOf(w.ask, answer);
      if (reply === null) return;
      this.waiting.delete(id);
      w.resolve(reply);
    }
    this.changed();
  }

  /** 작업이 멈추거나 끝났을 때 그 작업이 기다리던 요청을 거절(질문 카드는 그만두기)로 닫는다. */
  closeJob(jobId: string): void {
    let closed = false;
    for (const w of [...this.waiting.values()]) {
      if (w.jobId !== jobId) continue;
      this.finish(w);
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

  private close(id: string): void {
    const w = this.waiting.get(id);
    if (w === undefined) return;
    this.finish(w);
    this.changed();
  }

  private finish(w: Waiting): void {
    this.waiting.delete(w.id);
    if (w.ask === null) w.resolve({ kind: 'deny', note: null });
    else w.resolve({ kind: 'stop' });
  }

  /** 화면의 답을 카드 종류에 맞는 답으로. "다르게 해 줘"(말이 붙은 거절)는 승인 카드에서 고칠 점이다. */
  private askReplyOf(ask: AskPayload, answer: PermissionAnswer | AskReply | { readonly kind: 'ignore' }): AskReply | null {
    if (answer.kind === 'stop') return answer;
    if (answer.kind === 'deny') return ask.kind === 'approval' && answer.note !== null ? { kind: 'revise', note: answer.note } : { kind: 'stop' };
    if (ask.kind === 'directions') return answer.kind === 'pick' || answer.kind === 'custom' ? answer : null;
    return answer.kind === 'proceed' || answer.kind === 'revise' ? answer : null;
  }
}
