import { describe, expect, it } from 'vitest';
import { statusLine, usageLines } from './usage-view.js';

const plan = {
  plan: 'pro',
  session: { percent: 83, resetsAt: '2026-10-25T13:50:00Z' },
  weekly: { percent: 21, resetsAt: '2026-10-31T18:00:00Z' },
};
const now = new Date('2026-10-25T10:00:00Z');
const seoul = 'Asia/Seoul';

describe('usageLines', () => {
  it('세션과 주간 사용률을 막대와 퍼센트, 초기화 시각으로 보여 준다 (Claude /usage처럼)', () => {
    const lines = usageLines(plan, { calls: { sonnet: 2, opus: 3, fable: 0 }, costUsd: 0.12 }, now, seoul);
    const text = lines.join('\n');
    expect(text).toMatch(/세션.*▄{17}▁{3} +83%/);
    expect(text).toMatch(/주간.*▄{4}▁{16} +21%/);
    // 오늘 풀리면 시각만, 다른 날이면 날짜까지
    expect(text).toContain('오후 10:50에 초기화');
    expect(text).toContain('11월 1일 (일) 오전 3:00에 초기화');
  });

  it('색을 입히는 막대 함수를 받으면 그것으로 그린다 (사용률이 높으면 색이 달라진다)', () => {
    const lines = usageLines(plan, { calls: { sonnet: 0, opus: 0, fable: 0 }, costUsd: 0 }, now, seoul, (percent, cells) => `<${percent}/${cells}>`);
    const text = lines.join('\n');
    expect(text).toContain('<83/20> ');
    expect(text).toContain('<21/20> ');
  });

  it('이번 대화 호출 수만 쓰고 달러 비용은 쓰지 않는다 (구독으로 쓰는 사람에게 의미가 없다)', () => {
    const text = usageLines(plan, { calls: { sonnet: 2, opus: 3, fable: 0 }, costUsd: 0.12 }, now, seoul).join('\n');
    expect(text).toContain('sonnet 2회');
    expect(text).toContain('opus 3회');
    expect(text).not.toContain('fable');
    expect(text).not.toContain('$');
    expect(text).not.toContain('요금');
  });

  it('사용률을 읽지 못하면 그렇다고 말한다', () => {
    expect(usageLines(null, { calls: { sonnet: 0, opus: 0, fable: 0 }, costUsd: 0 }, now, seoul).join('\n')).toContain('사용률을 확인하지 못했어요');
  });
});

describe('statusLine', () => {
  it('프로필 · 세션 · 주간 · 브랜치를 한 줄로', () => {
    expect(statusLine('[personal]', plan, 'main')).toBe('[personal] · 세션 83% · 주간 21% · main');
  });

  it('막대 함수를 받으면 짧은 막대를 퍼센트 앞에 붙인다', () => {
    expect(statusLine('[personal]', plan, 'main', (percent, cells) => `<${percent}/${cells}>`)).toBe('[personal] · 세션 <83/6> 83% · 주간 <21/6> 21% · main');
  });

  it('모르는 값은 빼고 쓴다', () => {
    expect(statusLine('[personal]', null, null)).toBe('[personal]');
  });

  it('여러 저장소 작업 공간이면 지금 저장소 이름을 브랜치 앞에 보여 준다', () => {
    expect(statusLine('[personal]', null, 'main', undefined, 'shop-api')).toBe('[personal] · shop-api main');
  });
});
