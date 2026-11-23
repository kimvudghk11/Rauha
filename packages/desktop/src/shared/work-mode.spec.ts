import { describe, expect, it } from 'vitest';
import { WorkMode } from './work-mode.js';

describe('메인 채팅이 팀 흐름으로 가는 때', () => {
  it('보통 말은 원문 그대로 Claude 에 간다', () => {
    expect(WorkMode.of('todo에 있는 내용 확인해줘')).toEqual({ team: false, text: 'todo에 있는 내용 확인해줘' });
    expect(WorkMode.of('backend 테스트 먼저 쓰고 구현해줘')).toEqual({ team: false, text: 'backend 테스트 먼저 쓰고 구현해줘' });
  });

  it('/work 로 시작할 때만 팀 흐름(테스트 먼저·구현·리뷰)으로 가고, 명령어는 빼고 넘긴다', () => {
    expect(WorkMode.of('/work 결제 타임아웃 고쳐줘')).toEqual({ team: true, text: '결제 타임아웃 고쳐줘' });
    expect(WorkMode.of('  /WORK\n할인 넣어줘')).toEqual({ team: true, text: '할인 넣어줘' });
  });

  it('/work 뒤에 할 말이 없거나 다른 단어의 일부면 보통 말이다', () => {
    expect(WorkMode.of('/work')).toEqual({ team: false, text: '/work' });
    expect(WorkMode.of('/workspace 열어줘')).toEqual({ team: false, text: '/workspace 열어줘' });
  });
});
