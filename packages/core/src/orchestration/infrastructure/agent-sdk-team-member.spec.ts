import { describe, expect, it } from 'vitest';
import { ToolTally } from '../domain/tool-tally.js';
import { CrewWatch } from '../domain/direct-crew.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { MemberUsage } from '../application/ports.js';
import { addUsage, crewSteps, modelOf, openedHook, pluginOptions, readDirs, toolCountHook, withConnectors, withTeamInstruction, withUserNotes } from './agent-sdk-team-member.js';

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

describe('openedHook', () => {
  const run = (hook: ReturnType<typeof openedHook>, input: Record<string, unknown>) => hook(input as never, undefined, { signal: new AbortController().signal });

  it('읽기 도구가 연 경로만 남긴다(Read 파일, Grep·Glob 폴더, git -C 저장소). 검색어·명령 내용은 남기지 않는다', async () => {
    const opened: string[] = [];
    const hook = openedHook(opened);
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'E:/a/src/x.ts' } });
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'SECRET_KEY', path: 'E:/a/src' } });
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Glob', tool_input: { pattern: '**/*.ts', path: 'E:/b' } });
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git -C "E:/c d" log --oneline && git -C E:/e status' } });
    await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } });
    await run(hook, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'E:/not-yet.ts' } });
    expect(opened).toEqual(['E:/a/src/x.ts', 'E:/a/src', 'E:/b', 'E:/c d', 'E:/e']);
    expect(opened.join(' ')).not.toContain('SECRET_KEY');
  });

  it('너무 많이 쌓이지 않게 앞의 것부터 버린다', async () => {
    const opened: string[] = [];
    const hook = openedHook(opened, 2);
    for (const f of ['a', 'b', 'c']) await run(hook, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: f } });
    expect(opened).toEqual(['b', 'c']);
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
  const setting = (tier: 'sonnet' | 'opus' | 'fable') => ({ tier }) as never;
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

describe('withConnectors', () => {
  const connectors = { servers: { notion: { type: 'http' as const, url: 'https://mcp.notion.com/mcp' } }, tools: ['mcp__notion'], names: ['notion'] };

  it('커넥터 묶음을 고른 호출에는 연결한 서버와 서버 단위 허락을 더한다', () => {
    const kits = withConnectors({ servers: { aws: { type: 'http', url: 'https://knowledge-mcp.global.api.aws' } }, tools: ['mcp__aws__x'] }, connectors);
    expect(Object.keys(kits.servers)).toEqual(['aws', 'notion']);
    expect(kits.tools).toEqual(['mcp__aws__x', 'mcp__notion']);
    expect(kits.connectorNames).toEqual(['notion']);
  });

  it('고르지 않았거나 연결이 없으면 아무것도 더하지 않는다', () => {
    expect(withConnectors({ servers: {}, tools: [] }, undefined)).toEqual({ servers: {}, tools: [], connectorNames: [] });
    expect(withConnectors({ servers: {}, tools: [] }, { servers: {}, tools: [], names: [] }).connectorNames).toEqual([]);
  });
});

describe('pluginOptions', () => {
  const loads = [{ path: 'C:/cfg/plugins/cache/x/superpowers/7.0.2' }, { path: 'C:/cfg' }];

  it('일하는 팀원에게는 켜 둔 플러그인을 MCP 없이 붙이고 스킬 도구를 연다', () => {
    expect(pluginOptions('implementer', loads)).toEqual({
      plugins: [
        { type: 'local', path: 'C:/cfg/plugins/cache/x/superpowers/7.0.2', skipMcpDiscovery: true },
        { type: 'local', path: 'C:/cfg', skipMcpDiscovery: true },
      ],
      skills: 'all',
      tools: ['Skill'],
    });
  });

  it('짧은 판정 팀원이나 플러그인이 없으면 아무것도 붙이지 않는다', () => {
    expect(pluginOptions('router', loads)).toEqual({ tools: [] });
    expect(pluginOptions('implementer', [])).toEqual({ tools: [] });
  });

  it('플러그인을 빼라고 한 호출(가벼운 답)에는 같은 팀원이라도 붙이지 않는다(세션 시작 훅·스킬 목록이 매번 입력을 늘린다)', () => {
    expect(pluginOptions('answerer', loads, false)).toEqual({ tools: [] });
    expect(pluginOptions('answerer', loads).tools).toEqual(['Skill']);
  });
});

describe('withUserNotes', () => {
  it('규칙과 취향이 없으면 시스템 프롬프트 그대로다', () => {
    expect(withUserNotes('SYS', '', '')).toBe('SYS');
  });
  it('사용자 말에서 배운 취향은 user-style 로, 규칙 뒤에 붙는다', () => {
    const text = withUserNotes('SYS', '- 커밋은 한국어', '- 추측 말고 확인한 것만');
    expect(text.indexOf('<user-rules>')).toBeLessThan(text.indexOf('<user-style>'));
    expect(text).toContain('- 추측 말고 확인한 것만');
    expect(text).toContain('사실 확인보다 앞서지는 않습니다');
  });
  it('사용자의 Claude Code 설정(CLAUDE.md·import)은 claude-md 로 규칙 앞에, rauha 기억은 rauha-memory 로 끝에 붙는다', () => {
    const text = withUserNotes('SYS', '- 규칙', '', { claudeMd: '회사 룰: DDD', memory: '## memory.md\nVPN 은 …' });
    expect(text.indexOf('<claude-md>')).toBeLessThan(text.indexOf('<user-rules>'));
    expect(text).toContain('회사 룰: DDD');
    expect(text.indexOf('<rauha-memory>')).toBeGreaterThan(text.indexOf('<user-rules>'));
    expect(text).toContain('VPN 은 …');
    expect(withUserNotes('SYS', '', '', { claudeMd: '', memory: '' })).toBe('SYS');
  });
});

describe('crewSteps', () => {
  const assistant = (content: unknown[], parent: string | null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content } }) as unknown as SDKMessage;
  const user = (content: unknown[]) => ({ type: 'user', parent_tool_use_id: null, message: { content } }) as unknown as SDKMessage;

  it('지배인이 팀원에게 넘기고, 팀원이 도구를 쓰고, 지배인에게 돌아오는 흐름을 진행 줄로 바꾼다', () => {
    const watch = CrewWatch.start();
    expect(crewSteps(watch, assistant([{ type: 'text', text: '넘길게요' }, { type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'implementer', description: '로그인 고치기' } }], null))).toEqual([{ role: 'implementer', text: '넘겨받았어요: 로그인 고치기' }]);
    expect(crewSteps(watch, assistant([{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'src/login.ts' } }], 't1'))).toEqual([{ role: 'implementer', text: '고치는 중: login.ts' }]);
    expect(crewSteps(watch, user([{ type: 'tool_result', tool_use_id: 't1', content: 'done' }]))).toEqual([{ role: 'direct', text: '구현 받았어요' }]);
  });

  it('글만 있는 메시지나 결과 메시지는 진행 줄이 없다', () => {
    const watch = CrewWatch.start();
    expect(crewSteps(watch, assistant([{ type: 'text', text: '안녕' }], null))).toEqual([]);
    expect(crewSteps(watch, { type: 'result' } as unknown as SDKMessage)).toEqual([]);
    expect(crewSteps(watch, user(['plain']))).toEqual([]);
  });
});
