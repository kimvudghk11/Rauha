import { query } from '@anthropic-ai/claude-agent-sdk';
import { DomainError } from '../../shared/domain-error.js';
import { RULE_DRAFT_SCHEMA, RuleDraftDto, type RuleDraft } from '../application/dto/rule-draft.dto.js';
import { MODEL_ID } from '../domain/team.js';

const SYSTEM = `You turn one sentence about how an AI coding team should behave into a structured rule. Answer only with the JSON the schema asks for.
Buckets: "always" = something the team must always keep in mind (style, language, habits); "allow" = a command that must never need the user's approval; "ask" = a command that must always ask first.
For allow and ask, "includes" lists short plain strings that appear in the command or file path when the rule applies (examples: "git push", "terraform apply", "prod"). Keep them few and specific. "tools" is Bash for commands and Write for file changes, or empty for any tool.
Scope: "global" unless the sentence names a place; "workspace" for "this work folder"; "folder" with the repo or folder the user named in "path".
Never widen a rule: if the sentence says "only in qa", include "qa" in includes. Write "text" as one short Korean sentence in the user's words. Never add anything the user did not say.`;

/**
 * 사용자가 말로 적은 규칙을 가장 가벼운 모델(haiku) 한 번으로 정리한다. 도구도 파일도 쓰지 않고 한 턴만 돈다.
 * 결과는 초안일 뿐이라 화면이 사용자에게 보여 주고 확인받은 뒤에 규칙으로 넣는다.
 */
export async function draftRule(sentence: string, env: Record<string, string>, claudeExecutable?: string, timeoutMs = 60_000): Promise<RuleDraft> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const messages = query({
      prompt: sentence,
      options: {
        model: MODEL_ID.haiku,
        env,
        abortController: controller,
        systemPrompt: SYSTEM,
        tools: [],
        allowedTools: [],
        settingSources: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        outputFormat: { type: 'json_schema', schema: RULE_DRAFT_SCHEMA as unknown as Record<string, unknown> },
        ...(claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
      },
    });
    for await (const message of messages) {
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success') throw new DomainError('RULE_DRAFT_FAILED', '규칙을 정리하지 못했어요. 잠시 뒤 다시 해 주세요.');
      return RuleDraftDto.from(message.structured_output);
    }
    throw new DomainError('RULE_DRAFT_FAILED', '규칙을 정리하지 못했어요.');
  } finally {
    clearTimeout(timer);
  }
}
