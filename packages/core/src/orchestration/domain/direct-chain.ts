import type { ModelTier } from './team.js';

/** 메인 채팅 Claude 세션(SDK 세션 id)과 이어 온 기록 */
export interface DirectSession {
  readonly id: string;
  readonly tier: ModelTier;
  /** epoch ms */
  readonly at: number;
  /** 지금까지 이은 횟수 */
  readonly count: number;
  /** 마지막 답의 맥락 크기(입력 + 캐시 읽기 토큰). 모르면 없다 */
  readonly context?: number;
}

/** 이만큼 지나면 새로 연다(사용자가 다른 일로 넘어갔을 가능성이 크다) */
const MAX_AGE_MS = 3 * 3_600_000;
/** 이을 대화 크기 상한: 넘으면 큰 대화를 통째로 다시 읽느라 비싸다 */
const MAX_CONTEXT = 150_000;
const MAX_COUNT = 40;

/**
 * 메인 채팅은 Claude Code 처럼 한 대화로 이어 간다: 앞 세션을 이으면 앞에서 읽은 것이 남아 새 말만 보낸다.
 * 모델이 바뀌었거나, 오래됐거나, 대화가 너무 커졌으면 새로 연다(그때는 앞 대화 요약을 함께 보낸다).
 */
export class DirectChain {
  private constructor() {}

  static continues(chain: DirectSession | null, at: { readonly now: number; readonly tier: ModelTier }): boolean {
    if (chain === null || chain.tier !== at.tier) return false;
    if (at.now - chain.at > MAX_AGE_MS) return false;
    if ((chain.context ?? 0) > MAX_CONTEXT) return false;
    return chain.count < MAX_COUNT;
  }

  /** 이번 답 뒤의 세션 기록. continued: 앞 세션을 이었는지 */
  static after(before: DirectSession | null, now: { readonly id: string; readonly tier: ModelTier; readonly at: number; readonly context: number; readonly continued: boolean }): DirectSession {
    return { id: now.id, tier: now.tier, at: now.at, count: now.continued && before !== null ? before.count + 1 : 0, context: now.context };
  }
}
