import type { TurnOutcome } from '@rauha/core';
import type { TeamIo, TeamSession } from './team-work.js';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('멈춤'));
    });
  });

/**
 * 확인용 가짜 팀(RAUHA_FAKE_TEAM=1). 실제 Claude를 부르지 않고 단계·역할·허락 요청을 흉내 낸다.
 * 요청에 "허락"이 들어 있으면 중간에 main push 허락을 묻는다.
 */
export function fakeTeam(io: TeamIo, request: string): TeamSession {
  return {
    handle: async (): Promise<TurnOutcome> => {
      const step = (role: Parameters<TeamIo['progress']['step']>[1], message: string) => io.progress.step(message, role);
      step('intake', '요청을 읽는 중');
      await sleep(900, io.signal);
      step('tester', '재현 테스트를 쓰는 중');
      await sleep(1400, io.signal);
      step('implementer', '고치는 중: retry.policy.ts');
      await sleep(1400, io.signal);
      if (request.includes('허락')) {
        step('implementer', '변경을 main에 올리려고 해요');
        const a = await io.ask({ role: 'implementer', tool: 'Bash', detail: 'git push origin main', reason: '보호 브랜치로 push' });
        step('implementer', a.kind === 'deny' ? '거절돼서 push는 하지 않았어요' : 'push를 마쳤어요');
      }
      step('reviewer', '변경을 검토하는 중');
      await sleep(1000, io.signal);
      return { kind: 'answer', answer: `(가짜 팀) "${request}" 를 처리한 척했어요.`, checked: [], costUsd: 0, durationMs: 5000, basis: null };
    },
  };
}
