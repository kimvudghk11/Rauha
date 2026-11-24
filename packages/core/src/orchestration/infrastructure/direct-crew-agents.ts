import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { CrewCall } from '../application/ports.js';
import { DirectCrew } from '../domain/direct-crew.js';
import type { MemberRole } from '../domain/member-role.js';
import { MODEL_ID } from '../domain/team.js';

const section = (text: string, tag: string): string => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return m === null ? '' : m[1]!.trim();
};

const AS_SUBAGENT = `You were handed this task by the lead Claude in the user's session (rauha). Work only on what the task asks, inside the current working directory.
Check the real state yourself: open files and run commands instead of guessing.
When done, reply in plain text (not JSON): what you did or found first, then the evidence (file:line, command output) only as much as needed, and the files you changed. Keep it short.`;

/**
 * 팀원 프롬프트는 rauha 팀 흐름(잠긴 테스트·구조화 출력)에 맞춰 있어서, 역할과 전문성만 가져오고
 * 서브에이전트로 일하는 법과 사용자가 그 팀원에게 더한 지시를 붙인다.
 */
export function crewAgents(crew: readonly CrewCall[], promptOf: (role: MemberRole) => string): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};
  for (const { role, setting } of crew) {
    const mate = DirectCrew.mates.find((m) => m.role === role);
    if (mate === undefined) continue;
    const text = promptOf(role);
    const parts = [section(text, 'role'), section(text, 'expertise'), AS_SUBAGENT].filter((p) => p !== '');
    const extra = setting.extraInstruction?.trim() ?? '';
    if (extra !== '') parts.push(`<user-team-instruction>\n사용자가 이 팀원에게 더한 지시입니다.\n${extra}\n</user-team-instruction>`);
    agents[role] = { description: mate.description, prompt: parts.join('\n\n'), model: MODEL_ID[setting.tier], tools: [...setting.tools], maxTurns: setting.maxTurns };
  }
  return agents;
}

/** 지배인 시스템 프롬프트에 붙일 넘기기 안내. 넘길 팀원이 없으면 빈 글 */
export function crewBrief(roles: readonly string[]): string {
  if (roles.length === 0) return '';
  return `<rauha-team>
The user built a team in rauha and wants you to use it. Team members are available as subagents through the Agent tool: ${roles.join(', ')}.
- Answer short questions and do small edits (one file, a few lines) yourself.
- For bigger work, act as the lead: hand clear, self-contained pieces to the matching team member (for example surveyor to look around, tester to write and run tests, implementer to change code, reviewer to check the result, debugger for a failure). Run independent pieces in parallel.
- Give each member the context it needs in the prompt (paths, what is already known, what to return); it does not see this conversation.
- Check what members report before you tell the user it is done.
</rauha-team>`;
}
