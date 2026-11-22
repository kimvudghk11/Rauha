import { describe, expect, it } from 'vitest';
import { RequestCoverage, type Ask } from './request-coverage.js';

const ask = (text: string, status: Ask['status'], note = '', needs = ''): Ask => ({ ask: text, status, note, needs });

describe('요청 항목 표', () => {
  it('사용자에게 필요한 것이 없는데 덜 된 항목만 팀이 이어서 할 일이다', () => {
    const c = RequestCoverage.of([ask('A', 'done'), ask('B', 'partial', '시간 부족'), ask('C', 'not_done', '권한 없음', '관리자 권한')], [], []);
    expect(c.canContinue().map((a) => a.ask)).toEqual(['B']);
    expect(c.unfinished().map((a) => a.ask)).toEqual(['B', 'C']);
  });

  it('계획한 곳은 실제로 연 경로 안에 그 경로 조각이 있어야 본 것으로 친다(슬래시·대소문자·끝의 /** 무시)', () => {
    const opened = ['E:\\rauha\\packages\\core\\src\\money.ts', 'e:/work/bridge-backend', 'src/cart'];
    const c = RequestCoverage.of([], opened, ['packages/core/**', 'bridge-backend', './src/cart/', 'packages/cli', 'core/sr']);
    expect(c.unopened()).toEqual(['packages/cli', 'core/sr']);
  });

  it('이어 하기 요청에는 덜 된 항목과 안 본 곳이 들어가고, 이어 할 것이 없으면 null', () => {
    const c = RequestCoverage.of([ask('B', 'partial', '시간 부족')], [], ['packages/legacy']);
    const prompt = c.followUp();
    expect(prompt).toContain('- B (일부: 시간 부족)');
    expect(prompt).toContain('- packages/legacy');
    expect(RequestCoverage.of([ask('A', 'done')], [], []).followUp()).toBeNull();
    expect(RequestCoverage.of([ask('C', 'not_done', '권한 없음', '관리자 권한')], [], []).followUp()).toBeNull();
  });

  it('빈 이름의 항목·계획은 버리고, 같은 계획은 한 번만 센다', () => {
    const c = RequestCoverage.of([ask('  ', 'done')], [], ['a', 'a/', '  ']);
    expect(c.asks).toEqual([]);
    expect(c.unopened()).toEqual(['a']);
  });
});
