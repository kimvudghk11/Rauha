import { describe, expect, it } from 'vitest';
import { actionsNotice, approvalNotice, jobOverNotice, limitNotice } from './notice-text.js';

const at = (min: number): string => new Date(Date.UTC(2026, 10, 15, 1, 0) + min * 60_000).toISOString();
const job = (o: Partial<Parameters<typeof jobOverNotice>[0]> = {}): Parameters<typeof jobOverNotice>[0] => ({
  request: '결제 타임아웃 원인 찾아줘',
  status: 'done',
  stopReason: null,
  queuedAt: at(0),
  endedAt: at(12),
  deep: false,
  knowledgeMissing: false,
  ...o,
});

describe('작업이 끝난 알림', () => {
  it('끝난 작업은 걸린 시간과 요청을 보여 준다', () => {
    expect(jobOverNotice(job())).toEqual({ title: '작업이 끝났어요 · 12분', body: '결제 타임아웃 원인 찾아줘' });
  });

  it('1분 안에 끝나면 금방 끝났다고 한다', () => {
    expect(jobOverNotice(job({ endedAt: at(0.5) }))?.title).toBe('금방 끝났어요');
  });

  it('한 시간이 넘으면 시간과 분으로 적는다', () => {
    expect(jobOverNotice(job({ endedAt: at(65) }))?.title).toBe('오래 걸린 작업이 끝났어요 · 1시간 5분');
  });

  it('깊게 다시 본 작업은 깊은 답이 나왔다고 한다', () => {
    expect(jobOverNotice(job({ deep: true }))?.title).toBe('깊게 다시 본 답이 나왔어요 · 12분');
  });

  it('저장소를 못 읽고 답했으면 본문에 덧붙인다', () => {
    expect(jobOverNotice(job({ knowledgeMissing: true }))?.body).toBe('결제 타임아웃 원인 찾아줘\n저장소를 다 읽지 못하고 답했어요. 확인해 주세요.');
  });

  it('긴 요청은 60자에서 자른다', () => {
    expect(jobOverNotice(job({ request: '가'.repeat(80) }))?.body).toBe(`${'가'.repeat(59)}…`);
  });

  it('여러 줄 요청은 첫 줄만 쓴다', () => {
    expect(jobOverNotice(job({ request: '첫 줄\n둘째 줄' }))?.body).toBe('첫 줄');
  });

  it('내가 멈춘 작업은 알리지 않는다', () => {
    expect(jobOverNotice(job({ status: 'stopped', stopReason: '사용자가 멈춤' }))).toBeNull();
  });

  it('한도 때문에 멈추면 한도에 걸렸다고 한다', () => {
    expect(jobOverNotice(job({ status: 'stopped', stopReason: 'usage limit reached' }))?.title).toBe('한도에 걸려 작업이 멈췄어요');
  });

  it('로그인이 풀려 멈추면 다시 로그인하라고 한다', () => {
    expect(jobOverNotice(job({ status: 'stopped', stopReason: 'Not logged in · Please run /login' }))).toEqual({ title: '로그인이 풀려 작업이 멈췄어요', body: '결제 타임아웃 원인 찾아줘\nSettings › Account 에서 다시 로그인해 주세요.' });
  });

  it('그 밖의 이유로 멈추면 이유를 한 줄로 붙인다', () => {
    expect(jobOverNotice(job({ status: 'stopped', stopReason: 'ENOENT: no such file' }))).toEqual({ title: '작업이 중간에 멈췄어요', body: '결제 타임아웃 원인 찾아줘\n이유: ENOENT: no such file' });
  });
});

describe('허락·선택 알림', () => {
  it('허락은 무엇을 허락할지와 어느 작업인지 보여 준다', () => {
    expect(approvalNotice({ kind: 'approval', headline: 'main 에 push', request: '결제 고치기', waiting: 1 })).toEqual({ title: '허락이 필요해요', body: 'main 에 push\n작업: 결제 고치기' });
  });

  it('선택은 팀이 고를 것을 기다린다고 한다', () => {
    expect(approvalNotice({ kind: 'choice', headline: '방향 3개 중 고르기', request: null, waiting: 1 })).toEqual({ title: '팀이 내 선택을 기다려요', body: '방향 3개 중 고르기' });
  });

  it('여러 개가 기다리면 몇 개인지 제목에 붙인다', () => {
    expect(approvalNotice({ kind: 'approval', headline: 'x', request: null, waiting: 3 }).title).toBe('허락이 필요해요 · 3개 기다리는 중');
  });
});

describe('한도 알림', () => {
  const now = new Date(Date.UTC(2026, 10, 15, 1, 0));
  it('90% 아래면 알리지 않는다', () => {
    expect(limitNotice({ session: { percent: 70, resetsAt: null }, weekly: { percent: 40, resetsAt: null }, now })).toBeNull();
  });

  it('세션 한도가 90%를 넘으면 퍼센트와 풀리는 때를 알린다', () => {
    expect(limitNotice({ session: { percent: 92.4, resetsAt: at(100) }, weekly: null, now })).toEqual({ level: 'near', title: '이번 세션 한도 92% 썼어요', body: '1시간 40분 뒤에 풀려요. 새 작업은 꼭 필요한 것만 맡기세요.' });
  });

  it('주간 한도가 더 높으면 주간 한도로 알린다', () => {
    expect(limitNotice({ session: { percent: 91, resetsAt: null }, weekly: { percent: 95, resetsAt: null }, now })?.title).toBe('이번 주 한도 95% 썼어요');
  });

  it('100%면 새 작업이 막혔다고 한다', () => {
    expect(limitNotice({ session: { percent: 100, resetsAt: at(30) }, weekly: null, now })).toEqual({ level: 'full', title: '이번 세션 한도를 다 썼어요', body: '30분 뒤에 풀려요. 그때까지 새 작업은 시작되지 않아요.' });
  });

  it('풀리는 때를 모르면 그 말은 빼고 알린다', () => {
    expect(limitNotice({ session: { percent: 90, resetsAt: null }, weekly: null, now })?.body).toBe('새 작업은 꼭 필요한 것만 맡기세요.');
  });
});

describe('GitHub Actions 알림', () => {
  it('실패는 제목에 실패를, 본문에 워크플로·브랜치·시간을 적는다', () => {
    expect(actionsNotice({ workflow: 'CI', branch: 'main', verdict: 'failure', durationSec: 192 })).toEqual({ title: 'GitHub Actions 실패 · main', body: 'CI · 3분 12초 만에 실패했어요. 로그를 확인해 주세요.' });
  });

  it('성공은 통과했다고 한다', () => {
    expect(actionsNotice({ workflow: 'release', branch: 'v0.2.18', verdict: 'success', durationSec: 40 })).toEqual({ title: 'GitHub Actions 통과 · v0.2.18', body: 'release · 40초 만에 통과했어요.' });
  });

  it('취소는 취소됐다고 한다', () => {
    expect(actionsNotice({ workflow: 'CI', branch: 'main', verdict: 'cancelled', durationSec: null }).title).toBe('GitHub Actions 취소됨 · main');
  });
});
