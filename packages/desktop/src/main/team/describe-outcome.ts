import type { TurnOutcome } from '@rauha/core';

/** 한 번의 입력 결과 → 채팅 칸에 보일 글. 돈(달러)은 쓰지 않는다. */
export function describeOutcome(turn: TurnOutcome): string {
  switch (turn.kind) {
    case 'answer':
      return turn.answer.trim();
    case 'notice':
      return turn.message;
    case 'blocked':
      return turn.message;
    case 'work': {
      const { outcome } = turn;
      const lines = [outcome.status === 'complete' ? `끝냈어요: ${outcome.title}` : `멈췄어요: ${outcome.title}`];
      const stop = outcome.guide.stopMessage();
      if (stop !== null) lines.push(stop);
      if (outcome.changedInRun.length > 0) lines.push(`고친 파일 ${outcome.changedInRun.length}개 — ${outcome.changedInRun.map((c) => c.path).join(', ')}`);
      if (outcome.testless === true) lines.push('이 프로젝트에서는 테스트를 실행할 수 없어서 테스트 없이 구현하고 타입 검사와 리뷰로만 확인했어요. 직접 한 번 실행해 보세요.');
      const mine = outcome.userFiles ?? [];
      if (mine.length > 0) lines.push(`내가 커밋하지 않은 변경 ${mine.length}개 위에서 일했어요.`);
      const mixed = outcome.mixedFiles ?? [];
      if (mixed.length > 0) lines.push(`이 파일은 내 변경과 rauha의 변경이 섞여 있어요: ${mixed.join(', ')}`);
      const decided = outcome.assumptions.filter((a) => !a.confirmed).map((a) => `${a.question} → ${a.chosen}`);
      if (decided.length > 0) lines.push('알아서 정한 것', ...decided.map((d) => `- ${d}`));
      const todo = outcome.facts.unconfirmed.map((c) => c.text);
      if (todo.length > 0) lines.push('확인이 필요한 것', ...todo.map((t) => `- ${t}`));
      return lines.join('\n');
    }
    case 'review': {
      if (turn.files.length === 0) return '검토할 변경이 없어요.';
      const verified = turn.checked.filter((c) => !c.isGuess);
      return [`변경 ${turn.files.length}개 파일을 검토했어요.`, turn.summary, ...(verified.length > 0 ? verified.map((c) => `- ${c.text}`) : ['근거가 확인된 문제는 없어요.'])].filter((l) => l !== '').join('\n');
    }
    case 'analysis':
      return [turn.summary, ...(turn.implemented === null ? [] : [describeOutcome({ kind: 'work', outcome: turn.implemented })])].join('\n\n');
    case 'design':
      return [`설계 "${turn.title}"를 마쳤어요.`, ...turn.tasks.map((t) => `- ${t.title}`)].join('\n');
    case 'repos':
      return turn.repos.map((r) => `${r.repo}: ${r.status === 'complete' ? '끝' : r.status === 'stopped' ? '멈춤' : '건너뜀'}`).join('\n');
  }
}
