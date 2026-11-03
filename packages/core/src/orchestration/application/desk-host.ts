import type { MemberRole } from '../domain/member-role.js';
import type { ModelTier } from '../domain/team.js';
import type { MemberResult } from './ports.js';
import type { TurnOutcome } from './turn-outcome.js';

/** 팀원 한 번 호출에 붙는 선택 사항 */
export interface MemberOptions {
  readonly signal?: AbortSignal | undefined;
  readonly dirs?: readonly string[];
  readonly canWrite?: (path: string) => boolean;
  /** 역할 기본 모델 대신 쓸 모델(저장소를 나눠 읽는 일은 싼 모델로) */
  readonly tier?: ModelTier;
  /** 진행 줄에 "작업 중…"을 내지 않는다(여러 호출을 묶어 따로 진행을 알릴 때) */
  readonly quiet?: boolean;
  /** 브라우저 도구를 붙인다(BrowserNeed가 정한다) */
  readonly browser?: boolean;
}

/**
 * 세션이 부서 데스크(회사 부서, 문서)에 빌려주는 것.
 * 호출 비용·호출 수는 세션이 합산하고, 결과를 기억과 앞 대화에 남기는 일도 세션이 한다.
 */
export interface DeskHost {
  member(role: MemberRole, parts: readonly string[], outputSchema: Record<string, unknown>, options: MemberOptions): Promise<MemberResult>;
  /** 결과를 기억과 앞 대화에 남기고 답으로 돌려준다. cited: 답이 만들거나 읽은 파일 */
  settle(label: string, input: string, answer: string, remembered: string, started: number, costBefore: number, cited?: readonly string[]): Promise<TurnOutcome>;
  /** 지금까지 쓴 비용(한 입력의 비용을 재려고 앞뒤로 읽는다) */
  spent(): number;
  workspaceBlock(): string;
}

/** 답변·설계 팀원에게 넘길 저장소 지식 묶음과 그 기준 */
export interface Known {
  readonly block: string;
  readonly basis: string;
}
