import { describe, expect, it } from 'vitest';
import { ModelNames } from '../domain/model-names.js';
import type { ModelTier } from '../domain/team.js';
import type { MemberCall, MemberResult, PreparedCall, TeamMemberPort } from './ports.js';
import { ModelRoutingTeam } from './model-routing-team.js';

const usage: MemberResult['usage'] = { model: 'm', durationMs: 1, costUsd: 0, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' };
const ok: MemberResult = { output: { fine: true }, error: null, fetched: [], usage };

const callFor = (tier: ModelTier): MemberCall => ({ role: 'implementer', setting: { tier } as MemberCall['setting'], userMessage: 'x', outputSchema: {}, canWrite: () => true });

class FakeInner implements TeamMemberPort {
  readonly models: (string | undefined)[] = [];
  readonly prepared: (string | undefined)[] = [];
  async run(call: MemberCall): Promise<MemberResult> {
    this.models.push(call.model);
    return ok;
  }
  prepare(call: PreparedCall): void {
    this.prepared.push(call.model);
  }
}

describe('ModelRoutingTeam', () => {
  it('설정에 적힌 등급별 모델 ID로 팀원을 부른다', async () => {
    const inner = new FakeInner();
    const team = new ModelRoutingTeam(inner, () => ModelNames.defaults().with('opus', 'claude-fable-5-2'));
    await team.run(callFor('opus'));
    await team.run(callFor('haiku'));
    expect(inner.models).toEqual(['claude-fable-5-2', 'claude-haiku-5-5']);
  });

  it('부를 때마다 최신 설정을 읽는다', async () => {
    const inner = new FakeInner();
    let names = ModelNames.defaults();
    const team = new ModelRoutingTeam(inner, () => names);
    await team.run(callFor('sonnet'));
    names = names.with('sonnet', 'claude-sonnet-5');
    await team.run(callFor('sonnet'));
    expect(inner.models).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5']);
  });

  it('미리 띄우는 호출에도 같은 모델을 정해 준다', () => {
    const inner = new FakeInner();
    const team = new ModelRoutingTeam(inner, () => ModelNames.defaults());
    const { userMessage: _u, ...prepared } = callFor('sonnet');
    team.prepare(prepared);
    expect(inner.prepared).toEqual(['claude-sonnet-5-5']);
  });
});
