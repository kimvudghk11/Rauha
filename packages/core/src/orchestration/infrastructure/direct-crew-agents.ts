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

/** <rules> 가 rauha 팀 흐름(잠긴 테스트·작업 지시서)에 묶여 있어 서브에이전트에게 맞지 않는 역할 */
const FLOW_BOUND_RULES: ReadonlySet<MemberRole> = new Set(['implementer', 'reviewer']);
/** rauha 앱에 쓰는 도구: 사용자 말을 받은 지배인만 쓴다 */
const LEAD_ONLY_TOOLS = /^mcp__rauha__(add_todo|remember|keep_rule)$/;

/** 문서 팀원이 서브에이전트일 때: 사실은 rauha 도구로 한 번에 모으고, 블로그 글은 블로그답게 */
const WRITER_AS_SUBAGENT = `Gather facts cheaply before opening files: mcp__rauha__my_commits with \`since\` set to the period asked (the user's own commits in every repository), mcp__rauha__repo_changes for commits, tags and CHANGELOG, mcp__rauha__show_commit for one commit's change, mcp__rauha__past_work for decisions rauha remembers. For the user's saved Markdown notes, Glob for *.md (docs/, notes) and read only the ones whose names match the topic. Do not read whole folders or every file.
For a blog post, retrospective or write-up of the user's own work: pick the few pieces of work that tell a story (problem, what was tried, the decision, the result), group commits by theme instead of listing them, use real names, dates and numbers from what you read, and mark anything the source does not say as "(직접 채우기)". Write it for readers of a developer blog (velog style) in the user's language. Save it as a Markdown file only if the user asked for a file; reply with the full post text either way.`;

/**
 * 팀원 프롬프트는 rauha 팀 흐름(잠긴 테스트·구조화 출력)에 맞춰 있어서, 역할·전문성·규칙만 가져오고
 * 서브에이전트로 일하는 법과 사용자가 그 팀원에게 더한 지시를 붙인다.
 * withUserRules: 사용자 룰(~/.claude/CLAUDE.md·@import, 항상 룰, 취향). 코드를 실제로 쓰는 건 팀원이라 팀원도 따라야 한다.
 * workspaceTools: 지배인 세션에 붙은 도구 묶음. 그중 rauha 작업 공간 읽기 도구를 팀원도 쓴다.
 */
export function crewAgents(crew: readonly CrewCall[], promptOf: (role: MemberRole) => string, withUserRules: (prompt: string) => string = (p) => p, workspaceTools: readonly string[] = []): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};
  const rauhaReads = workspaceTools.filter((t) => t.startsWith('mcp__rauha__') && !LEAD_ONLY_TOOLS.test(t));
  for (const { role, setting } of crew) {
    const mate = DirectCrew.mates.find((m) => m.role === role);
    if (mate === undefined) continue;
    const text = promptOf(role);
    const rules = FLOW_BOUND_RULES.has(role) ? '' : section(text, 'rules');
    const parts = [section(text, 'role'), section(text, 'expertise'), rules === '' ? '' : `<rules>\n${rules}\n</rules>`, AS_SUBAGENT, role === 'writer' ? WRITER_AS_SUBAGENT : ''].filter((p) => p !== '');
    const extra = setting.extraInstruction?.trim() ?? '';
    if (extra !== '') parts.push(`<user-team-instruction>\n사용자가 이 팀원에게 더한 지시입니다.\n${extra}\n</user-team-instruction>`);
    agents[role] = { description: mate.description, prompt: withUserRules(parts.join('\n\n')), model: MODEL_ID[setting.tier], effort: setting.effort, tools: [...setting.tools, ...rauhaReads], maxTurns: setting.maxTurns, background: false };
  }
  return agents;
}

/** 지배인 시스템 프롬프트에 붙일 넘기기 안내. 넘길 팀원이 없으면 빈 글 */
export function crewBrief(roles: readonly string[]): string {
  if (roles.length === 0) return '';
  return `<rauha-team>
The user built a team in rauha and wants you to use it. Team members are available as subagents through the Agent tool: ${roles.join(', ')}.
- You are the lead. The user wants to see the team work, so delegate: any request that needs looking through the code, changing files, running tests or finding a cause goes to the matching member — surveyor to look around, debugger for an error or failure, implementer to change code, tester to write and run tests, reviewer to check a finished change, designer to plan a larger change, writer for docs, securitychecker for security.
- A blog post, retrospective, portfolio entry or summary of the user's own past work goes straight to writer in one handoff (no surveyor first): writer gathers commits and saved notes with the rauha tools itself. Tell writer the period, repositories and tone the user asked for, and show the user writer's full text.
- Do it yourself only for greetings, a one-line fact you already know, or a question answered by one file read.
- Do not edit files yourself, even small fixes: after the debugger finds the cause, hand the change to implementer (and new tests to tester), in parallel when both are needed.
- Split work into clear, self-contained pieces and run independent pieces in parallel (for example implementer and tester together, then reviewer).
- Always set the Agent \`subagent_type\` to the member's name (for example "implementer"); without it the work goes to an unnamed helper the user cannot see.
- Write each Agent \`description\` in the user's language (usually Korean): the screen shows it as that member's task.
- Give each member the context it needs in the prompt (paths, what is already known, what to return); it does not see this conversation.
- Members report what they found with file:line. Use that; do not re-read the same files to double-check unless the report looks wrong or incomplete. When code was changed, run the tests once yourself before you say it is done.
- Answer as one team. Do not tell the user which member did what or that you did not re-check something; the screen already shows the handoffs.
</rauha-team>`;
}
