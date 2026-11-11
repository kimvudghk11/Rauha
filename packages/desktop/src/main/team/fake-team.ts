import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DirectionSet, type ApprovalCard, type DirectionCard, type TurnOutcome } from '@rauha/core';
import type { TeamIo, TeamSession } from './team-work.js';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('멈춤'));
    });
  });

/** 가짜 분석의 방향 카드: AI 추천은 a */
const FAKE_DIRECTION_CARD: DirectionCard = {
  runId: 'fake',
  title: '결제가 왜 두 번 깎여?',
  symptom: '재시도 때 같은 결제가 두 번 승인돼요.',
  options: [
    { id: 'a', title: '멱등 키를 붙인다', summary: '승인 호출마다 같은 키를 보내 한 번만 처리되게 해요.', pros: ['되돌리기 쉽다', '호출부 변경이 작다'], cons: ['PG사가 키를 지원해야 한다'], risk: '키가 바뀌면 중복을 못 막는다', reversibility: 'easy', touches: ['packages/api/src/pay'] },
    { id: 'b', title: '결제 앞에 락을 건다', summary: '같은 주문은 한 번에 하나만 결제하게 막아요.', pros: ['PG와 무관하다'], cons: ['락이 풀리지 않으면 결제가 멈춘다'], risk: '교착', reversibility: 'medium', touches: ['packages/api/src/order'] },
    { id: 'c', title: '결제 모듈을 새로 만든다', summary: '재시도 구조를 통째로 바꿔요.', pros: ['근본적이다'], cons: ['범위가 크다'], risk: '기존 결제가 깨질 수 있다', reversibility: 'hard', touches: ['packages/api'] },
  ],
  recommendedId: 'a',
  recommendedReason: '되돌리기 쉽고 호출부 변경이 작아요.',
  canGoOn: false,
  docPath: 'docs/analysis/2026-11-08-가짜-분석.md',
};

const FAKE_APPROVAL_CARD: ApprovalCard = {
  runId: 'fake',
  title: '결제가 왜 두 번 깎여?',
  chosen: '',
  goal: '재시도해도 한 번만 결제되게 한다',
  steps: [
    { number: 1, title: '멱등 키 값 객체' },
    { number: 2, title: '승인 호출에 키 붙이기' },
    { number: 3, title: '재시도 때 같은 키 쓰기' },
  ],
  risks: ['PG사가 키를 지원하는지는 확인하지 못했어요'],
  docPath: 'docs/analysis/2026-11-08-가짜-분석.md',
};

/**
 * 확인용 가짜 팀(RAUHA_FAKE_TEAM=1). 실제 Claude를 부르지 않고 단계·역할·허락 요청을 흉내 낸다.
 * 요청에 "허락"이 들어 있으면 중간에 main push 허락을 묻는다.
 * 환경 변수 RAUHA_FAKE_EDIT=1 이고 root 가 있으면 "고치는 중" 단계에서 작업 폴더의 파일을 실제로 바꾼다(변경 보기·되돌리기 확인용).
 */
export function fakeTeam(io: TeamIo, request: string, root?: string): TeamSession {
  return {
    handle: async (): Promise<TurnOutcome> => {
      const step = (role: Parameters<TeamIo['progress']['step']>[1], message: string) => io.progress.step(message, role);
      if (request.includes('분석') && io.user.analysis !== undefined) return fakeAnalysis(io, step);
      step('intake', '요청을 읽는 중');
      await sleep(900, io.signal);
      step('tester', '재현 테스트를 쓰는 중');
      await sleep(1400, io.signal);
      step('implementer', '고치는 중: retry.policy.ts');
      if (root !== undefined && process.env['RAUHA_FAKE_EDIT'] === '1') fakeEdits(root);
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

/** 요청에 "분석"이 들어 있으면 조사 → 방향 비교 → 방향 고르기 카드 → 설계·계획 → 승인 카드까지 흉내 낸다(문서는 쓰지 않는다). */
async function fakeAnalysis(io: TeamIo, step: (role: Parameters<TeamIo['progress']['step']>[1], message: string) => void): Promise<TurnOutcome> {
  const analysis = io.user.analysis!;
  const started = Date.now();
  step('debugger', '원인을 조사하는 중…');
  await sleep(900, io.signal);
  step('debugger', '고치는 방향을 비교하는 중…');
  await sleep(900, io.signal);
  const base = { kind: 'analysis', title: FAKE_DIRECTION_CARD.title, path: FAKE_DIRECTION_CARD.docPath, stopped: true, implemented: null } as const;
  const picked = await analysis.chooseDirection(FAKE_DIRECTION_CARD, io.signal);
  if (picked.kind === 'stop') return { ...base, summary: '(가짜 분석) 방향을 고르지 않아 여기서 멈췄어요.', choice: null, durationMs: Date.now() - started };
  const choice = DirectionSet.of(FAKE_DIRECTION_CARD.options, FAKE_DIRECTION_CARD.recommendedId, FAKE_DIRECTION_CARD.recommendedReason).choose(picked);
  step('designer', '설계와 단계별 계획을 쓰는 중…');
  await sleep(900, io.signal);
  const decided = await analysis.decide({ ...FAKE_APPROVAL_CARD, chosen: choice.chosen }, io.signal);
  const summary = `(가짜 분석) 고른 방향: ${choice.chosen}${choice.divergedFromAi() ? ' (AI 추천과 다르게 골랐어요)' : ''}
${decided.kind === 'proceed' ? '승인해서 구현으로 넘겼어요(가짜라 고치지는 않았어요).' : decided.kind === 'revise' ? `고칠 점을 말하고 멈췄어요: ${decided.note}` : '승인하지 않고 멈췄어요.'}`;
  return { ...base, summary, stopped: decided.kind !== 'proceed', choice: { recommended: choice.recommended, chosen: choice.chosen, reason: choice.reason, diverged: choice.divergedFromAi() }, durationMs: Date.now() - started };
}

/** 확인용 가짜 편집: README.md 수정, src/fake-new.ts 추가, fake-old.txt 삭제(있을 때), .env 변경(비밀 파일은 목록에 안 보여야 한다) */
function fakeEdits(root: string): void {
  appendFileSync(join(root, 'README.md'), '\nAdded by the fake team.\nSecond added line.\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'fake-new.ts'), 'export const fake = 1;\nexport const team = 2;\n');
  if (existsSync(join(root, 'fake-old.txt'))) rmSync(join(root, 'fake-old.txt'));
  writeFileSync(join(root, '.env'), 'FAKE_SECRET=1\n');
}
