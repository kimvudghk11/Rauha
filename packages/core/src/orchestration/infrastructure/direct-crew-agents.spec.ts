import { describe, expect, it } from 'vitest';
import { crewAgents, crewBrief } from './direct-crew-agents.js';

const setting = { tier: 'opus' as const, effort: 'high' as const, maxTurns: 40, maxBudgetUsd: 5, tools: ['Read', 'Grep', 'Edit'], readsProject: true };
const prompt = '<role>\nYou are the tester.\n</role>\n\n<expertise>\nSenior QA.\n</expertise>\n\n<steps>\n1. Read <files>.\n</steps>\n\n<output>json</output>';

describe('팀원을 메인 채팅 Claude 의 서브에이전트로', () => {
  it('팀 설정의 모델·도구·턴 한도로 서브에이전트를 만든다', () => {
    const agents = crewAgents([{ role: 'tester', setting }], () => prompt);
    expect(Object.keys(agents)).toEqual(['tester']);
    expect(agents['tester']!.model).toBe('claude-opus-5-5');
    expect(agents['tester']!.tools).toEqual(['Read', 'Grep', 'Edit']);
    expect(agents['tester']!.maxTurns).toBe(40);
    expect(agents['tester']!.effort).toBe('high');
    expect(agents['tester']!.background).toBe(false);
    expect(agents['tester']!.description.length).toBeGreaterThan(10);
  });

  it('역할 프롬프트에서 역할·전문성만 가져오고 TDD 단계·출력 형식은 뺀다', () => {
    const p = crewAgents([{ role: 'tester', setting }], () => prompt)['tester']!.prompt;
    expect(p).toContain('You are the tester.');
    expect(p).toContain('Senior QA.');
    expect(p).not.toContain('<steps>');
    expect(p).not.toContain('<output>');
    expect(p).toContain('plain text');
  });

  it('사용자가 팀원에게 더한 지시를 그대로 붙인다', () => {
    const p = crewAgents([{ role: 'tester', setting: { ...setting, extraInstruction: '테스트 이름은 한국어로' } }], () => prompt)['tester']!.prompt;
    expect(p).toContain('테스트 이름은 한국어로');
  });

  it('사용자 룰(회사 CLAUDE.md·항상 룰)을 팀원 프롬프트에도 붙인다(코드는 팀원이 쓴다)', () => {
    const p = crewAgents([{ role: 'tester', setting }], () => prompt, (x) => `${x}\n<claude-md>회사 룰</claude-md>`)['tester']!.prompt;
    expect(p.endsWith('<claude-md>회사 룰</claude-md>')).toBe(true);
  });

  it('rauha 작업 공간 읽기 도구를 팀원도 받는다(앱에 쓰는 도구는 지배인만)', () => {
    const ws = ['mcp__rauha__my_commits', 'mcp__rauha__past_work', 'mcp__rauha__remember', 'mcp__rauha__add_todo', 'mcp__rauha__keep_rule'];
    const tools = crewAgents([{ role: 'writer', setting }], () => prompt, (p) => p, ws)['writer']!.tools;
    expect(tools).toEqual(['Read', 'Grep', 'Edit', 'mcp__rauha__my_commits', 'mcp__rauha__past_work']);
  });

  it('지어내지 말라는 규칙(<rules>)은 팀원 프롬프트에 남긴다(구현·리뷰처럼 팀 흐름에 묶인 규칙은 뺀다)', () => {
    const withRules = `${prompt}\n<rules>\n- Do not invent numbers.\n</rules>`;
    expect(crewAgents([{ role: 'writer', setting }], () => withRules)['writer']!.prompt).toContain('Do not invent numbers.');
    expect(crewAgents([{ role: 'implementer', setting }], () => withRules)['implementer']!.prompt).not.toContain('Do not invent numbers.');
  });

  it('규칙 중 작업 지시서·결과 칸에 묶인 줄만 빼고 일반 규칙은 남긴다(실측 리뷰: 조사 팀원의 `sources`·`<areas>` 줄이 그대로 갔다)', () => {
    const rules = `<rules>
- Write only what the files you opened show.
- \`sources\` lists only the files you actually opened for that note, as exact paths from \`<areas>\`.
- Lock in what the acceptance criteria require and their natural edge values, nothing more.
- One behaviour per test; name tests after the rule they check.
</rules>`;
    const surveyor = crewAgents([{ role: 'surveyor', setting }], () => `${prompt}\n${rules}`)['surveyor']!.prompt;
    expect(surveyor).toContain('Write only what the files you opened show.');
    expect(surveyor).not.toContain('`sources`');
    const tester = crewAgents([{ role: 'tester', setting }], () => `${prompt}\n${rules}`)['tester']!.prompt;
    expect(tester).toContain('One behaviour per test');
    expect(tester).not.toContain('acceptance criteria');
  });

  it('문서 팀원: rauha 도구가 있으면 그걸로 모으라고 하고, 없으면 도구 이름 없이 일반 지침만 준다(없는 도구를 부르다 실패하지 않게)', () => {
    const ws = ['mcp__rauha__my_commits', 'mcp__rauha__repo_changes'];
    const withTools = crewAgents([{ role: 'writer', setting }], () => prompt, (p) => p, ws)['writer']!.prompt;
    expect(withTools).toContain('mcp__rauha__my_commits');
    expect(withTools).toMatch(/velog/);
    const without = crewAgents([{ role: 'writer', setting }], () => prompt)['writer']!.prompt;
    expect(without).not.toContain('mcp__rauha__');
    expect(without).toMatch(/velog/);
  });

  it('문서 팀원은 읽기 한도 때문에 다 읽지 못한 파일을 Write 로 통째로 다시 쓰지 않는다고 안내한다', () => {
    expect(crewAgents([{ role: 'writer', setting }], () => prompt)['writer']!.prompt).toMatch(/never rewrite .*Write/i);
  });

  it('rauha 도구 이름은 도메인(WorkspaceToolAccess)이 정한 역할별 목록만 따른다(쓰기 도구를 따로 베끼지 않는다)', () => {
    const ws = ['mcp__rauha__my_commits', 'mcp__rauha__add_todo', 'mcp__rauha__unknown_tool'];
    expect(crewAgents([{ role: 'writer', setting }], () => prompt, (p) => p, ws)['writer']!.tools).toEqual(['Read', 'Grep', 'Edit', 'mcp__rauha__my_commits']);
  });

  it('블로그·회고처럼 내 작업을 정리하는 글은 조사 없이 문서 팀원에게 바로 넘기라고 안내하고, 안내는 rauha 도구 유무에 기대지 않는다', () => {
    const brief = crewBrief(['surveyor', 'writer']);
    expect(brief).toMatch(/blog/i);
    expect(brief).toContain('straight to writer');
    expect(brief).not.toContain('rauha tools');
  });

  it('비싼 팀원(reviewer·designer·debugger·securitychecker)은 필요할 때만 부르라고 안내한다', () => {
    const brief = crewBrief(['reviewer', 'implementer']);
    expect(brief).toMatch(/costliest/i);
    expect(brief).toContain('small change');
    expect(brief).toContain('surveyor first');
  });

  it('팀원 목록에 없는 역할은 빼고, 넘길 팀원이 없으면 안내도 없다', () => {
    expect(crewAgents([{ role: 'router', setting }], () => prompt)).toEqual({});
    expect(crewBrief([])).toBe('');
    expect(crewBrief(['tester', 'implementer'])).toContain('tester, implementer');
  });

  it('원인을 찾은 뒤 고치기는 지배인이 직접 하지 않고 구현 팀원에게 넘기라고 안내한다', () => {
    const brief = crewBrief(['debugger', 'implementer']);
    expect(brief).toContain('Do not edit files yourself');
    expect(brief).toContain('after the debugger finds the cause');
  });
});
