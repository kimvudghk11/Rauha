import type { JobWork } from '@rauha/core/jobs';

/**
 * 연습용 작업: 3~6초 기다렸다 끝난다. 신호가 꺼지면 바로 그만둔다.
 * 마일스톤 2에서 진짜 팀(ChatSession을 나눈 작업)으로 바꾼다. 화면에도 "연습용 작업"이라고 보인다.
 */
export const demoWork: JobWork = (_job, signal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 3000 + Math.random() * 3000);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('멈춤'));
    });
  });
