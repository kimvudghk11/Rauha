import { DirectionSet, DomainError } from '@rauha/core';
import { askViewOf } from './approval-view.js';
import type { Approvals, AskPayload, AskReply } from './approvals.js';
import type { JobTrail } from './job-trail.js';

export interface AskFlowDeps {
  readonly approvals: Approvals;
  readonly trail: JobTrail;
  /** 카드가 새로 오면 알린다(창이 가려져 있을 때의 알림) */
  readonly notify: (jobId: string, headline: string) => void;
  /** 작업이 이미 끝났는가. 끝난 뒤에 자동으로 닫힌 카드는 사용자가 정한 선택이 아니라서 기록하지 않는다. */
  readonly isOver: (jobId: string) => boolean;
}

/**
 * 분석의 질문 카드를 허락 창구에 올리고 답을 기다린다. 서비스 규칙 그대로: 올리기 → 알리기 → 답 받기 → 기록 거리 남기기.
 * 사용자가 방향을 고르면 AI 추천과 고른 것을 도메인(DirectionSet.choose)이 정한 대로 작업 기록거리(trail)에 둔다.
 * 그러면 끝난 작업이 기록 탭으로 갈 때 "방향 비교"와 "AI 추천과 다르게 골랐어요"가 채워진다.
 */
export function askCardFlow(deps: AskFlowDeps): (jobId: string, payload: AskPayload, signal: AbortSignal) => Promise<AskReply> {
  return async (jobId, payload, signal) => {
    const answered = deps.approvals.askCard(jobId, payload, signal);
    if (deps.approvals.pending().some((p) => p.jobId === jobId && p.ask === payload)) deps.notify(jobId, askViewOf(payload).headline);
    const reply = await answered;
    if (payload.kind === 'directions' && (reply.kind === 'pick' || reply.kind === 'custom') && !deps.isOver(jobId)) {
      try {
        const { card } = payload;
        const choice = DirectionSet.of(card.options, card.recommendedId, card.recommendedReason).choose(reply);
        deps.trail.direction(jobId, { recommended: choice.recommended, chosen: choice.chosen, reason: choice.reason });
      } catch (error) {
        // 알아볼 수 없는 선택은 분석 쪽이 거절한다. 기록거리만 남기지 않는다.
        if (!(error instanceof DomainError)) throw error;
      }
    }
    return reply;
  };
}
