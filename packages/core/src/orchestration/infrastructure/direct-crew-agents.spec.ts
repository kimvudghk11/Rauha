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

  it('팀원 목록에 없는 역할은 빼고, 넘길 팀원이 없으면 안내도 없다', () => {
    expect(crewAgents([{ role: 'router', setting }], () => prompt)).toEqual({});
    expect(crewBrief([])).toBe('');
    expect(crewBrief(['tester', 'implementer'])).toContain('tester, implementer');
  });
});
