import { describe, expect, it } from 'vitest';
import { TeamTalk } from './team-talk.js';

describe('TeamTalk — 팀원이 넘겨주는 말(실제로 일어난 일만)', () => {
  it('팀장은 정리한 업무 제목·난이도·수용 기준 수·범위를 말하고 테스트 팀원에게 넘긴다', () => {
    const line = TeamTalk.briefed({ title: 'Money 할인 추가', grade: 'M', acceptance: 3, scope: ['src/money.ts', 'src/cart.ts'] });
    expect(line).toContain('Money 할인 추가');
    expect(line).toContain('M급');
    expect(line).toContain('수용 기준 3개');
    expect(line).toContain('src/money.ts');
    expect(line).toContain('테스트');
  });

  it('범위가 많으면 앞의 몇 개와 남은 개수만 말한다', () => {
    const line = TeamTalk.briefed({ title: 't', grade: 'S', acceptance: 1, scope: ['a', 'b', 'c', 'd', 'e'] });
    expect(line).toContain('외 2곳');
  });

  it('테스트가 올바른 이유로 실패하면 쓴 테스트 파일을 말하고 구현 팀원에게 넘긴다', () => {
    const line = TeamTalk.testsWritten(['tests/money.spec.ts']);
    expect(line).toContain('tests/money.spec.ts');
    expect(line).toContain('실패');
    expect(line).toContain('구현');
  });

  it('테스트가 제대로 실패하지 않았으면 rauha 가 본 이유를 그대로 말하고 다시 쓴다고 한다', () => {
    const line = TeamTalk.testsRejected('import 오류로 실패했어요: Cannot find module');
    expect(line).toContain('Cannot find module');
    expect(line).toContain('다시');
  });

  it('구현 팀원은 고친 파일과 자기가 한 결정을 말한다', () => {
    const line = TeamTalk.implemented(['src/money.ts'], ['할인은 내림으로 계산']);
    expect(line).toContain('src/money.ts');
    expect(line).toContain('할인은 내림으로 계산');
  });

  it('고친 파일이 없으면 없다고 말한다(지어내지 않는다)', () => {
    expect(TeamTalk.implemented([], [])).toContain('바뀐 파일이 없');
  });

  it('검증이 통과하면 리뷰로 넘기고, 실패하면 rauha 가 본 첫 실패 줄과 누가 이어받는지 말한다(모델 이름은 넣지 않는다)', () => {
    expect(TeamTalk.verified({ passed: true, failure: null, escalates: false })).toContain('통과');
    const failed = TeamTalk.verified({ passed: false, failure: 'FAIL money.spec.ts > 할인\nexpected 90 to be 900', escalates: true });
    expect(failed).toContain('FAIL money.spec.ts > 할인');
    expect(failed).not.toContain('expected 90');
    expect(failed).toContain('한 단계 위');
    expect(failed).not.toMatch(/sonnet|opus|fable/);
  });

  it('리뷰어는 근거가 확인된 지적 수와 첫 지적을, 없으면 통과를 말한다', () => {
    expect(TeamTalk.reviewed('pass', null)).toContain('통과');
    const line = TeamTalk.reviewed('changes', '- 할인율 0 이하를 막지 않아요 (src/money.ts:3)\n- 이름이 어색해요');
    expect(line).toContain('2개');
    expect(line).toContain('할인율 0 이하를 막지 않아요');
  });

  it('긴 글은 한 줄 길이로 자른다', () => {
    expect(TeamTalk.testsRejected('x'.repeat(1000)).length).toBeLessThan(260);
  });
});
