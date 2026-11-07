import { describe, expect, it } from 'vitest';
import { TABS } from './tabs.js';

describe('TABS', () => {
  it('탭 순서는 채팅·코드·할 일·기록·레포·명령어·규칙이고 설정은 맨 아래다', () => {
    expect(TABS.filter((t) => !t.bottom).map((t) => t.label)).toEqual(['채팅', '코드', '할 일', '기록', '레포', '명령어', '규칙']);
    expect(TABS.filter((t) => t.bottom).map((t) => t.label)).toEqual(['설정']);
  });

  it('지금은 채팅 탭만 열리고 나머지는 곧', () => {
    expect(TABS.filter((t) => t.ready).map((t) => t.id)).toEqual(['chat']);
  });
});
