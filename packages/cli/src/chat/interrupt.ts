/** 쉬는 중 Ctrl+C를 두 번 눌러 끝낼 때 두 번째를 기다리는 시간 */
export const EXIT_WINDOW_MS = 2000;

/** Ctrl+C가 건드리는 것들. 화면·팀원·시계를 바깥에서 빌려 와서 규칙만 따로 시험할 수 있다. */
export interface InterruptHost {
  busy(): boolean;
  /** 열린 모든 저장소의 팀원 호출을 끊는다 */
  cancelWork(): void;
  /** 기다리던 질문을 거절로 닫는다 */
  cancelPrompts(): void;
  /** 대기열을 비우고 지운 개수를 돌려준다 */
  clearQueue(): number;
  print(line: string): void;
  setNotice(text: string): void;
  exit(): void;
  now(): number;
  /** ms 뒤에 fn을 부른다 */
  later(fn: () => void, ms: number): void;
}

/**
 * Ctrl+C: 일하는 중이면 그 작업만 멈춘다(팀원 호출을 끊고 기다리던 질문은 거절로 닫는다).
 * 쉬는 중이면 2초 안에 한 번 더 눌러야 끝난다.
 */
export function createInterrupt(host: InterruptHost): () => void {
  let last = 0;
  return () => {
    if (host.busy()) {
      host.cancelWork();
      host.cancelPrompts();
      const dropped = host.clearQueue();
      host.print(dropped > 0 ? `  멈추는 중이에요… (기다리던 입력 ${dropped}개도 지웠어요)` : '  멈추는 중이에요…');
      return;
    }
    if (host.now() - last < EXIT_WINDOW_MS) {
      // 알림을 지운 화면이 한 번 그려진 뒤 닫는다(바로 닫으면 마지막 화면에 알림이 남는다).
      host.setNotice('');
      host.later(() => host.exit(), 50);
      return;
    }
    last = host.now();
    // 지난 출력에 남기지 않고 입력창 아래에 잠깐 띄운다(Claude Code·Kiro처럼).
    host.setNotice('한 번 더 Ctrl+C(또는 Ctrl+D)를 누르면 끝나요');
    host.later(() => host.setNotice(''), EXIT_WINDOW_MS);
  };
}
