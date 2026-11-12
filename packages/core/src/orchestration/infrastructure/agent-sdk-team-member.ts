import { query, startup, type HookCallback, type Options, type SDKMessage, type SDKResultMessage, type WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SecretPolicy } from '../domain/secret-policy.js';
import { MODEL_ID } from '../domain/team.js';
import type { AccountBlock, MemberCall, MemberResult, MemberUsage, PreparedCall, TeamMemberPort } from '../application/ports.js';
import type { PromptLibrary } from './prompt-library.js';
import { kitServers, type KitServers } from './tool-kits.js';
import type { ConnectorServers } from './connector-servers.js';
import { createFetchLog } from './fetch-log.js';
import { createToolGuard, type PermissionAsker } from './tool-guard.js';
import { ToolTally } from '../domain/tool-tally.js';
import { accountBlock } from './usage-limit.js';
import { MemberContinue } from '../domain/member-continue.js';
import { GitPublishIntent } from '../domain/git-publish-intent.js';
import { ConnectorWriteIntent } from '../domain/connector.js';
import { PluginReach } from '../domain/plugin.js';
import type { MemberRole } from '../domain/member-role.js';
import { DbToolAccess } from '../domain/db-tools.js';
import type { LinkedDatabase } from '../application/linked-database.js';
import { withDatabase } from './db-mcp.js';

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
  /** 작업 폴더 밖에서 읽기만 허락할 폴더들(예: 사용자가 채팅에 붙인 이미지가 있는 임시 폴더). 쓰기는 늘어나지 않는다. */
  readonly readRoots?: readonly string[];
  /** 사용자가 연결한 커넥터(노션·컨플루언스 …). 'connectors' 도구 묶음을 고른 호출에만 붙인다. 부를 때마다 최신 목록. */
  readonly connectors?: () => ConnectorServers;
  /** 작업 레포에 연결된 DB(DB 탭에 저장한 연결 중 레포 설정과 맞는 것). 코드 작업 팀원 호출에만 읽기 전용 도구로 붙인다. 없으면 null. 실행마다 한 번만 찾는다. */
  readonly database?: () => Promise<LinkedDatabase | null>;
  /** 켜 둔 플러그인과 사용자 스킬 폴더(Claude Code 가 설치한 곳). 일하는 팀원(PluginReach)에게만 붙인다. 부를 때마다 최신 목록. */
  readonly plugins?: () => readonly PluginLoad[];
}

/** 팀원 세션에 붙일 플러그인 폴더 하나 */
export interface PluginLoad {
  readonly path: string;
}

/** 호출 하나가 쓰는 것들. 미리 띄운 프로세스는 띄울 때 이것까지 정해진다. */
interface Session {
  readonly controller: AbortController;
  readonly fetchLog: ReturnType<typeof createFetchLog>;
  readonly tally: ToolTally;
  readonly stderr: string[];
  /** 사용자가 커밋·push·PR을 시켰는지. 미리 띄운 프로세스는 요청이 나중에 정해지므로 상자로 둔다. */
  readonly intent: { current: GitPublishIntent };
  /** 사용자가 업무 도구(노션·컨플루언스 …)에 쓰라고 시켰는지. 미리 띄운 프로세스는 요청이 나중에 정해지므로 상자로 둔다. */
  readonly connectorIntent: { current: ConnectorWriteIntent };
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
  /** 레포에 연결된 DB 를 찾은 결과(처음 필요할 때 한 번) */
  private linked: Promise<LinkedDatabase | null> | null = null;

  constructor(private readonly options: AgentSdkTeamMemberOptions) {}

