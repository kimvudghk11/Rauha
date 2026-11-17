import { describe, expect, it } from 'vitest';
import { Standup } from './standup.js';

describe('스탠드업 정리', () => {
  it('스탠드업·데일리·어제 한 일·퇴근 정리 같은 말을 알아본다', () => {
    for (const t of ['스탠드업 정리해줘', '데일리 써줘', '어제 한 일 정리', '어제 작업 뭐 했지', '퇴근 전에 오늘 한 일 정리해줘', 'standup please', '일일 보고 만들어줘']) expect(Standup.asks(t)).toBe(true);
    for (const t of ['Money에 할인 넣어줘', '오늘 날씨 어때', '어제 만든 함수 왜 이래?']) expect(Standup.asks(t)).toBe(false);
  });

  it('지난 근무일부터 본다: 월요일이면 지난 금요일, 그 밖에는 어제', () => {
    expect(Standup.since('2026-11-16')).toBe('2026-11-13'); // 월 → 금
    expect(Standup.since('2026-11-17')).toBe('2026-11-16'); // 화 → 월
    expect(Standup.since('2026-11-15')).toBe('2026-11-13'); // 일 → 금
    expect(Standup.since('2026-11-14')).toBe('2026-11-13'); // 토 → 금
  });

  it('저장소마다 내 커밋·브랜치·커밋 안 한 변경 수를 묶는다. 아무 일도 없는 저장소는 빼고 모두 없으면 그렇다고 적는다', () => {
    const block = Standup.block('2026-11-16', [
      { name: 'shop-api', branch: 'feat/refund', dirty: 3, commits: [{ hash: 'a1b2c3d', at: '2026-11-16 18:02', subject: '환불 금액 계산 고침' }] },
      { name: 'quiet', branch: 'main', dirty: 0, commits: [] },
    ]);
    expect(block).toContain('<work_log since="2026-11-16">');
    expect(block).toContain('■ shop-api (브랜치 feat/refund, 커밋 안 한 변경 3개)');
    expect(block).toContain('- a1b2c3d 2026-11-16 18:02 환불 금액 계산 고침');
    expect(block).not.toContain('quiet');
    expect(Standup.block('2026-11-16', [{ name: 'quiet', branch: 'main', dirty: 0, commits: [] }])).toContain('이 기간에 내 커밋과 커밋 안 한 변경이 없어요.');
  });
});
