import { query, startup, type Options, type SDKMessage, type SDKResultMessage, type WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SecretPolicy } from '../domain/secret-policy.js';
import { MODEL_ID } from '../domain/team.js';
import type { AccountBlock, MemberCall, MemberResult, MemberUsage, PreparedCall, TeamMemberPort } from '../application/ports.js';
import type { PromptLibrary } from './prompt-library.js';
import { kitServers } from './tool-kits.js';
import { createFetchLog } from './fetch-log.js';
import { createToolGuard, type PermissionAsker } from './tool-guard.js';
import { accountBlock } from './usage-limit.js';

export interface AgentSdkTeamMemberOptions {
  /** 작업 폴더. 팀원은 이 안에서만 일한다. */
  readonly cwd: string;
  /** process.env + 프로필의 CLAUDE_CONFIG_DIR. SDK의 env는 환경 전체를 바꾸므로 PATH까지 넘긴다. */
  readonly env: Record<string, string>;
  readonly prompts: PromptLibrary;
  readonly ask: PermissionAsker;
  /** 팀원이 읽지도 쓰지도 못하는 비밀 파일 규칙 */
  readonly secrets: SecretPolicy;
  /** 작업 폴더 아래 실제로 있는 비밀 파일. 호출마다 다시 읽는다(작업 중에 생길 수 있어서). */
  readonly secretFiles: () => readonly string[];
  /** Claude Code 실행 파일 경로. 설치본에서는 asar 밖의 실행 파일을 가리킨다. 없으면 SDK가 자기 방식으로 찾는다. */
  readonly claudeExecutable?: string;
  /** 사용자 규칙 판정(규칙 탭). 호출 때마다 부르므로 규칙을 고치면 바로 반영된다. */
  readonly rules?: (tool: string, detail: string) => 'allow' | 'ask' | null;
  /** 사용자의 "항상 지킬 것" 글. 팀원 시스템 프롬프트 끝에 붙는다. 없으면 빈 글. */
  readonly alwaysRules?: () => string;
}

/** 호출 하나가 쓰는 것들. 미리 띄운 프로세스는 띄울 때 이것까지 정해진다. */
interface Session {
  readonly controller: AbortController;
  readonly fetchLog: ReturnType<typeof createFetchLog>;
  readonly stderr: string[];
}

/** 미리 띄워 둔 프로세스. 메시지만 보내면 바로 일을 시작한다. */
interface Spare extends Session {
  readonly call: PreparedCall;
  readonly warm: Promise<WarmQuery>;
}

/**
 * 팀원 한 명 = Agent SDK query() 한 번. 역할 프롬프트는 짧은 자체 문자열로 넣어
 * (claude_code preset 대신) 앞부분을 고정하고 캐시가 잘 먹게 한다.
 */
/** 팀 설정에서 사용자가 이 팀원에게 더한 지시를 시스템 프롬프트 끝에 붙인다(없으면 그대로). */
export function withTeamInstruction(system: string, extra: string | undefined): string {
  return extra === undefined || extra.trim() === '' ? system : `${system}\n\n<user-team-instruction>\n사용자가 이 팀원에게 더한 지시입니다.\n${extra.trim()}\n</user-team-instruction>`;
}

export class AgentSdkTeamMember implements TeamMemberPort {
  /** 이번 실행 동안 사용자가 계속 허락한 동작. 이 객체는 실행 한 번에 하나라서 여기 둔다. */
  private readonly remembered = new Set<string>();
  /** 지금 돌고 있는 호출들. cancel이 한꺼번에 멈춘다. */
  private readonly running = new Set<AbortController>();
  /** 역할·설정별로 하나씩 미리 띄워 둔 프로세스 */
  private readonly spares = new Map<string, Spare>();
  private cancelled = false;
  private closed = false;

  constructor(private readonly options: AgentSdkTeamMemberOptions) {}

  /** 돌고 있는 호출을 모두 멈추고, resume 전까지 새 호출도 바로 '멈춤'으로 돌려준다(서비스가 흐름을 끊는다). */
  cancel(): void {
    this.cancelled = true;
    for (const controller of this.running) controller.abort();
  }

  resume(): void {
    this.cancelled = false;
  }

