import { describe, expect, it } from 'vitest';
import { ChatHistory } from './chat-history.js';
import { ChatHistoryDto } from './chat-history-dto.js';
import { restoredView } from './chat-history-view.js';

const ok = { id: 'a', request: '요청', status: 'done', stopReason: null, result: '결과', toolsLine: null, cast: ['intake', 'nobody'], queuedAt: 't0', endedAt: 't1' };

describe('ChatHistoryDto', () => {
  it('저장한 모양을 그대로 다시 읽는다', () => {
    const history = ChatHistoryDto.from({ jobs: [ok] }).toEntity();
    const again = ChatHistoryDto.from(ChatHistoryDto.fromEntity(history)).toEntity();
    expect(again.items[0]).toMatchObject({ id: 'a', request: '요청', result: '결과' });
    expect(ChatHistoryDto.fromEntity(ChatHistory.empty()).jobs).toEqual([]);
  });

  it('예전 파일(thread 칸 없음)은 이어진 작업이 아닌 것으로 읽는다', () => {
    expect(ChatHistoryDto.from({ jobs: [ok] }).toEntity().items[0]).toMatchObject({ thread: null, inTask: false });
  });
  it('태스크 안에서 이어 물은 작업은 묶음(thread)과 inTask 를 그대로 다시 읽는다', () => {
    const history = ChatHistoryDto.from({ jobs: [ok, { ...ok, id: 'b', thread: 'a', inTask: true }, { ...ok, id: 'c', thread: '', inTask: true }] }).toEntity();
    const again = ChatHistoryDto.from(ChatHistoryDto.fromEntity(history)).toEntity().items;
    expect(again[1]).toMatchObject({ id: 'b', thread: 'a', inTask: true });
    // 빈 thread 는 묶음 없음, 그러면 inTask 도 false
    expect(again[2]).toMatchObject({ id: 'c', thread: null, inTask: false });
  });
  it('모르는 역할 이름은 버린다', () => {
    expect(ChatHistoryDto.from({ jobs: [ok] }).toEntity().items[0]?.cast).toEqual(['intake']);
  });

  it('팀 대화(talk)를 다시 읽고, 모르는 역할·깨진 줄은 버리며, 예전 파일(talk 없음)은 빈 대화다', () => {
    const talk = [{ role: 'intake', message: '작업 중…' }, { role: 'tester', message: '테스트 쓰기' }, { role: 'nobody', message: 'x' }, { role: 'tester' }, 3];
    const again = ChatHistoryDto.from(ChatHistoryDto.fromEntity(ChatHistoryDto.from({ jobs: [{ ...ok, talk }] }).toEntity())).toEntity().items[0];
    expect(again?.talk).toEqual([{ role: 'intake', message: '작업 중…' }, { role: 'tester', message: '테스트 쓰기' }]);
    expect(ChatHistoryDto.from({ jobs: [ok] }).toEntity().items[0]?.talk).toEqual([]);
  });

  it('복원한 일은 팀 대화를 진행 줄로 다시 그린다', () => {
    const [entry] = ChatHistoryDto.from({ jobs: [{ ...ok, talk: [{ role: 'debugger', message: '원인 찾기' }] }] }).toEntity().restored();
    const view = restoredView(entry!);
    expect(view.notes).toEqual([{ role: 'debugger', roleName: '디버깅 팀원', message: '원인 찾기', at: 't0' }]);
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
