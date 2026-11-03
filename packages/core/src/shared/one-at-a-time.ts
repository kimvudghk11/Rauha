/**
 * 동시에 불러도 하나씩 차례로 도는 함수로 감싼다. 여러 저장소가 함께 일할 때
 * 사용자에게 묻는 화면(해석 고르기, 위험 명령 허락)이 겹치지 않게 줄을 세운다.
 */
export function oneAtATime<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args: A) => {
    const next = tail.then(() => fn(...args));
    // 실패해도 줄은 이어진다. 실패는 부른 쪽이 next에서 받는다.
    tail = next.catch(() => undefined);
    return next;
  };
}
