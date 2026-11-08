/**
 * 분석의 질문 카드(화면용). 허락 카드와 같은 목록으로 오고, ask가 있으면 질문 카드로 그린다.
 * 방향 고르기: AI 추천을 표시하되 다른 방향을 고르거나 직접 쓸 수 있다. 승인: 설계·계획을 보고 "이대로 고치기".
 */

export interface AskOptionView {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly risk: string;
  /** 쉬움 · 보통 · 어려움 */
  readonly reversibility: string;
  readonly touches: readonly string[];
  /** AI가 추천하는 방향 */
  readonly recommended: boolean;
}

export type AskView =
  | {
      readonly kind: 'directions';
      readonly headline: string;
      readonly symptom: string;
      readonly options: readonly AskOptionView[];
      readonly recommendedReason: string;
      /** 방향 비교까지만 하기로 한 분석이라 "고르고 설계·계획까지" 버튼을 보일지 */
      readonly canGoOn: boolean;
      readonly docPath: string | null;
    }
  | {
      readonly kind: 'approval';
      readonly headline: string;
      readonly chosen: string;
      readonly goal: string;
      readonly steps: readonly { readonly number: number; readonly title: string }[];
      readonly risks: readonly string[];
      readonly docPath: string | null;
    };

/** 질문 카드의 직접 쓴 방향·이유 글자 수 상한(분석 도메인과 같은 값) */
export const ASK_CUSTOM_LIMIT = 400;
export const ASK_REASON_LIMIT = 200;
