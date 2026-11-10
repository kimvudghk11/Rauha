import { describe, expect, it } from 'vitest';
import { ChatHistory } from './chat-history.js';
import { ChatHistoryDto } from './chat-history-dto.js';

const ok = { id: 'a', request: '요청', status: 'done', stopReason: null, result: '결과', toolsLine: null, cast: ['intake', 'nobody'], queuedAt: 't0', endedAt: 't1' };

describe('ChatHistoryDto', () => {
  it('저장한 모양을 그대로 다시 읽는다', () => {
    const history = ChatHistoryDto.from({ jobs: [ok] }).toEntity();
    const again = ChatHistoryDto.from(ChatHistoryDto.fromEntity(history)).toEntity();
    expect(again.items[0]).toMatchObject({ id: 'a', request: '요청', result: '결과' });
    expect(ChatHistoryDto.fromEntity(ChatHistory.empty()).jobs).toEqual([]);
  });

  it('모르는 역할 이름은 버린다', () => {
    expect(ChatHistoryDto.from({ jobs: [ok] }).toEntity().items[0]?.cast).toEqual(['intake']);
  });

  it('깨진 항목은 건너뛰고 센다', () => {
    const dto = ChatHistoryDto.from({ jobs: [ok, { id: 'b' }, 7, { ...ok, id: 'c', status: 'weird' }] });
    expect(dto.toEntity().items).toHaveLength(1);
    expect(dto.skipped).toBe(3);
  });

  it('jobs 배열이 없으면 빈 기록이고 깨진 것으로 센다', () => {
    const dto = ChatHistoryDto.from('엉뚱');
    expect(dto.toEntity().isEmpty).toBe(true);
    expect(dto.skipped).toBe(1);
  });
});
