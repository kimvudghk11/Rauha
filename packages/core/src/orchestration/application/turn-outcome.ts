import type { CheckedClaim } from '../domain/fact-check.js';
import type { RunOutcome } from './minimal-loop.service.js';
import type { AccountBlock } from './ports.js';

export type TurnOutcome =
  | { readonly kind: 'work'; readonly outcome: RunOutcome }
  /** basis: 답이 읽은 기준(`main (a1b2c3d)`). 저장소 지식이 없으면 null. */
  | { readonly kind: 'answer'; readonly answer: string; readonly checked: readonly CheckedClaim[]; readonly costUsd: number; readonly durationMs: number; readonly basis: string | null; /** light로 답했다: 같은 질문을 deep으로 다시 알아볼 수 있다(`handle(input, [], 'deep')`). */ readonly canGoDeeper?: boolean; /** 팀원이 쓴 도구의 이름과 횟수("Grep 3 · Read 5"). 도구를 쓰지 않았으면 없다. */ readonly toolsLine?: string }
  /** /review: 사용자의 변경을 리뷰어가 본 결과. target null = 커밋 안 한 변경. files가 비면 리뷰어를 부르지 않았다. */
  | { readonly kind: 'review'; readonly target: string | null; readonly files: readonly string[]; readonly checked: readonly CheckedClaim[]; readonly summary: string; readonly durationMs: number }
  /** 분석 흐름(조사 → 방향 비교 → 설계·계획)의 결과. path: 분석 문서(쓰지 못했으면 null). implemented: 승인된 계획으로 작업 루프를 돌린 결과(승인하지 않았으면 null). */
  | { readonly kind: 'analysis'; readonly title: string; readonly path: string | null; readonly summary: string; readonly stopped: boolean; readonly choice: AnalysisChoice | null; readonly implemented: RunOutcome | null; readonly durationMs: number }
  /** 설계 대화로 승인받은 설계와 그 작업들의 결과 */
  | { readonly kind: 'design'; readonly title: string; readonly path: string; readonly tasks: readonly DesignTaskResult[]; readonly durationMs: number }
  /** 여러 저장소를 함께 고친 결과: 저장소별 결과(먼저 만든 저장소가 앞), 약속 검사, rauha가 정한 것 */
  | { readonly kind: 'repos'; readonly repos: readonly RepoWorkResult[]; readonly contract: readonly RepoContractResult[]; readonly decisions: readonly string[]; readonly durationMs: number }
  /** 팀원을 부르지 않고 알릴 것(예: 여러 저장소를 한 번에 고치는 요청). */
  | { readonly kind: 'notice'; readonly message: string }
  /** 계정 문제(사용 한도, 로그인 안 됨)로 막힘. 사용 한도면 message에 풀리는 시각이 들어 있다. */
  | { readonly kind: 'blocked'; readonly reason: AccountBlock['reason']; readonly message: string };

/** 사용자가 고른 방향: AI 추천과 고른 것(기록 탭이 쓴다) */
export interface AnalysisChoice {
  readonly recommended: string;
  readonly chosen: string;
  readonly reason: string | null;
  readonly diverged: boolean;
}

/** 저장소 하나의 결과. skipped: 기다리던 저장소가 멈춰 하지 않았다. fixed: 약속 검사 뒤 한 번 더 고친 결과 */
export interface RepoWorkResult {
  readonly repo: string;
  readonly status: 'complete' | 'stopped' | 'skipped';
  readonly outcome: RunOutcome | null;
  readonly fixed: RunOutcome | null;
  /** 멈춘 이유(계정 막힘 등 결과가 없는 경우) */
  readonly note: string | null;
}

/** 약속 하나가 양쪽 코드에서 맞는지. checked false: 검사하지 못했다(모든 저장소가 끝나지 않았거나 검사 출력을 못 읽음). */
export interface RepoContractResult {
  readonly what: string;
  readonly checked: boolean;
  readonly ok: boolean;
  readonly evidence: string;
  /** 어긋나서 고치러 보낸 저장소 */
  readonly fixedIn: string | null;
}

/** 설계가 나눈 작업 하나의 결과. skipped: 앞 작업이 멈춰 하지 않았다. */
export interface DesignTaskResult {
  readonly id: string;
  readonly title: string;
  readonly status: 'complete' | 'stopped' | 'skipped';
  readonly outcome: RunOutcome | null;
}
