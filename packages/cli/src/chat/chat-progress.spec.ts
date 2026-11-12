import { describe, expect, it } from 'vitest';
import { chatProgress } from './chat-progress.js';
import { ChatStore } from './chat-store.js';

describe('chatProgress', () => {
  it('라우터에서 답변 팀원으로 넘어가도 작업 중 한 줄로 이어지고, 끝나면 남기지 않는다', () => {
    const store = new ChatStore();
    let now = 0;
    const progress = chatProgress(store, null, () => now);
    progress.step('작업 중…', 'router');
    now = 5000;
    progress.step('작업 중…', 'answerer');
    expect(store.working).toMatchObject({ text: '작업 중…', startedAt: 0 });
    progress.finish();
    expect(store.working).toBeNull();
    expect(store.lines).toEqual([]);
  });

  it('작업 팀원이 바뀌어도 줄을 쌓지 않고 같은 자리에서 지금 단계만 바뀐다', () => {
    const store = new ChatStore();
    let now = 0;
    const progress = chatProgress(store, null, () => now);
    progress.step('작업 중…', 'router');
    progress.step('팀장 접수 작업 중…', 'intake');
    now = 1000;
    progress.step('테스트 팀원 작업 중…', 'tester');
    now = 2000;
    progress.step('구현 팀원 작업 중…', 'implementer');
    expect(store.lines).toEqual([]);
    expect(store.working).toMatchObject({ text: '구현 중…', role: 'implementer', startedAt: 2000 });
  });

  it('같은 팀원을 다시 부르면 몇 번째인지 붙인다', () => {
    const store = new ChatStore();
    const progress = chatProgress(store, null, () => 0);
    progress.step('x', 'intake');
    progress.step('x', 'implementer');
    progress.step('x', 'implementer');
    expect(store.working?.text).toBe('구현(2) 중…');
  });

  it('진행 줄에는 지금 단계만 보이고, 끝난 뒤 남는 요약은 단계가 길면 앞을 …로 줄인다', () => {
    const store = new ChatStore();
    const progress = chatProgress(store, null, () => 0);
    progress.step('x', 'intake');
    for (const role of ['tester', 'implementer', 'tester', 'implementer', 'tester', 'implementer'] as const) progress.step('x', role);
    expect(store.working?.text).toBe('구현(3) 중…');
    progress.finish();
    expect(store.lines).toEqual(['  ◆ … > 구현(2) > 테스트(3) > 구현(3) 0초']);
  });

  it('팀원 사이의 알림은 줄로 남기되 진행 줄은 이어 간다', () => {
    const store = new ChatStore();
    const progress = chatProgress(store, null, () => 0);
    progress.step('x', 'intake');
    progress.step('검증 묶음을 실행합니다');
    expect(store.lines).toEqual(['  · 검증 묶음을 실행합니다']);
    expect(store.working?.text).toBe('접수 중…');
  });

  it('진행 줄 글자는 단계가 몇 번 바뀌어도 길어지지 않는다 (창이 좁아도 줄이 깨지지 않는다)', () => {
    const store = new ChatStore();
    const progress = chatProgress(store, null, () => 0);
    progress.step('x', 'intake');
    for (let i = 0; i < 20; i += 1) progress.step('x', i % 2 === 0 ? 'tester' : 'implementer');
    expect(store.working!.text.length).toBeLessThanOrEqual('구현(10) 중…'.length);
  });

  it('모든 팀원 역할은 영어 이름이 아니라 한글 단계 이름으로 보인다', () => {
    const roles = ['surveyor', 'writer', 'designer', 'operator', 'debugger', 'riskchecker', 'planner', 'chief', 'bm', 'marketer', 'growth', 'uxdesigner', 'brand', 'securitychecker', 'releaser'] as const;
    for (const role of roles) {
      const store = new ChatStore();
      chatProgress(store, null, () => 0).step('x', role);
      expect(store.working?.text, role).toMatch(/^[가-힣A-Z]+((d+))? 중…$/);
    }
  });

  it('git 일은 "커밋·PR" 단계만 보이고 테스트·구현 단계는 나오지 않는다', () => {
    const store = new ChatStore();
    const progress = chatProgress(store, null, () => 0);
    progress.step('x', 'publisher');
    expect(store.working?.text).toBe('커밋·PR 중…');
    progress.finish();
    const last = store.lines.at(-1) ?? '';
    expect(JSON.stringify(last)).toContain('커밋·PR');
    expect(JSON.stringify(last)).not.toMatch(/테스트|구현/);
  });

  it('코드 작업 뒤 커밋까지 시키면 마지막에 "커밋·PR" 단계가 붙는다', () => {
    const store = new ChatStore();
    const progress = chatProgress(store, null, () => 0);
    for (const role of ['intake', 'tester', 'implementer', 'reviewer', 'publisher'] as const) progress.step('x', role);
    progress.finish();
    expect(JSON.stringify(store.lines.at(-1))).toContain('리뷰 > 커밋·PR');
  });

  it('끝나면 지나온 단계와 전체 걸린 시간을 한 줄로 남긴다', () => {
    const store = new ChatStore();
    let now = 0;
    const progress = chatProgress(store, null, () => now);
    progress.step('x', 'intake');
    progress.step('x', 'tester');
    now = 111_000;
    progress.finish();
    expect(store.working).toBeNull();
    expect(store.lines).toEqual(['  ◆ 접수 > 테스트 1분 51초']);
  });
});
