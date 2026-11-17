import { describe, expect, it } from 'vitest';
import { RequestCoverage, type Ask } from './request-coverage.js';

const ask = (text: string, status: Ask['status'], note = '', needs = ''): Ask => ({ ask: text, status, note, needs });

describe('요청 항목 표', () => {
  it('항목이 하나뿐이고 끝났고 안 본 곳이 없으면 표를 보이지 않는다(작은 질문에 소음을 만들지 않는다)', () => {
    expect(RequestCoverage.of([ask('포트 확인', 'done')], [], []).toText()).toBe('');
    expect(RequestCoverage.of([], [], []).toText()).toBe('');
  });

  it('항목이 둘 이상이면 끝난 수와 항목마다 상태를 보인다', () => {
    const text = RequestCoverage.of([ask('결제 흐름 정리', 'done', 'docs/payment.md'), ask('환불 정책', 'partial', '부분 환불 규칙은 코드에 없음')], [], []).toText();
    expect(text).toContain('■ 요청 항목 (2개 중 1개 끝남)');
    expect(text).toContain('- ✓ 결제 흐름 정리: docs/payment.md');
    expect(text).toContain('- △ 환불 정책 (일부): 부분 환불 규칙은 코드에 없음');
  });

  it('못 한 항목은 이유와 사용자가 주면 되는 것을 함께 보인다', () => {
    const text = RequestCoverage.of([ask('운영 DB 주문 수', 'not_done', '이 컴퓨터에서 운영 DB에 접속할 수 없음', '읽기 전용 접속 정보')], [], []).toText();
    expect(text).toContain('- ✗ 운영 DB 주문 수: 이 컴퓨터에서 운영 DB에 접속할 수 없음');
    expect(text).toContain('주시면 확인할 수 있어요: 읽기 전용 접속 정보');
  });

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

  it('계획했지만 열지 않은 곳은 표에 "안 본 곳"으로 보인다', () => {
    const text = RequestCoverage.of([ask('A', 'done')], [], ['packages/legacy']).toText();
    expect(text).toContain('■ 안 본 곳');
    expect(text).toContain('- packages/legacy');
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