  /** 프로세스를 띄우고 초기화하는 시간(2초쯤)을 사용자가 입력하는 동안 미리 쓴다. 이미 하나 있으면 그대로 둔다. */
  prepare(call: PreparedCall): void {
    const key = spareKey(call);
    if (this.closed || this.spares.has(key)) return;
    const session = newSession();
    const warm = startup({ options: this.sdkOptions(call, session) });
    // 띄우다 실패하면 버린다. 그 역할은 다음 호출에서 평소처럼 새로 띄운다.
    warm.catch(() => {
      if (this.spares.get(key)?.warm === warm) this.spares.delete(key);
    });
    this.spares.set(key, { ...session, call, warm });
  }

  /** 미리 띄운 프로세스를 모두 닫는다. 대화 화면을 닫을 때 부른다. */
  close(): void {
    this.closed = true;
    for (const spare of this.spares.values()) {
      spare.controller.abort();
      spare.warm.then((w) => w.close(), () => undefined);
    }
    this.spares.clear();
  }

  async run(call: MemberCall): Promise<MemberResult> {
    const model = MODEL_ID[call.setting.tier];
    const started = Date.now();
    if (this.cancelled || call.signal?.aborted === true) return { output: null, error: CANCELLED.message, usage: emptyUsage(model, 0), fetched: [], blocked: CANCELLED };
    const spare = this.takeSpare(call);
    let opened: Session & { messages: AsyncIterable<SDKMessage> };
    try {
      opened = (spare !== null ? await this.claim(spare, call.userMessage) : null) ?? this.open(call);
    } catch (error) {
      return { output: null, error: (error as Error).message, usage: emptyUsage(model, Date.now() - started), fetched: [], blocked: accountBlock((error as Error).message) };
    }
    const { controller, fetchLog, stderr } = opened;
    const stop = () => controller.abort();
    call.signal?.addEventListener('abort', stop, { once: true });
    this.running.add(controller);
    let result: SDKResultMessage | null = null;
    let partial: string | null = null;
    try {
      for await (const message of opened.messages) {
        if (message.type === 'result') result = message;
        else if (message.type === 'assistant') partial = lastText(message.message.content) ?? partial;
      }
    } catch (error) {
      const detail = stderr.join('').trim().split('\n').slice(-5).join('\n');
      const message = `${(error as Error).message}${detail ? `\n${detail}` : ''}`;
      return {
        output: null,
        error: message,
        usage: emptyUsage(model, Date.now() - started),
        fetched: fetchLog.entries(),
        blocked: controller.signal.aborted ? CANCELLED : accountBlock(message),
      };
    } finally {
      this.running.delete(controller);
      call.signal?.removeEventListener('abort', stop);
      // 쓴 만큼 다시 채워 둔다. 다음 입력이 올 때쯤엔 준비가 끝나 있다.
      if (spare !== null) this.prepare(spare.call);
    }

    const fetched = fetchLog.entries();
    if (controller.signal.aborted) return { output: null, error: CANCELLED.message, usage: emptyUsage(model, Date.now() - started), fetched, blocked: CANCELLED };
    if (result === null) return { output: null, error: '결과 메시지를 받지 못했습니다.', usage: emptyUsage(model, Date.now() - started), fetched };
    const usage = toUsage(model, result);
    if (result.subtype !== 'success') {
      const error = `${result.subtype}: ${result.errors.join(' / ')}`;
      return { output: null, error, usage, fetched, blocked: accountBlock(error), partial };
    }
    return { output: result.structured_output ?? null, error: result.structured_output === undefined ? '구조화 출력이 없습니다.' : null, usage, fetched, partial };
  }

  /** 다른 폴더도 읽거나 도구 묶음을 붙이는 호출은 띄울 때의 설정이 달라서 미리 띄운 프로세스를 쓰지 않는다. */
  private takeSpare(call: MemberCall): Spare | null {
    if ((call.additionalDirectories?.length ?? 0) > 0 || (call.kits?.length ?? 0) > 0) return null;
    const key = spareKey(call);
    const spare = this.spares.get(key) ?? null;
    this.spares.delete(key);
    return spare;
  }

  /** 미리 띄운 프로세스에 메시지를 보낸다. 띄우기에 실패했으면 null(새로 띄운다). */
  private async claim(spare: Spare, prompt: string): Promise<(Session & { messages: AsyncIterable<SDKMessage> }) | null> {
    try {
      const warm = await spare.warm;
      return { ...spare, messages: warm.query(prompt) };
    } catch {
      return null;
    }
  }

  private open(call: MemberCall): Session & { messages: AsyncIterable<SDKMessage> } {
    const session = newSession();
    return { ...session, messages: query({ prompt: call.userMessage, options: this.sdkOptions(call, session) }) };
  }

