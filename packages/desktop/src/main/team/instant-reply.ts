import { greetingReply, type TurnOutcome } from '@rauha/core';

/**
 * 작업 폴더를 준비하기 전에(git 상태·체크포인트·원격 확인은 Windows 에서 몇 초씩 쌓인다) 바로 답할 수 있는 말이면 그 답.
 * 정해 둔 인사만 해당하고, 더 깊게·이미지를 붙인 말은 평소 흐름으로 간다(null).
 * 작업 스레드 안의 "고마워 수고했어"도 인사다 — 앞 대화 전체를 붙여 모델을 부르면 인사 한마디에 세션을 쓴다.
 */
export function instantReply(text: string, context: { readonly depth?: string | undefined; readonly followUp?: boolean; readonly images?: boolean }): TurnOutcome | null {
  if (context.depth !== undefined || context.images === true) return null;
  const hello = greetingReply(text);
  return hello === null ? null : { kind: 'answer', answer: hello, checked: [], costUsd: 0, durationMs: 0, basis: null, canGoDeeper: false };
}
