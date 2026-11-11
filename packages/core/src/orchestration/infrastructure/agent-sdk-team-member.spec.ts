import { describe, expect, it } from 'vitest';
import { ToolTally } from '../domain/tool-tally.js';
import type { MemberUsage } from '../application/ports.js';
import { addUsage, modelOf, readDirs, toolCountHook, withTeamInstruction } from './agent-sdk-team-member.js';

describe('withTeamInstruction', () => {
  it('추가 지시가 없으면 시스템 프롬프트를 그대로 둔다', () => {
    expect(withTeamInstruction('시스템', undefined)).toBe('시스템');
    expect(withTeamInstruction('시스템', '  ')).toBe('시스템');
  });

  it('추가 지시는 시스템 프롬프트 끝에 구분해 붙인다', () => {
    const text = withTeamInstruction('시스템', ' 존댓말로 ');
    expect(text.startsWith('시스템\n\n')).toBe(true);
    expect(text).toContain('<user-team-instruction>');
    expect(text).toContain('존댓말로');
  });
});

describe('toolCountHook', () => {
  const run = (hook: ReturnType<typeof toolCountHook>, input: Record<string, unknown>) => hook(input as never, undefined, { signal: new AbortController().signal });

  it('도구를 쓸 때마다 이름만 세고 입력 내용은 남기지 않는다', async () => {
    const tally = ToolTally.empty();
    const hook = toolCountHook(tally);
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'SECRET_KEY', path: 'C:/비밀' } });
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: {} });
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} });
    expect(tally.entries()).toEqual([{ name: 'Grep', count: 2 }, { name: 'Read', count: 1 }]);
    expect(JSON.stringify(tally.entries())).not.toContain('SECRET_KEY');
  });

  it('PostToolUse가 아닌 이벤트는 세지 않는다', async () => {
    const tally = ToolTally.empty();
    await run(toolCountHook(tally), { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} });
    expect(tally.entries()).toEqual([]);
  });
});

describe('readDirs', () => {
  it('호출이 더 읽을 폴더와 항상 읽을 폴더를 겹치지 않게 합친다', () => {
    expect(readDirs(['/a', '/b'], ['/b', '/img'])).toEqual(['/a', '/b', '/img']);
  });
  it('둘 다 없으면 빈 목록이다(읽을 폴더가 늘지 않는다)', () => {
    expect(readDirs(undefined, undefined)).toEqual([]);
  });
});

describe('modelOf', () => {
  const setting = (tier: 'haiku' | 'sonnet' | 'opus') => ({ tier }) as never;
  it('부르는 쪽이 정한 모델이 있으면 그것을 쓴다', () => {
    expect(modelOf({ setting: setting('opus'), model: 'claude-fable-5-2' })).toBe('claude-fable-5-2');
  });
  it('없으면 등급의 기본 모델이다', () => {
    expect(modelOf({ setting: setting('sonnet') })).toBe('claude-sonnet-5-5');
  });
});

describe('이어서 부른 호출의 사용량 합치기', () => {
  const usage = (over: Partial<MemberUsage>): MemberUsage => ({ model: 'm', durationMs: 10, costUsd: 0.1, turns: 3, inputTokens: 100, outputTokens: 50, cacheReadTokens: 5, denials: [], endReason: 'success', ...over });

  it('앞 호출이 없으면 마지막 호출 그대로다', () => {
    expect(addUsage(null, usage({}))).toEqual(usage({}));
  });

  it('시간·턴·토큰은 더하고 종료 이유는 마지막 호출의 것을 쓴다', () => {
    const sum = addUsage(usage({ endReason: 'error_max_turns', denials: ['Bash: x'] }), usage({ turns: 7, denials: ['Edit: y'] }));
    expect(sum).toMatchObject({ durationMs: 20, turns: 10, inputTokens: 200, outputTokens: 100, cacheReadTokens: 10, endReason: 'success', denials: ['Bash: x', 'Edit: y'] });
  });
});
