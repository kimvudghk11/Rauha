/** 같은 버튼을 이 시간(ms) 안에 다시 누른 것은 한 번으로 본다(더블클릭·이중 발사로 같은 일이 두 번 돌지 않게). */
export const REPEAT_MS = 450;

/** 직전 누름과 같은 요소를 REPEAT_MS 안에 또 눌렀으면 삼킨다. */
export function isRepeatPress(prev: { readonly target: EventTarget | null; readonly at: number } | null, target: EventTarget | null, at: number): boolean {
  return prev !== null && prev.target === target && at - prev.at >= 0 && at - prev.at < REPEAT_MS;
}

/**
 * 창 전체의 버튼 누름을 지킨다. 모양이 버튼(.btn)인 것만 대상이라 목록 행·탭·칩은 그대로 두 번 눌러도 된다.
 * 눌린 버튼이 곧 지워지고 새로 그려지는 경우(요소가 바뀜)에는 영향이 없다.
 */
export function installClickGuard(doc: Document = document, now: () => number = () => Date.now()): void {
  let prev: { target: EventTarget | null; at: number } | null = null;
  doc.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element | null)?.closest?.('button.btn');
      if (!btn) return;
      const t = now();
      if (isRepeatPress(prev, btn, t)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      prev = { target: btn, at: t };
    },
    true,
  );
}
