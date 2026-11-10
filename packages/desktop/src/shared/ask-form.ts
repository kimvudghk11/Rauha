import { ASK_CUSTOM_LIMIT, ASK_REASON_LIMIT } from './ask-card.js';
import type { ApprovalChoice } from './ipc.js';

/** 질문 카드 화면의 작은 규칙(DOM 없이 확인할 수 있게 따로 둔다) */
export type Tone = 'green' | 'yellow' | 'red';

/** 되돌리기 쉬움 칩 색: 쉬우면 초록, 어려우면 빨강, 그 밖에는 노랑 */
export function reversibilityTone(label: string): Tone {
  return label === '쉬움' ? 'green' : label === '어려움' ? 'red' : 'yellow';
}

const cut = (text: string, limit: number): string => text.trim().slice(0, limit);

/** 보여 준 방향 하나를 고른 답. 이유는 한 줄(선택). goOn: 방향 비교까지만 하던 분석을 설계·계획까지 이어 가기 */
export function pickChoice(id: string, reason: string, goOn: boolean): ApprovalChoice {
  return { kind: 'pick', id, reason: cut(reason, ASK_REASON_LIMIT), goOn };
}

/** 직접 쓴 방향을 고른 답. 비어 있으면 아직 보낼 수 없다(null). */
export function customChoice(text: string, reason: string, goOn: boolean): ApprovalChoice | null {
  const own = cut(text, ASK_CUSTOM_LIMIT);
  return own === '' ? null : { kind: 'custom', text: own, reason: cut(reason, ASK_REASON_LIMIT), goOn };
}

/** 설계·계획에서 고칠 점을 말한 답. 말이 없으면 아직 보낼 수 없다(null). */
export function reviseChoice(note: string): ApprovalChoice | null {
  const text = note.trim();
  return text === '' ? null : { kind: 'revise', note: text };
}

/** 질문 카드가 뜬 작업의 상태 칩 글. 허락과 선택을 구분해서 쓴다. */
export function needLabel(asks: readonly { readonly ask: unknown }[]): string {
  return asks.length > 0 && asks.every((a) => a.ask !== null) ? 'Choice needed' : 'Permission needed';
}