  /** 한 호출 동안은 처음 읽은 목록을 다시 쓴다(도구 호출마다 git을 부르지 않게). */
  private secretFilesOnce(): () => readonly string[] {
    let files: readonly string[] | null = null;
    return () => (files ??= this.options.secretFiles());
  }

  /** 사용자가 정한 "항상 지킬 것"을 시스템 프롬프트 끝에 붙인다(rauha 개발 규칙이 아니라 사용자 규칙이다). */
  private withAlwaysRules(system: string): string {
    const rules = this.options.alwaysRules?.() ?? '';
    return rules === '' ? system : `${system}\n\n<user-rules>\n사용자가 항상 지키라고 정한 규칙입니다.\n${rules}\n</user-rules>`;
  }

  private sdkOptions(call: PreparedCall & Pick<MemberCall, 'additionalDirectories' | 'kits'>, session: Session): Options {
    const kits = kitServers(call.kits ?? [], this.options.env);
    return {
      model: MODEL_ID[call.setting.tier],
      abortController: session.controller,
      cwd: this.options.cwd,
      ...((call.additionalDirectories?.length ?? 0) > 0 ? { additionalDirectories: [...call.additionalDirectories!] } : {}),
      env: this.options.env,
      ...(this.options.claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: this.options.claudeExecutable } : {}),
      systemPrompt: withTeamInstruction(this.withAlwaysRules(this.options.prompts.system(call.role, call.kits ?? [])), call.setting.extraInstruction),
      tools: [...call.setting.tools],
      allowedTools: [...call.setting.tools, ...kits.tools],
      // 도구 묶음은 요청이 그쪽을 가리킬 때만 붙인다(도구 설명이 길어서).
      ...(kits.tools.length > 0 ? { mcpServers: kits.servers } : {}),
      permissionMode: 'dontAsk',
      settingSources: call.setting.readsProject ? ['project'] : [],
      effort: call.setting.effort,
      maxTurns: call.setting.maxTurns,
      maxBudgetUsd: call.setting.maxBudgetUsd,
      outputFormat: { type: 'json_schema', schema: call.outputSchema },
      hooks: {
        PreToolUse: [{ hooks: [createToolGuard({ root: this.options.cwd, role: call.role, canWrite: call.canWrite, ask: this.options.ask, remembered: this.remembered, secrets: this.options.secrets, secretFiles: this.secretFilesOnce(), extraRoots: call.additionalDirectories ?? [], ...(this.options.rules !== undefined ? { rules: this.options.rules } : {}) })] }],
        PostToolUse: [{ hooks: [session.fetchLog.hook] }],
      },
      stderr: (data) => {
        session.stderr.push(data);
        if (session.stderr.length > 50) session.stderr.shift();
      },
    };
  }
}

const CANCELLED: AccountBlock = { reason: 'cancelled', message: '사용자가 작업을 멈췄습니다.' };

function newSession(): Session {
  return { controller: new AbortController(), fetchLog: createFetchLog(), stderr: [] };
}

/** 미리 띄운 프로세스는 띄울 때의 설정이 고정되므로, 역할·설정·출력 형식이 모두 같을 때만 쓴다. */
function spareKey(call: PreparedCall): string {
  return JSON.stringify([call.role, call.setting, call.outputSchema]);
}

/** assistant 메시지 내용에서 마지막 글 블록. 없으면 null. */
function lastText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' && (b as { text: string }).text.trim() !== '');
  return texts.length === 0 ? null : texts[texts.length - 1]!.text;
}

function emptyUsage(model: string, durationMs: number): MemberUsage {
  return { model, durationMs, costUsd: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, denials: [], endReason: 'error' };
}

function toUsage(model: string, result: SDKResultMessage): MemberUsage {
  const models = Object.values(result.modelUsage ?? {});
  return {
    model,
    durationMs: result.duration_ms,
    costUsd: result.total_cost_usd,
    turns: result.num_turns,
    inputTokens: models.reduce((n, m) => n + m.inputTokens + m.cacheCreationInputTokens, 0),
    outputTokens: models.reduce((n, m) => n + m.outputTokens, 0),
    cacheReadTokens: models.reduce((n, m) => n + m.cacheReadInputTokens, 0),
    denials: result.permission_denials.map((d) => `${d.tool_name}: ${JSON.stringify(d.tool_input).slice(0, 160)}`),
    endReason: result.terminal_reason ?? result.subtype,
  };
}
