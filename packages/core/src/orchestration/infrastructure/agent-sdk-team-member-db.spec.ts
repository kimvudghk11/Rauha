import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { LinkedDatabase } from '../application/linked-database.js';
import { RoleSettingsDto } from '../application/dto/role-settings.dto.js';
import type { MemberRole } from '../domain/member-role.js';
import { SecretPolicy } from '../domain/secret-policy.js';
import type { PromptLibrary } from './prompt-library.js';
import { DB_SERVER } from './db-mcp.js';

const seen: Options[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    query: ({ options }: { options: Options }) => {
      seen.push(options);
      return (async function* () {
        yield { type: 'result', subtype: 'success', structured_output: { ok: true }, duration_ms: 1, total_cost_usd: 0, num_turns: 1, modelUsage: {}, permission_denials: [], session_id: 's' };
      })();
    },
  };
});

const { AgentSdkTeamMember } = await import('./agent-sdk-team-member.js');

const prompts = { system: () => 'SYSTEM', dbGuide: (role: MemberRole) => (role === 'reviewer' ? 'DB-GUIDE REVIEW' : 'DB-GUIDE') } as unknown as PromptLibrary;

const fakeDb: LinkedDatabase = {
  dialect: 'mysql',
  name: 'shop',
  production: false,
  tables: async () => ({ ok: true, text: '' }),
  describe: async () => ({ ok: true, text: '' }),
  indexes: async () => ({ ok: true, text: '' }),
  sample: async () => ({ ok: true, text: '' }),
  select: async () => ({ ok: true, text: '' }),
  explain: async () => ({ ok: true, text: '' }),
};

function member(database?: () => Promise<LinkedDatabase | null>) {
  return new AgentSdkTeamMember({ cwd: '/repo', env: {}, prompts, ask: async () => ({ kind: 'deny', note: null }), secrets: SecretPolicy.defaults(), secretFiles: () => [], ...(database !== undefined ? { database } : {}) });
}

const call = (role: MemberRole) => ({ role, setting: RoleSettingsDto.defaults().get(role), userMessage: 'go', outputSchema: { type: 'object' }, canWrite: () => true });

beforeEach(() => {
  seen.length = 0;
});

describe('레포에 연결된 DB 도구 붙이기', () => {
  it('구현 팀원 호출에는 DB 서버·도구·사용법을 붙인다', async () => {
    await member(async () => fakeDb).run(call('implementer'));
    const o = seen[0]!;
    expect(Object.keys(o.mcpServers ?? {})).toContain(DB_SERVER);
    expect(o.allowedTools).toContain(`mcp__${DB_SERVER}__explain`);
    expect(o.systemPrompt).toContain('DB-GUIDE');
  });

  it('리뷰어는 쿼리 점검 사용법까지 받는다', async () => {
    await member(async () => fakeDb).run(call('reviewer'));
    expect(seen[0]!.systemPrompt).toContain('DB-GUIDE REVIEW');
  });

  it('연결된 DB 가 없으면 아무것도 붙지 않는다', async () => {
    await member(async () => null).run(call('implementer'));
    const o = seen[0]!;
    expect(o.mcpServers).toBeUndefined();
    expect(o.systemPrompt).not.toContain('DB-GUIDE');
  });

  it('코드 작업이 아닌 팀원에게는 DB 를 찾지도 붙이지도 않는다', async () => {
    const find = vi.fn(async () => fakeDb);
    await member(find).run(call('answerer'));
    expect(find).not.toHaveBeenCalled();
    expect(seen[0]!.mcpServers).toBeUndefined();
  });

  it('DB 는 실행마다 한 번만 찾고, 찾다 실패하면 붙이지 않는다', async () => {
    const find = vi.fn(async () => fakeDb);
    const m = member(find);
    await m.run(call('tester'));
    await m.run(call('debugger'));
    expect(find).toHaveBeenCalledTimes(1);
    await member(async () => Promise.reject(new Error('boom'))).run(call('implementer'));
    expect(seen[2]!.mcpServers).toBeUndefined();
  });

  it('도구 설명과 사용법에 접속 정보가 들어가지 않는다', async () => {
    await member(async () => fakeDb).run(call('implementer'));
    const dump = JSON.stringify({ system: seen[0]!.systemPrompt, tools: seen[0]!.allowedTools });
    expect(dump).not.toMatch(/password|@|:\/\//i);
  });
});