  /** 이 역할이 DB 도구를 받는 역할일 때만 DB 를 찾는다. 찾다 실패하면 붙이지 않는다. */
  private async databaseFor(call: MemberCall): Promise<LinkedDatabase | null> {
    if (this.options.database === undefined || !DbToolAccess.wants(call.role)) return null;
    this.linked ??= this.options.database().catch(() => null);
    const db = await this.linked;
    return DbToolAccess.attaches(call.role, db !== null) ? db : null;
  }

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
    const model = modelOf(call);
    const started = Date.now();
    if (this.cancelled || call.signal?.aborted === true) return { output: null, error: CANCELLED.message, usage: emptyUsage(model, 0), fetched: [], blocked: CANCELLED };
    const db = await this.databaseFor(call);
    // DB 도구를 붙이는 호출은 띄울 때의 설정이 달라 미리 띄운 프로세스를 쓰지 않는다(그 프로세스는 남겨 둔다)
    const spare = db === null ? this.takeSpare(call) : null;
    // 가드는 도구 호출 때마다 이 값을 읽는다. 미리 띄운 프로세스도 메시지를 보내기 전에 이번 요청으로 맞춘다.
    const intent = GitPublishIntent.from(call.request ?? '');
    const connectorIntent = ConnectorWriteIntent.from(call.request ?? '');
    if (spare !== null) {
      spare.intent.current = intent;
      spare.connectorIntent.current = connectorIntent;
    }
    let opened: Session & { messages: AsyncIterable<SDKMessage> };
    try {
      opened = (spare !== null ? await this.claim(spare, call.userMessage) : null) ?? this.open(call, intent, db);
    } catch (error) {
      return { output: null, error: (error as Error).message, usage: emptyUsage(model, Date.now() - started), fetched: [], blocked: accountBlock((error as Error).message) };
    }
    const { controller, fetchLog, stderr, tally } = opened;
    const stop = () => controller.abort();
    call.signal?.addEventListener('abort', stop, { once: true });
    this.running.add(controller);
    let result: SDKResultMessage | null = null;
    let partial: string | null = null;
    let spent: MemberUsage | null = null;
    let messages = opened.messages;
    try {
      // 턴 한도에 닿았거나 결과 형식만 못 맞춘 호출은 멈추지 않고 같은 대화를 이어서 끝낸다(MemberContinue).
      for (let continued = 0; ; continued += 1) {
        result = null;
        try {
          for await (const message of messages) {
            if (message.type === 'result') result = message;
            else if (message.type === 'assistant') partial = lastText(message.message.content) ?? partial;
          }
        } catch (error) {
          // SDK는 턴 한도 같은 오류 결과를 준 뒤에 예외도 던진다. 결과를 이미 받았으면 그 결과로 판단한다(버리면 이어 하기도 멈춘 이유도 잃는다).
          if (result === null) throw error;
        }
        if (result === null || controller.signal.aborted) break;
        const done: SDKResultMessage = result;
        const failure = done.subtype === 'success' ? null : `${done.subtype}: ${done.errors.join(' / ')}`;
        if (failure !== null && accountBlock(failure) !== null) break;
        const next = MemberContinue.after({ endReason: done.terminal_reason ?? done.subtype, hasOutput: done.subtype === 'success' && done.structured_output !== undefined, done: continued });
        if (next === null) break;
        spent = addUsage(spent, toUsage(model, done));
        messages = query({ prompt: next.prompt, options: { ...this.sdkOptions(call, opened, db), resume: done.session_id } });
      }
    } catch (error) {
      const detail = stderr.join('').trim().split('\n').slice(-5).join('\n');
      const message = `${(error as Error).message}${detail ? `\n${detail}` : ''}`;
      return {
        output: null,
        error: message,
        usage: { ...addUsage(spent, emptyUsage(model, Date.now() - started)), tools: tally.entries() },
        fetched: fetchLog.entries(),
        blocked: controller.signal.aborted ? CANCELLED : accountBlock(message),
        partial,
      };
    } finally {
      this.running.delete(controller);
      call.signal?.removeEventListener('abort', stop);
      // 쓴 만큼 다시 채워 둔다. 다음 입력이 올 때쯤엔 준비가 끝나 있다.
      if (spare !== null) this.prepare(spare.call);
    }

    const fetched = fetchLog.entries();
    if (controller.signal.aborted) return { output: null, error: CANCELLED.message, usage: emptyUsage(model, Date.now() - started), fetched, blocked: CANCELLED };
    if (result === null) return { output: null, error: '결과 메시지를 받지 못했습니다.', usage: addUsage(spent, emptyUsage(model, Date.now() - started)), fetched, partial };
    const usage = { ...addUsage(spent, toUsage(model, result)), tools: tally.entries() };
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

  private open(call: MemberCall, intent: GitPublishIntent, db: LinkedDatabase | null): Session & { messages: AsyncIterable<SDKMessage> } {
    const session = newSession();
    session.intent.current = intent;
    session.connectorIntent.current = ConnectorWriteIntent.from(call.request ?? '');
    return { ...session, messages: query({ prompt: call.userMessage, options: this.sdkOptions(call, session, db) }) };
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

  private sdkOptions(call: PreparedCall & Pick<MemberCall, 'additionalDirectories' | 'kits'>, session: Session, db: LinkedDatabase | null = null): Options {
    const kits = withDatabase(withConnectors(kitServers(call.kits ?? [], this.options.env), (call.kits ?? []).includes('connectors') ? this.options.connectors?.() : undefined), db);
    const system = this.options.prompts.system(call.role, call.kits ?? []);
    const { tools: pluginTools, ...pluginLoad } = pluginOptions(call.role, this.options.plugins?.() ?? []);
    return {
      ...pluginLoad,
      model: modelOf(call),
      abortController: session.controller,
      cwd: this.options.cwd,
      ...(readDirs(call.additionalDirectories, this.options.readRoots).length > 0 ? { additionalDirectories: readDirs(call.additionalDirectories, this.options.readRoots) } : {}),
      env: this.options.env,
      ...(this.options.claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: this.options.claudeExecutable } : {}),
      systemPrompt: withTeamInstruction(this.withAlwaysRules(db === null ? system : withDbGuide(system, this.options.prompts.dbGuide(call.role))), call.setting.extraInstruction),
      tools: [...call.setting.tools, ...pluginTools],
      allowedTools: [...call.setting.tools, ...pluginTools, ...kits.tools],
      // 도구 묶음은 요청이 그쪽을 가리킬 때만 붙인다(도구 설명이 길어서).
      ...(kits.tools.length > 0 ? { mcpServers: kits.servers } : {}),
      permissionMode: 'dontAsk',
      settingSources: call.setting.readsProject ? ['project'] : [],
      effort: call.setting.effort,
      maxTurns: call.setting.maxTurns,
      outputFormat: { type: 'json_schema', schema: call.outputSchema },
      hooks: {
        PreToolUse: [{ hooks: [createToolGuard({ root: this.options.cwd, role: call.role, canWrite: call.canWrite, ask: this.options.ask, remembered: this.remembered, secrets: this.options.secrets, secretFiles: this.secretFilesOnce(), extraRoots: call.additionalDirectories ?? [], publishIntent: () => session.intent.current, connectors: kits.connectorNames, connectorIntent: () => session.connectorIntent.current,...(this.options.rules !== undefined ? { rules: this.options.rules } : {}) })] }],
        PostToolUse: [{ hooks: [session.fetchLog.hook, toolCountHook(session.tally)] }],
      },
      stderr: (data) => {
        session.stderr.push(data);
        if (session.stderr.length > 50) session.stderr.shift();
      },
    };
  }
}

