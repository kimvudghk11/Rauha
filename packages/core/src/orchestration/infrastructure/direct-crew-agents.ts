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
 * withUserRules: 사용자 룰(~/.claude/CLAUDE.md·@import, 항상 룰, 취향). 코드를 실제로 쓰는 건 팀원이라 팀원도 따라야 한다.
 */
export function crewAgents(crew: readonly CrewCall[], promptOf: (role: MemberRole) => string, withUserRules: (prompt: string) => string = (p) => p): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};
  for (const { role, setting } of crew) {
    const mate = DirectCrew.mates.find((m) => m.role === role);
    if (mate === undefined) continue;
    const text = promptOf(role);
    const parts = [section(text, 'role'), section(text, 'expertise'), AS_SUBAGENT].filter((p) => p !== '');
    const extra = setting.extraInstruction?.trim() ?? '';
    if (extra !== '') parts.push(`<user-team-instruction>\n사용자가 이 팀원에게 더한 지시입니다.\n${extra}\n</user-team-instruction>`);
    agents[role] = { description: mate.description, prompt: withUserRules(parts.join('\n\n')), model: MODEL_ID[setting.tier], effort: setting.effort, tools: [...setting.tools], maxTurns: setting.maxTurns, background: false };
  }
  return agents;
}

/** 지배인 시스템 프롬프트에 붙일 넘기기 안내. 넘길 팀원이 없으면 빈 글 */
export function crewBrief(roles: readonly string[]): string {
  if (roles.length === 0) return '';
  return `<rauha-team>
The user built a team in rauha and wants you to use it. Team members are available as subagents through the Agent tool: ${roles.join(', ')}.
- You are the lead. The user wants to see the team work, so delegate: any request that needs looking through the code, changing files, running tests or finding a cause goes to the matching member — surveyor to look around, debugger for an error or failure, implementer to change code, tester to write and run tests, reviewer to check a finished change, designer to plan a larger change, writer for docs, securitychecker for security.
- Do it yourself only for greetings, a one-line fact you already know, or a question answered by one file read.
- Split work into clear, self-contained pieces and run independent pieces in parallel (for example implementer and tester together, then reviewer).
- Give each member the context it needs in the prompt (paths, what is already known, what to return); it does not see this conversation.
- Members report what they found with file:line. Use that; do not re-read the same files to double-check unless the report looks wrong or incomplete. When code was changed, run the tests once yourself before you say it is done.
- Answer as one team. Do not tell the user which member did what or that you did not re-check something; the screen already shows the handoffs.
</rauha-team>`;
}
