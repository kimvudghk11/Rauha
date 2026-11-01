import { ROLE_INFO, type MemberRole } from '@rauha/core';
import { formatElapsed } from '../live-line.js';
import type { MascotView } from '../mascot.js';
import type { ChatStore } from './chat-store.js';

/** 질문을 나누고 답하는 팀원. 사용자에게는 한 가지 "작업 중"으로 보이고, 끝나도 줄을 남기지 않는다(답이 곧 결과). */
const QUIET: ReadonlySet<MemberRole> = new Set(['router', 'answerer']);

/** 끝난 뒤 남는 요약에 보이는 단계 수. 되돌아가는 일이 길어져도 줄이 창 너비를 넘지 않게 최근 단계만 보인다. */
const SHOWN_STAGES = 4;
const shownStages = (stages: readonly string[]) => (stages.length > SHOWN_STAGES ? ['…', ...stages.slice(-(SHOWN_STAGES - 1))] : stages).join(' > ');

/**
 * 진행 알림 → 대화 화면. role이 붙은 알림 = 그 팀원이 일을 시작함.
 * 작업 팀원은 줄을 쌓지 않고 한 진행 줄에서 지금 단계만 바꿔 보이고, finish 때 지나온 단계와 걸린 시간을 한 줄로 남긴다.
 */
export function chatProgress(store: ChatStore, view: MascotView | null, now: () => number) {
  let quiet: { role: MemberRole; startedAt: number } | null = null;
  let stages: string[] = [];
  let lastRole: MemberRole | null = null;
  let pipelineStart = 0;

  const stageLabel = (role: MemberRole) => {
    const name = ROLE_INFO[role].stage ?? role;
    const count = stages.filter((s) => s === name || s.startsWith(`${name}(`)).length;
    return count === 0 ? name : `${name}(${count + 1})`;
  };
  const endQuiet = () => {
    if (quiet === null) return;
    store.stopWorking(null);
    quiet = null;
  };
  const finish = () => {
    endQuiet();
    if (stages.length === 0 || lastRole === null) return;
    const text = shownStages(stages);
    const elapsed = formatElapsed(now() - pipelineStart);
    store.stopWorking(view?.done(text, lastRole, elapsed) ?? `  ◆ ${text} ${elapsed}`);
    stages = [];
    lastRole = null;
  };
  return {
    finish,
    step: (message: string, role?: MemberRole) => {
      if (role === undefined) {
        store.print(view?.step(message) ?? `  · ${message}`);
        return;
      }
      if (QUIET.has(role)) {
        // 라우터 → 답변 팀원은 같은 작업 중 줄을 이어 간다.
        if (quiet !== null) return;
        quiet = { role, startedAt: now() };
        store.startWorking('작업 중…', role, quiet.startedAt);
        return;
      }
      endQuiet();
      if (stages.length === 0) pipelineStart = now();
      stages = [...stages, stageLabel(role)];
      lastRole = role;
      // 진행 줄은 같은 자리에서 지금 단계만 바꾼다. 지나온 단계는 끝났을 때 한 줄 요약으로 남는다.
      store.startWorking(`${stages.at(-1)} 중…`, role, now());
    },
  };
}
