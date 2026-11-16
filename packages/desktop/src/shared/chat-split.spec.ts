import { describe, expect, it } from 'vitest';
import { ChatSplit } from './chat-split.js';

describe('ChatSplit — Main · 팀 목록 비율', () => {
  it('저장한 값이 없으면 Main 7 · 팀 3 으로 시작한다', () => {
    expect(ChatSplit.fromStored(null).mainPercent).toBe(70);
  });

  it('저장한 값이 숫자가 아니면 기본값으로 시작한다', () => {
    expect(ChatSplit.fromStored('abc').mainPercent).toBe(70);
  });

  it('저장한 값이 범위를 벗어나면 범위 안으로 당긴다', () => {
    expect(ChatSplit.fromStored('5').mainPercent).toBe(ChatSplit.MIN);
    expect(ChatSplit.fromStored('99').mainPercent).toBe(ChatSplit.MAX);
  });

  it('끌어 놓은 자리(왼쪽에서 떨어진 거리 / 전체 폭)로 Main 비율을 정한다', () => {
    expect(ChatSplit.fromDrag(600, 1000).mainPercent).toBe(60);
  });

  it('끌어서도 Main 이 너무 좁거나 팀 목록이 사라질 만큼 넓어지지 않는다', () => {
    expect(ChatSplit.fromDrag(10, 1000).mainPercent).toBe(ChatSplit.MIN);
    expect(ChatSplit.fromDrag(990, 1000).mainPercent).toBe(ChatSplit.MAX);
  });

  it('폭을 알 수 없으면(0) 기본값', () => {
    expect(ChatSplit.fromDrag(100, 0).mainPercent).toBe(70);
  });

  it('키보드로 한 칸씩 옮길 수 있다(범위 안에서)', () => {
    expect(ChatSplit.fromStored('70').nudge(5).mainPercent).toBe(75);
    expect(ChatSplit.fromStored(String(ChatSplit.MAX)).nudge(5).mainPercent).toBe(ChatSplit.MAX);
  });

  it('CSS 칸 비율과 저장 값으로 바꾼다', () => {
    const s = ChatSplit.fromDrag(650, 1000);
    expect(s.columns()).toEqual({ main: '65fr', rooms: '35fr' });
    expect(s.toStored()).toBe('65');
  });
});
