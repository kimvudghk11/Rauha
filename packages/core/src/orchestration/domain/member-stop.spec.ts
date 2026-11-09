import { describe, expect, it } from 'vitest';
import { MemberStop } from './member-stop.js';

describe('MemberStop', () => {
  it('정상으로 끝나고 거절도 없으면 멈춘 이유가 없다', () => {
    expect(MemberStop.of({ endReason: 'success', denials: [], turns: 3 })).toBeNull();
    expect(MemberStop.of({ endReason: 'completed', denials: [], turns: 3 })).toBeNull();
  });

  it('우리 쪽 오류(error)는 이유를 지어내지 않는다', () => {
    expect(MemberStop.of({ endReason: 'error', denials: [], turns: 0 })).toBeNull();
  });

  it('턴 한도에 닿으면 한 턴 수와 "이어서" 안내를 말한다', () => {
    for (const endReason of ['error_max_turns', 'max_turns']) {
      const text = MemberStop.of({ endReason, denials: [], turns: 25 })!.sentence();
      expect(text).toContain('턴 한도');
      expect(text).toContain('25');
      expect(text).toContain('이어서');
    }
  });

  it('사용량 한도에 닿으면 달러 없이 이어서 안내를 말한다', () => {
    const text = MemberStop.of({ endReason: 'error_max_budget_usd', denials: [], turns: 9 })!.sentence();
    expect(text).toContain('사용량 한도');
    expect(text).toContain('이어서');
    expect(text).not.toMatch(/\$|달러/);
  });

  it('허락되지 않은 도구는 도구별 횟수로 알린다', () => {
    const text = MemberStop.of({ endReason: 'success', denials: ['Bash: {"command":"ls"}', 'Bash: {"command":"rm"}', 'Write: {}'], turns: 4 })!.sentence();
    expect(text).toContain('Bash 호출 2번');
    expect(text).toContain('Write 호출 1번');
    expect(text).toContain('허락되지 않아');
  });

  it('SDK가 준 다른 종료 이유는 그 이름을 그대로 보인다', () => {
    expect(MemberStop.of({ endReason: 'model_error', denials: [], turns: 2 })!.sentence()).toContain('model_error');
  });

  it('부분 결과가 있으면 버리지 않고 글에 붙인다', () => {
    const stop = MemberStop.of({ endReason: 'error_max_turns', denials: [], turns: 25 })!;
    const text = stop.report('여기까지 읽었어요: a.ts');
    expect(text).toContain('턴 한도');
    expect(text).toContain('여기까지 읽었어요: a.ts');
    expect(stop.report(null)).not.toContain('그때까지');
  });

  it('다음 대화에 남기는 글에 멈춘 이유와 마지막으로 한 일이 든다', () => {
    const note = MemberStop.of({ endReason: 'error_max_turns', denials: [], turns: 25 })!.turnNote('b.ts를 고치는 중이었어요');
    expect(note).toContain('턴 한도');
    expect(note).toContain('마지막으로 한 일: b.ts를 고치는 중이었어요');
  });
});