/**
 * 켜 둔 플러그인·사용자 스킬을 일하는 팀원 세션에 붙인다. settingSources 'user' 를 쓰면 사용자 설정(권한·훅·모델)까지 따라와서
 * 플러그인 폴더만 SDK plugins 로 넘긴다. 플러그인의 MCP 서버는 붙이지 않는다(업무 도구는 커넥터 화면에서 연결하고 쓰기를 가드가 묻는다).
 */
export function pluginOptions(role: MemberRole, loads: readonly PluginLoad[]): Pick<Options, 'plugins' | 'skills'> & { readonly tools: readonly string[] } {
  if (loads.length === 0 || !PluginReach.loads(role)) return { tools: [] };
  return { plugins: loads.map((p) => ({ type: 'local' as const, path: p.path, skipMcpDiscovery: true })), skills: 'all', tools: ['Skill'] };
}

/** 도구 묶음에 연결한 커넥터 서버를 더한다. 커넥터 묶음을 고르지 않았거나 연결이 없으면 그대로. */
export function withConnectors(kits: KitServers, connectors: ConnectorServers | undefined): KitServers & { readonly connectorNames: readonly string[] } {
  if (connectors === undefined || connectors.names.length === 0) return { ...kits, connectorNames: [] };
  return { servers: { ...kits.servers, ...connectors.servers }, tools: [...kits.tools, ...connectors.tools], connectorNames: connectors.names };
}

/** DB 도구를 붙인 호출에만 그 사용법을 시스템 프롬프트에 더한다 */
export function withDbGuide(system: string, guide: string): string {
  return guide === '' ? system : `${system}\n\n${guide}`;
}

/** 호출이 더 읽을 폴더 + 항상 읽을 폴더(중복 없이) */
export function readDirs(call: readonly string[] | undefined, always: readonly string[] | undefined): string[] {
  return [...new Set([...(call ?? []), ...(always ?? [])])];
}

/** 부르는 쪽이 정한 모델이 있으면 그것, 없으면 등급의 기본 모델 */
export function modelOf(call: Pick<PreparedCall, 'setting' | 'model'>): string {
  return call.model ?? MODEL_ID[call.setting.tier];
}

const CANCELLED: AccountBlock = { reason: 'cancelled', message: '사용자가 작업을 멈췄습니다.' };

function newSession(): Session {
  return { controller: new AbortController(), fetchLog: createFetchLog(), tally: ToolTally.empty(), stderr: [], intent: { current: GitPublishIntent.none() }, connectorIntent: { current: ConnectorWriteIntent.none() } };
}

/** 미리 띄운 프로세스는 띄울 때의 설정이 고정되므로, 역할·설정·출력 형식이 모두 같을 때만 쓴다. */
function spareKey(call: PreparedCall): string {
  return JSON.stringify([call.role, call.setting, call.outputSchema, modelOf(call)]);
}

/** 도구를 쓸 때마다 이름만 센다(입력·경로는 보지 않는다). */
export function toolCountHook(tally: ToolTally): HookCallback {
  return async (input) => {
    if (input.hook_event_name === 'PostToolUse') tally.record(input.tool_name);
    return {};
  };
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

/** 이어서 부른 호출들의 사용량을 하나로 합친다. 종료 이유와 거절 목록은 마지막 호출의 것이다. */
export function addUsage(before: MemberUsage | null, last: MemberUsage): MemberUsage {
  if (before === null) return last;
  return {
    ...last,
    durationMs: before.durationMs + last.durationMs,
    costUsd: before.costUsd + last.costUsd,
    turns: before.turns + last.turns,
    inputTokens: before.inputTokens + last.inputTokens,
    outputTokens: before.outputTokens + last.outputTokens,
    cacheReadTokens: before.cacheReadTokens + last.cacheReadTokens,
    denials: [...before.denials, ...last.denials],
  };
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
