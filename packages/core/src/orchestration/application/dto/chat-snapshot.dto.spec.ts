import { describe, expect, it } from 'vitest';
import { ChatSnapshotDto, type ChatSnapshot } from './chat-snapshot.dto.js';

const snapshot: ChatSnapshot = {
  version: 1,
  turns: [{ input: 'Money에 할인 넣어줘', result: '작업 "할인" 완료' }],
  carried: [['src/money.ts', 'modified:h1']],
  lastTitle: '할인',
  savedAt: '2026-10-27T10:00:00.000Z',
};

describe('ChatSnapshotDto', () => {
  it('저장한 대화를 그대로 되읽는다', () => {
    const json = ChatSnapshotDto.of(snapshot).toJson();
    expect(ChatSnapshotDto.from(JSON.parse(json))?.value).toEqual(snapshot);
  });

  it('깨진 내용이나 옛 형식은 null', () => {
    for (const bad of [null, 'x', { ...snapshot, version: 2 }, { ...snapshot, turns: 'x' }, { ...snapshot, carried: [['a']] }, { ...snapshot, lastTitle: 3 }]) {
      expect(ChatSnapshotDto.from(bad)).toBeNull();
    }
  });

  it('앞 답 세션도 그대로 되읽고, 없는 옛 파일도 읽는다', () => {
    const withSession: ChatSnapshot = { ...snapshot, answerSession: { id: 's1', tier: 'sonnet', at: 1_000, count: 2 } };
    expect(ChatSnapshotDto.from(JSON.parse(ChatSnapshotDto.of(withSession).toJson()))?.value).toEqual(withSession);
    expect(ChatSnapshotDto.from(JSON.parse(ChatSnapshotDto.of(snapshot).toJson()))?.value).not.toHaveProperty('answerSession');
  });

  it('바로 앞 답(더 깊게용)도 되읽고, 모양이 틀리면 그 칸만 버린다', () => {
    const withLast: ChatSnapshot = { ...snapshot, lastAnswer: { id: 'l1', key: 'rest가 뭐야?' } };
    expect(ChatSnapshotDto.from(JSON.parse(ChatSnapshotDto.of(withLast).toJson()))?.value).toEqual(withLast);
    expect(ChatSnapshotDto.from({ ...snapshot, lastAnswer: { id: '', key: 'x' } })?.value).not.toHaveProperty('lastAnswer');
  });

  it('앞 답 세션 모양이 틀리면 그 칸만 버리고 대화는 살린다', () => {
    for (const bad of [{ id: '', tier: 'sonnet', at: 1, count: 0 }, { id: 's', tier: 'haiku', at: 1, count: 0 }, { id: 's', tier: 'opus', at: 'x', count: 0 }, { id: 's', tier: 'opus', at: 1, count: -1 }, 'x']) {
      const read = ChatSnapshotDto.from({ ...snapshot, answerSession: bad });
      expect(read?.value.turns).toEqual(snapshot.turns);
      expect(read?.value).not.toHaveProperty('answerSession');
    }
  });
});
