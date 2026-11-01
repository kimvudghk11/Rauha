import type { CheckedClaim } from '../domain/fact-check.js';
import type { RunOutcome } from './minimal-loop.service.js';
import type { AccountBlock } from './ports.js';

export type TurnOutcome =
  | { readonly kind: 'work'; readonly outcome: RunOutcome }
  /** basis: 답이 읽은 기준(`main (a1b2c3d)`). 저장소 지식이 없으면 null. */
  | { readonly kind: 'answer'; readonly answer: string; readonly checked: readonly CheckedClaim[]; readonly costUsd: number; readonly durationMs: number; readonly basis: string | null }
  /** /review: 사용자의 변경을 리뷰어가 본 결과. target null = 커밋 안 한 변경. files가 비면 리뷰어를 부르지 않았다. */
  | { readonly kind: 'review'; readonly target: string | null; readonly files: readonly string[]; readonly checked: readonly CheckedClaim[]; readonly summary: string; readonly durationMs: number }
  /** 설계 대화로 승인받은 설계와 그 작업들의 결과 */
  | { readonly kind: 'design'; readonly title: string; readonly path: string; readonly tasks: readonly DesignTaskResult[]; readonly durationMs: number }
  /** 팀원을 부르지 않고 알릴 것(예: 여러 저장소를 한 번에 고치는 요청). */
  | { readonly kind: 'notice'; readonly message: string }
  /** 계정 문제(사용 한도, 로그인 안 됨)로 막힘. 사용 한도면 message에 풀리는 시각이 들어 있다. */
  | { readonly kind: 'blocked'; readonly reason: AccountBlock['reason']; readonly message: string };

/** 설계가 나눈 작업 하나의 결과. skipped: 앞 작업이 멈춰 하지 않았다. */
export interface DesignTaskResult {
  readonly id: string;
  readonly title: string;
  readonly status: 'complete' | 'stopped' | 'skipped';
  readonly outcome: RunOutcome | null;
}
