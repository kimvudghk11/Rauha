import { query, startup, type Options, type SDKMessage, type SDKResultMessage, type WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SecretPolicy } from '../domain/secret-policy.js';
import { MODEL_ID } from '../domain/team.js';
import type { AccountBlock, MemberCall, MemberResult, MemberUsage, PreparedCall, TeamMemberPort } from '../application/ports.js';
import type { PromptLibrary } from './prompt-library.js';
import { BROWSER_SERVER, BROWSER_TOOLS, localBrowserServer } from './browser-mcp.js';
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
    try {
      for await (const message of opened.messages) {
        if (message.type === 'result') result = message;
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
      return { output: null, error, usage, fetched, blocked: accountBlock(error) };
    }
    return { output: result.structured_output ?? null, error: result.structured_output === undefined ? '구조화 출력이 없습니다.' : null, usage, fetched };
  }

  /** 다른 폴더도 읽거나 브라우저를 붙이는 호출은 띄울 때의 설정이 달라서 미리 띄운 프로세스를 쓰지 않는다. */
  private takeSpare(call: MemberCall): Spare | null {
    if ((call.additionalDirectories?.length ?? 0) > 0 || call.browser === true) return null;
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

  private sdkOptions(call: PreparedCall & Pick<MemberCall, 'additionalDirectories' | 'browser'>, session: Session): Options {
    const browser = call.browser === true;
    return {
      model: MODEL_ID[call.setting.tier],
      abortController: session.controller,
      cwd: this.options.cwd,
      ...((call.additionalDirectories?.length ?? 0) > 0 ? { additionalDirectories: [...call.additionalDirectories!] } : {}),
      env: this.options.env,
      systemPrompt: this.options.prompts.system(call.role),
      tools: [...call.setting.tools],
      allowedTools: [...call.setting.tools, ...(browser ? BROWSER_TOOLS : [])],
      // 브라우저 도구는 요청이 웹페이지를 가리킬 때만 붙인다(도구 설명만 2만 자쯤이라).
      ...(browser ? { mcpServers: { [BROWSER_SERVER]: localBrowserServer(this.options.env) } } : {}),
      permissionMode: 'dontAsk',
      settingSources: call.setting.readsProject ? ['project'] : [],
      effort: call.setting.effort,
      maxTurns: call.setting.maxTurns,
      maxBudgetUsd: call.setting.maxBudgetUsd,
      outputFormat: { type: 'json_schema', schema: call.outputSchema },
      hooks: {
        PreToolUse: [{ hooks: [createToolGuard({ root: this.options.cwd, role: call.role, canWrite: call.canWrite, ask: this.options.ask, remembered: this.remembered, secrets: this.options.secrets, secretFiles: this.secretFilesOnce(), extraRoots: call.additionalDirectories ?? [] })] }],
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
