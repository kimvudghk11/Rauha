import { query } from '@anthropic-ai/claude-agent-sdk';
import { FIX_SCHEMA, PLAN_SCHEMA } from '../../shared/api-test-dto.js';
import { ApiTestError } from '../../shared/api-test.js';

/**
 * "API 테스트 팀원": 케이스 만들기 1번, (실패가 있을 때만) 수정 제안 1번. 둘 다 도구 없이 한 턴짜리 단발 호출이다.
 * 코드는 main 이 골라 글로 넘기므로 모델이 파일을 열 필요가 없고, 실제 요청은 main 이 보낸다(모델은 네트워크를 쓰지 않는다).
 */

const PLAN_SYSTEM = `You are the API test member of a software team. You get one HTTP endpoint, the request as it is saved, the environment variable names, and the relevant source code with line numbers (controller, DTOs, services, guards, global setup).
Write test cases that a local run can check by status code. Rules:
- Only write cases that the code supports. Every case cites the code that decides the outcome in "evidence" as path:line (for example src/users/dto/create-user.dto.ts:12). If the code does not decide it, do not write the case.
- Cover as many of these categories as the code supports: happy (required only, with optional values), validation (each validation rule: boundary values on both sides, missing required fields, wrong types, empty strings, very long input, special characters and unicode), auth (no token, invalid token, someone else's resource), data (unknown id, deleted item, duplicate create, same request twice = idempotency via repeat 2), list (paging, sort, filter boundaries), security (SQL/NoSQL injection strings, XSS strings, extra hidden fields such as role or isAdmin = mass assignment, error stack leaks via body_excludes), concurrency (same change sent at once via parallel 2-5).
- Values: write path_params, query, headers and body as plain strings. body is the raw request body text (JSON text normally; it may be invalid JSON on purpose) or null. Never invent secret values; use {{variable}} names from the environment (for example {{token}}). For "no token" use auth "none", for a bad token use auth "invalid".
- expect_status lists every status code the code can correctly return for that case (for example [400] or [400, 422]). Use body_excludes for text that must not appear in the response (for example "\\"role\\":\\"admin\\"" or "at Object.").
- mutates is true when the case creates, changes or deletes data.
- Write title, expect_note and notes in Korean. Keep titles short. At most 30 cases. In notes, say briefly what you could not test and why.`;

const FIX_SYSTEM = `You are the API test member of a software team. Some test cases failed against a local server. For each failed case, read the code with line numbers and explain the most likely cause and how to fix it: the file and line to change and the change in one or two sentences. If the test expectation itself was wrong, say so and suggest fixing the test instead. Do not invent code that is not shown. Write summary, cause and fix in Korean.`;

export type ApiTestQuery = (params: Parameters<typeof query>[0]) => AsyncIterable<{ readonly type: string; readonly subtype?: string; readonly structured_output?: unknown }>;

export interface ApiTestModelOptions {
  readonly model: string;
  readonly env: Record<string, string>;
  readonly claudeExecutable?: string | undefined;
  readonly timeoutMs?: number;
  readonly run?: ApiTestQuery;
}

async function once(system: string, prompt: string, schema: Record<string, unknown>, o: ApiTestModelOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 240_000);
  const run = o.run ?? (query as unknown as ApiTestQuery);
  try {
    const messages = run({
      prompt,
      options: {
        model: o.model,
        env: o.env,
        abortController: controller,
        systemPrompt: system,
        tools: [],
        allowedTools: [],
        settingSources: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        outputFormat: { type: 'json_schema', schema },
        ...(o.claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: o.claudeExecutable } : {}),
      },
    });
    for await (const m of messages) {
      if (m.type !== 'result') continue;
      if (m.subtype !== 'success') throw new ApiTestError('MODEL_FAILED', 'The AI could not finish. Check the login and usage limit, then try again.');
      return m.structured_output;
    }
    throw new ApiTestError('MODEL_FAILED', 'The AI did not answer.');
  } finally {
    clearTimeout(timer);
  }
}

/** 케이스 목록(모델 출력 그대로, TestPlanDto 가 읽는다) */
export const planTestCases = (prompt: string, o: ApiTestModelOptions): Promise<unknown> => once(PLAN_SYSTEM, prompt, PLAN_SCHEMA as unknown as Record<string, unknown>, o);

/** 실패 케이스의 원인·수정 방향(FixNotesDto 가 읽는다) */
export const suggestFixes = (prompt: string, o: ApiTestModelOptions): Promise<unknown> => once(FIX_SYSTEM, prompt, FIX_SCHEMA as unknown as Record<string, unknown>, o);
