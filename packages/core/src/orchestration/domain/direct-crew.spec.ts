import { describe, expect, it } from 'vitest';
import { CrewWatch, DirectCrew } from './direct-crew.js';

describe('메인 채팅 Claude 가 부를 수 있는 팀원', () => {
  it('조사·구현·테스트·리뷰·디버깅·설계·문서·보안 팀원을 서브에이전트 이름으로 부른다', () => {
    expect(DirectCrew.mates.map((m) => m.role)).toEqual(['surveyor', 'implementer', 'tester', 'reviewer', 'debugger', 'designer', 'writer', 'securitychecker']);
    expect(DirectCrew.roleOf('implementer')).toBe('implementer');
    expect(DirectCrew.roleOf('general-purpose')).toBeNull();
    expect(DirectCrew.roleOf(undefined)).toBeNull();
  });

  it('팀원마다 언제 넘길지 한 줄 설명이 있다', () => {
    for (const m of DirectCrew.mates) expect(m.description.length).toBeGreaterThan(10);
  });
});

describe('메인 채팅 진행 줄', () => {
  it('지배인이 팀원에게 넘기면 그 팀원 이름으로 넘김 한 줄을 남긴다', () => {
    const watch = CrewWatch.start();
    expect(watch.toolUse({ id: 't1', name: 'Agent', input: { subagent_type: 'tester', description: '로그인 실패 테스트 쓰기' } }, null)).toEqual({ role: 'tester', text: '로그인 실패 테스트 쓰기' });
  });

  it('도구 사용은 팀 대화가 아니라 작업 로그 한 줄로 남기고, 팀원 안에서 쓴 것은 누구 일인지 앞에 붙인다', () => {
    const watch = CrewWatch.start();
    watch.toolUse({ id: 't1', name: 'Agent', input: { subagent_type: 'implementer', description: '구현' } }, null);
    expect(watch.toolUse({ id: 'x', name: 'Edit', input: { file_path: 'E:/repo/src/login.ts' } }, 't1')).toEqual({ role: null, text: '구현 · 고치는 중: login.ts' });
    expect(watch.toolUse({ id: 'y', name: 'Read', input: { file_path: '/repo/README.md' } }, null)).toEqual({ role: null, text: '읽는 중: README.md' });
    expect(watch.toolUse({ id: 'z', name: 'Bash', input: { command: 'yarn test' } }, null)).toEqual({ role: null, text: '실행: yarn test' });
    expect(watch.toolUse({ id: 'w', name: 'Grep', input: { pattern: 'login' } }, null)).toEqual({ role: null, text: '찾는 중: login' });
  });

  it('팀원 일이 끝나면 지배인에게 돌아온 한 줄을 남기고, 다른 도구 결과는 남기지 않는다', () => {
    const watch = CrewWatch.start();
    watch.toolUse({ id: 't1', name: 'Agent', input: { subagent_type: 'reviewer', description: '리뷰' } }, null);
    expect(watch.toolResult('other')).toBeNull();
    expect(watch.toolResult('t1')).toEqual({ role: 'direct', text: '리뷰 결과 확인' });
    expect(watch.toolResult('t1')).toBeNull();
  });

  it('돌아온 뒤에 늦게 온 그 팀원의 도구 줄도 누구 일인지 붙인다', () => {
    const watch = CrewWatch.start();
    watch.toolUse({ id: 't1', name: 'Agent', input: { subagent_type: 'debugger', description: '원인' } }, null);
    watch.toolResult('t1');
    expect(watch.toolUse({ id: 'r', name: 'Read', input: { file_path: 'a/login.js' } }, 't1')).toEqual({ role: null, text: '원인 분석 · 읽는 중: login.js' });
  });

  it('&amp;&amp; 처럼 와도 원래 글자로 보여 준다', () => {
    const watch = CrewWatch.start();
    expect(watch.toolUse({ id: 'e', name: 'Bash', input: { command: 'npm test 2&gt;&amp;1 &amp;&amp; git status' } }, null)).toEqual({ role: null, text: '실행: npm test 2>&1 && git status' });
  });

  it('명령 앞의 cd "작업 폴더" && 는 떼고 보여 준다', () => {
    const watch = CrewWatch.start();
    expect(watch.toolUse({ id: 'b', name: 'Bash', input: { command: 'cd "C:/Users/me/AppData/Local/Temp/x y/shop" && node --test' } }, null)).toEqual({ role: null, text: '실행: node --test' });
    expect(watch.toolUse({ id: 'c', name: 'Bash', input: { command: 'cd /repo; git status' } }, null)).toEqual({ role: null, text: '실행: git status' });
  });

  it('팀원이 아닌 서브에이전트에 넘긴 것도 지배인 이름으로 보인다', () => {
    const watch = CrewWatch.start();
    expect(watch.toolUse({ id: 't1', name: 'Agent', input: { subagent_type: 'general-purpose', description: '파일 찾기' } }, null)).toEqual({ role: 'direct', text: '도우미에게 맡겼어요: 파일 찾기' });
  });

  it('긴 명령은 한 줄로 줄이고, 알 수 없는 도구(도구: search 같은 것)는 남기지 않는다', () => {
    const watch = CrewWatch.start();
    const long = watch.toolUse({ id: 'a', name: 'Bash', input: { command: `echo ${'x'.repeat(200)}\nls` } }, null);
    expect(long!.text.length).toBeLessThanOrEqual(80);
    expect(long!.text).not.toContain('\n');
    expect(watch.toolUse({ id: 'b', name: 'mcp__rauha__todo_list', input: {} }, null)).toBeNull();
    expect(watch.toolUse({ id: 'c', name: 'TodoWrite', input: {} }, null)).toBeNull();
  });
});
