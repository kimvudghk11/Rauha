import { describe, expect, it } from 'vitest';
import { keepScroll } from './keep-scroll.js';

describe('keepScroll', () => {
  it('새 화면을 만드는 동안 칸이 빠져 스크롤이 깎여도 처음 보던 자리로 되돌린다', () => {
    const root = { scrollTop: 1200 };
    const restore = keepScroll(root);
    // 다시 쓰는 칸(팀 설정)을 새 화면으로 옮기면 높이가 줄어 브라우저가 스크롤을 깎는다
    root.scrollTop = 1099;
    restore();
    expect(root.scrollTop).toBe(1200);
  });

  it('맨 위에서 보던 화면은 맨 위 그대로다', () => {
    const root = { scrollTop: 0 };
    const restore = keepScroll(root);
    restore();
    expect(root.scrollTop).toBe(0);
  });
});
