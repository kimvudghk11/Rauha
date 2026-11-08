import type { ModelTier } from '../../orchestration/domain/team.js';
import type { AnalysisRun } from '../domain/analysis-run.js';
import type { DirectionAnswer, DirectionOption } from '../domain/direction.js';
import type { MemberRole } from '../../orchestration/domain/member-role.js';

/** 방향 고르기 카드에 보일 것 */
export interface DirectionCard {
  readonly runId: string;
  readonly title: string;
  readonly symptom: string;
  readonly options: readonly DirectionOption[];
  readonly recommendedId: string;
  readonly recommendedReason: string;
  /** 방향 비교까지만 하기로 한 분석이라 "고르고 설계·계획까지"를 보일지 */
  readonly canGoOn: boolean;
  /** 지금까지 쓴 문서(저장소 기준). 쓰지 못했으면 null */
  readonly docPath: string | null;
}

/** 카드의 답. stop: 여기서 그만두기 */
export type DirectionReply = DirectionAnswer | { readonly kind: 'stop' };

/** 설계·계획을 보여 주고 "이대로 고치기"를 묻는 카드에 보일 것 */
export interface ApprovalCard {
  readonly runId: string;
  readonly title: string;
  readonly chosen: string;
  readonly goal: string;
  readonly steps: readonly { readonly number: number; readonly title: string }[];
  readonly risks: readonly string[];
  readonly docPath: string | null;
}

export type ApprovalReply = { readonly kind: 'proceed' } | { readonly kind: 'revise'; readonly note: string } | { readonly kind: 'stop' };

/**
 * 사용자에게 방향을 고르게 하고 계획을 승인받는다. signal이 꺼지면(기다리다 시간이 지났거나 작업이 멈춤) 카드를 닫고
 * 'stop'으로 답한다. 화면이 없으면 이 포트 자체가 없다.
 */
export interface AnalysisUserPort {
  chooseDirection(card: DirectionCard, signal: AbortSignal): Promise<DirectionReply>;
  decide(card: ApprovalCard, signal: AbortSignal): Promise<ApprovalReply>;
}

/** 분석 문서 저장소. 있는 파일은 덮어쓰지 않는다. */
export interface AnalysisDocsPort {
  /** 새 문서를 만들고 저장소 기준 경로를 돌려준다. 같은 이름이 있으면 번호를 붙여 새로 만든다. */
  create(where: { readonly date: string; readonly topic: string }, markdown: string): Promise<string>;
  /** 이 분석이 만든 문서에만 이어 쓴다(첫 줄 표지가 runId와 같아야 한다). 아니면 DomainError. */
  update(path: string, runId: string, markdown: string): Promise<void>;
}

/** 기다림 한도. 한도가 되면 expired가 끝나고, 답이 먼저 오면 cancel로 거둔다. */
export type AskTimer = (ms: number) => { readonly expired: Promise<void>; cancel(): void };

export interface AnalysisInput {
  readonly request: string;
  /** 조사·방향 비교를 맡는 팀원: debug면 디버깅, risk면 위험 점검 */
  readonly role: Extract<MemberRole, 'debugger' | 'riskchecker'>;
  /** 라우터가 정한 범위(없으면 요청 글에서 어림) */
  readonly reach: unknown;
  /** 라우터가 feature로 본 요청인지(큰 변경 판정에 쓴다) */
  readonly routedFeature: boolean;
  /** 이 요청에 함께 읽는 저장소 수 */
  readonly repos: number;
  readonly repo: string;
  /** 저장소 지식·기억·앞 대화 블록. 같은 순서로 보내 프롬프트 캐시가 맞게 한다. */
  readonly knowledge: string | null;
  readonly memory: string | null;
  readonly conversation: string | null;
  readonly workspace: string;
  readonly basis: string | null;
}

export interface AnalysisCost {
  readonly tier: ModelTier;
  readonly calls: number;
  readonly costUsd: number;
}

export interface AnalysisResult {
  readonly run: AnalysisRun;
  /** 문서 위치(저장소 기준). 쓰지 못했으면 null */
  readonly path: string | null;
  /** 문서를 쓰지 못한 이유(있으면 사용자에게 알린다) */
  readonly docProblem: string | null;
  readonly cost: readonly AnalysisCost[];
  /** 승인되었으면 작업 루프에 넘길 요청과 설계 블록. 아니면 null */
  readonly brief: { readonly request: string; readonly block: string } | null;
  /** 사용자에게 보일 글 */
  readonly summary: string;
}

/** 대화 세션이 부르는 쪽. AnalysisService가 구현한다. */
export interface AnalysisPort {
  run(input: AnalysisInput): Promise<AnalysisResult>;
}
