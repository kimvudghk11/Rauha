import { describe, expect, it } from 'vitest';
import { ModelNames } from '../domain/model-names.js';
import type { ModelTier } from '../domain/team.js';
import type { MemberCall, MemberResult, PreparedCall, TeamMemberPort } from './ports.js';
import { ModelRoutingTeam } from './model-routing-team.js';

const usage: MemberResult['usage'] = { model: 'm', durationMs: 1, costUsd: 0, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' };
const ok: MemberResult = { output: { fine: true }, error: null, fetched: [], usage };

const callFor = (tier: ModelTier): MemberCall => ({ role: 'implementer', setting: { tier } as MemberCall['setting'], userMessage: 'x', outputSchema: {}, canWrite: () => true });

class FakeInner implements TeamMemberPort {
  /** 모델 ID마다 돌려줄 결과(없으면 성공) */
  results = new Map<string, MemberResult>();
  readonly models: (string | undefined)[] = [];
  readonly prepared: (string | undefined)[] = [];
  async run(call: MemberCall): Promise<MemberResult> {
    this.models.push(call.model);
    return this.results.get(call.model ?? '') ?? ok;
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

const failed = (error: string, blocked?: MemberResult['blocked']): MemberResult => ({ output: null, error, fetched: [], usage, ...(blocked !== undefined ? { blocked } : {}) });
const NO_MODEL = 'There is an issue with the selected model. It may not exist or you may not have access to it.';

describe('ModelRoutingTeam 모델 오류 대체', () => {
  const setup = () => {
    const inner = new FakeInner();
    const notices: string[] = [];
    const team = new ModelRoutingTeam(inner, () => ModelNames.defaults(), (line) => notices.push(line));
    return { inner, notices, team };
  };

  it('모델 오류면 같은 등급의 이전 버전으로 다시 해 보고 한 줄로 알린다', async () => {
    const { inner, notices, team } = setup();
    inner.results.set('claude-opus-5-5', failed(NO_MODEL));
    const result = await team.run(callFor('opus'));
    expect(result).toBe(ok);
    expect(inner.models).toEqual(['claude-opus-5-5', 'claude-opus-5']);
    expect(notices).toEqual(['opus-5-5 모델을 쓸 수 없어서 대신 opus-5 모델로 실행했어요.']);
  });

  it('이전 버전도 안 되면 한 단계 낮은 등급으로 가고, 거기서 멈춘다(최대 2번)', async () => {
    const { inner, notices, team } = setup();
    inner.results.set('claude-opus-5-5', failed(NO_MODEL));
    inner.results.set('claude-opus-5', failed(NO_MODEL));
    inner.results.set('claude-sonnet-5-5', failed(NO_MODEL));
    const result = await team.run(callFor('opus'));
    expect(inner.models).toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
    expect(result.error).toBe(NO_MODEL);
    expect(notices).toEqual([]);
  });

  it('낮은 등급에서 성공하면 그 모델로 실행했다고 알린다', async () => {
    const { inner, notices, team } = setup();
    inner.results.set('claude-opus-5-5', failed(NO_MODEL));
    inner.results.set('claude-opus-5', failed(NO_MODEL));
    await team.run(callFor('opus'));
    expect(inner.models).toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
    expect(notices).toEqual(['opus-5-5 모델을 쓸 수 없어서 대신 sonnet-5-5 모델로 실행했어요.']);
  });

  it('모델 오류가 아니거나 계정 문제로 막힌 실패는 다시 하지 않는다', async () => {
    const { inner, notices, team } = setup();
    inner.results.set('claude-opus-5-5', failed('error_max_turns: '));
    await team.run(callFor('opus'));
    inner.results.set('claude-sonnet-5-5', failed(NO_MODEL, { reason: 'login', message: '로그인' }));
    await team.run(callFor('sonnet'));
    expect(inner.models).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(notices).toEqual([]);
  });

  it('haiku 는 이전 버전도 낮은 등급도 없어서 그대로 실패를 돌려준다', async () => {
    const { inner, team } = setup();
    inner.results.set('claude-haiku-5-5', failed(NO_MODEL));
    const result = await team.run(callFor('haiku'));
    expect(inner.models).toEqual(['claude-haiku-5-5']);
    expect(result.error).toBe(NO_MODEL);
  });
});
