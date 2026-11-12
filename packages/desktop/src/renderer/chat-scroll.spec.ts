import { describe, expect, it } from 'vitest';
import { ChatScroll } from './chat-scroll.js';

describe('ChatScroll', () => {
  it('처음에는 맨 아래에 붙어 있다', () => {
    expect(ChatScroll.start().pinned).toBe(true);
  });

  it('맨 아래에서 조금(40px 안) 떨어진 것은 여전히 맨 아래로 본다', () => {
    const s = ChatScroll.start();
    s.observe({ top: 470, client: 500, height: 1000 });
    expect(s.pinned).toBe(true);
  });

  it('위로 올려 읽고 있으면 맨 아래가 아니다', () => {
    const s = ChatScroll.start();
    s.observe({ top: 200, client: 500, height: 1000 });
    expect(s.pinned).toBe(false);
  });

  it('다른 탭에 다녀와도 맨 아래에 있었으면 새 내용까지 포함한 맨 아래로 돌아간다', () => {
    const s = ChatScroll.start();
    s.observe({ top: 500, client: 500, height: 1000 });
    expect(s.restoreTop({ client: 500, height: 1600 })).toBe(1100);
  });

  it('다른 탭에 다녀와도 위로 올려 읽던 자리는 그대로 돌아간다', () => {
    const s = ChatScroll.start();
    s.observe({ top: 200, client: 500, height: 1000 });
    expect(s.restoreTop({ client: 500, height: 1000 })).toBe(200);
  });

  it('내용이 화면보다 짧으면 맨 아래 위치는 0이다', () => {
    expect(ChatScroll.start().restoreTop({ client: 500, height: 300 })).toBe(0);
  });
});
