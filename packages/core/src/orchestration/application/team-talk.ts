/**
 * 팀원이 다음 팀원에게 넘겨주는 말(순수 규칙). 실제로 일어난 일(정리한 업무, 쓴 테스트, 바뀐 파일, rauha 가 본 검사 결과,
 * 근거가 확인된 리뷰 지적)만 넣는다. 모델을 더 부르지 않고, 없는 일을 지어내지 않는다.
 * 화면은 이 말에 역할 말투를 입혀 팀 대화로 보인다(desktop shared/team-voice.ts).
 */
const LINE_MAX = 200;
const LIST_MAX = 3;

const cut = (text: string, max = LINE_MAX): string => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

const list = (items: readonly string[], unit = '곳'): string => {
  const shown = items.slice(0, LIST_MAX).join(', ');
  const more = items.length - LIST_MAX;
  return more > 0 ? `${shown} 외 ${more}${unit}` : shown;
};

const firstLine = (text: string): string => text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';

export const TeamTalk = {
  briefed(p: { readonly title: string; readonly grade: string; readonly acceptance: number; readonly scope: readonly string[] }): string {
    const scope = p.scope.length > 0 ? ` 범위는 ${list(p.scope)}` : '';
    return cut(`"${p.title}"로 정리했어요. ${p.grade}급, 수용 기준 ${p.acceptance}개.${scope}. 테스트 팀원, 지금은 실패하는 테스트부터 부탁해요`);
  },

  testsWritten(files: readonly string[]): string {
    return cut(`${list(files, '개')}에 테스트를 썼고, 지금은 의도한 이유로 실패해요. 이 테스트는 잠갔어요. 구현 팀원, 통과시켜 주세요`);
  },

  testsRejected(reason: string | null): string {
    return cut(`테스트가 의도한 이유로 실패하지 않았어요${reason !== null && reason.trim() !== '' ? `: ${firstLine(reason)}` : ''}. 다시 쓸게요`);
  },

  implemented(files: readonly string[], decisions: readonly string[]): string {
    if (files.length === 0) return '이번 시도에서는 바뀐 파일이 없어요';
    const why = decisions.length > 0 ? ` 정한 것: ${decisions.slice(0, 2).join(' / ')}` : '';
    return cut(`${list(files, '개')}를 고쳤어요.${why}. 검사 돌려 볼게요`);
  },

  /** escalates: 다음 시도를 더 높은 등급 팀원이 맡는지(진행 글에는 모델 이름을 넣지 않는다) */
  verified(p: { readonly passed: boolean; readonly failure: string | null; readonly escalates: boolean }): string {
    if (p.passed) return '검사가 모두 통과했어요. 리뷰로 넘길게요';
    const why = p.failure !== null && p.failure.trim() !== '' ? `: ${firstLine(p.failure)}` : '';
    const next = p.escalates ? ' 다음 시도는 한 단계 위 팀원이 실패 요약을 받아 이어받아요' : ' 실패 내용을 보고 한 번 더 시도할게요';
    return cut(`검사가 실패했어요${why}.${next}`);
  },

  reviewed(verdict: 'pass' | 'changes', feedback: string | null): string {
    if (verdict === 'pass' || feedback === null) return '근거가 확인된 문제는 없어요. 리뷰 통과예요';
    const items = feedback.split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter((l) => l !== '');
    return cut(`근거가 확인된 지적 ${items.length}개예요. 먼저 "${items[0] ?? ''}". 구현 팀원, 이것만 고쳐 주세요`);
  },
};
