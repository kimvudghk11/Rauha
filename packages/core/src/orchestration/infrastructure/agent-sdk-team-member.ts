import { appendFileSync } from 'node:fs';
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
import { LEAN_SESSION } from './lean-session.js';
import { GitPublishIntent } from '../domain/git-publish-intent.js';
import { ConnectorWriteIntent } from '../domain/connector.js';
import { PluginReach } from '../domain/plugin.js';
import type { MemberRole } from '../domain/member-role.js';
import { DbToolAccess } from '../domain/db-tools.js';
import type { LinkedDatabase } from '../application/linked-database.js';
import { withDatabase } from './db-mcp.js';
import { WorkspaceToolAccess } from '../domain/workspace-tools.js';
import type { WorkspaceFacts } from '../application/workspace-facts.js';
import { withWorkspace } from './workspace-mcp.js';
import { CrewWatch, DirectCrew, type CrewStep } from '../domain/direct-crew.js';
import { crewAgents, crewBrief } from './direct-crew-agents.js';

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
  /** 사용자 말에서 배운 답변·작업 취향(스타일 그래프). 팀원 시스템 프롬프트 끝에 붙는다. 없으면 빈 글. */
  readonly styleNotes?: () => string;
  /** 사용자의 Claude Code 지시(~/.claude/CLAUDE.md 와 @import 를 이은 글). 팀원도 Claude Code 처럼 따른다. 없으면 빈 글. */
  readonly claudeMd?: () => string;
  /** 사용자가 rauha 에 저장해 둔 기억(rauha 노트). 없으면 빈 글. */
  readonly memoryNotes?: () => string;
  /** 작업 폴더 밖에서 읽기만 허락할 폴더들(예: 사용자가 채팅에 붙인 이미지가 있는 임시 폴더). 쓰기는 늘어나지 않는다. */
  readonly readRoots?: readonly string[];
  /** 사용자가 연결한 커넥터(노션·컨플루언스 …). 'connectors' 도구 묶음을 고른 호출에만 붙인다. 부를 때마다 최신 목록. */
  readonly connectors?: () => ConnectorServers;
  /** 작업 레포에 연결된 DB(DB 탭에 저장한 연결 중 레포 설정과 맞는 것). 코드 작업 팀원 호출에만 읽기 전용 도구로 붙인다. 없으면 null. 실행마다 한 번만 찾는다. */
  readonly database?: () => Promise<LinkedDatabase | null>;
  /** 켜 둔 플러그인과 사용자 스킬 폴더(Claude Code 가 설치한 곳). 일하는 팀원(PluginReach)에게만 붙인다. 부를 때마다 최신 목록. */
  readonly plugins?: () => readonly PluginLoad[];
  /** rauha 작업 공간 사실(레포 목록·최근 변경·내 커밋·할 일). 답변·문서·분석 팀원(WorkspaceToolAccess)에게 읽기 전용 도구(mcp__rauha__*)로 붙인다. */
  readonly workspace?: () => WorkspaceFacts | undefined;
  /** 지금 AWS 상태 한 줄(프로필·리전·VPN). AWS 도구 묶음을 붙인 호출에만 붙인다. 팀원이 이걸 알아내려고 쓰는 턴을 없앤다. 없으면 빈 글. */
  readonly awsNow?: () => string;
}

/** AWS 도구 묶음을 붙인 호출에만 지금 AWS 상태를 덧붙인다(로그인·계정 확인은 여전히 CLI 로 — 이 줄은 출발점일 뿐) */
export function withAwsNow(system: string, kits: readonly string[], line: string): string {
  return !kits.includes('aws') || line.trim() === '' ? system : `${system}\n\n<aws_now>\nrauha 가 이 호출 직전에 본 AWS 상태입니다. 계정별 사실을 말하기 전에는 여전히 aws CLI 로 확인하세요.\n${line.trim()}\n</aws_now>`;
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
  /** 읽기 도구가 연 경로(openedHook) */
  readonly opened: string[];
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
/**
 * 메인 채팅 Claude(direct)는 Claude Code 와 같은 시스템 프롬프트를 쓰고 rauha 글(결과 모양·사용자 규칙)은 뒤에 붙인다:
 * "Claude 에 UI 만 다시 입힌 것"이 되게(2026-11-24 사용자 결정). 다른 역할은 짧은 자체 프롬프트 그대로(캐시가 잘 먹게).
 */
export function systemPromptFor(role: MemberRole, text: string): string | { type: 'preset'; preset: 'claude_code'; append: string } {
  return role === 'direct' ? { type: 'preset', preset: 'claude_code', append: text } : text;
}

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
    const spare = db === null && call.continueFrom === undefined ? this.takeSpare(call) : null;
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
    const { controller, fetchLog, stderr, tally, opened: openedPaths } = opened;
    const stop = () => controller.abort();
    call.signal?.addEventListener('abort', stop, { once: true });
    this.running.add(controller);
    let result: SDKResultMessage | null = null;
    let partial: string | null = null;
    let spent: MemberUsage | null = null;
    let messages = opened.messages;
    const watch = call.onStep !== undefined ? CrewWatch.start() : null;
    const tell = (message: SDKMessage): void => {
      if (watch === null || call.onStep === undefined) return;
      try {
        for (const step of crewSteps(watch, message)) call.onStep(step);
      } catch {
        // 진행 줄은 보여 주기만 한다. 못 보여도 일은 그대로
      }
    };
    try {
      // 턴 한도에 닿았거나 결과 형식만 못 맞춘 호출은 멈추지 않고 같은 대화를 이어서 끝낸다(MemberContinue).
      for (let continued = 0; ; continued += 1) {
        result = null;
        try {
          for await (const message of messages) {
            tell(message);
            if (message.type === 'result') result = message;
            else if (message.type === 'assistant' && message.parent_tool_use_id === null) partial = lastText(message.message.content) ?? partial;
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
    if (result === null) return { output: null, error: '결과 메시지를 받지 못했습니다.', usage: addUsage(spent, emptyUsage(model, Date.now() - started)), fetched, partial, opened: [...openedPaths] };
    const usage = { ...addUsage(spent, toUsage(model, result)), tools: tally.entries() };
    logCall(call.role, call.continueFrom !== undefined, usage, result);
    if (result.subtype !== 'success') {
      const error = `${result.subtype}: ${result.errors.join(' / ')}`;
      return { output: null, error, usage, fetched, blocked: accountBlock(error), partial, opened: [...openedPaths] };
    }
    return { output: result.structured_output ?? null, error: result.structured_output === undefined ? '구조화 출력이 없습니다.' : null, usage, fetched, partial, opened: [...openedPaths], sessionId: result.session_id };
  }

  /** 다른 폴더도 읽거나 도구 묶음을 붙이는 호출은 띄울 때의 설정이 달라서 미리 띄운 프로세스를 쓰지 않는다. */
  private takeSpare(call: MemberCall): Spare | null {
    if ((call.additionalDirectories?.length ?? 0) > 0 || (call.kits?.length ?? 0) > 0 || (call.crew?.length ?? 0) > 0) return null;
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
    // 앞 호출을 이으면 그 세션을 다시 연다: 읽은 파일이 대화에 남아 있어 새로 할 말만 보낸다
    const options = this.sdkOptions(call, session, db);
    return { ...session, messages: query({ prompt: call.userMessage, options: call.continueFrom !== undefined ? { ...options, resume: call.continueFrom } : options }) };
  }

  /** 한 호출 동안은 처음 읽은 목록을 다시 쓴다(도구 호출마다 git을 부르지 않게). */
  private secretFilesOnce(): () => readonly string[] {
    let files: readonly string[] | null = null;
    return () => (files ??= this.options.secretFiles());
  }

  /** 사용자가 정한 "항상 지킬 것"을 시스템 프롬프트 끝에 붙인다(rauha 개발 규칙이 아니라 사용자 규칙이다). */
  private withAlwaysRules(system: string): string {
    return withUserNotes(system, this.options.alwaysRules?.() ?? '', this.options.styleNotes?.() ?? '', { claudeMd: this.options.claudeMd?.() ?? '', memory: this.options.memoryNotes?.() ?? '' });
  }

  /** 팀원(서브에이전트)용: 사용자 룰·취향·CLAUDE.md 만(rauha 기억은 빼서 팀원마다 다시 읽히지 않게) */
  private withCrewRules(system: string): string {
    return withUserNotes(system, this.options.alwaysRules?.() ?? '', this.options.styleNotes?.() ?? '', { claudeMd: this.options.claudeMd?.() ?? '' });
  }

  private sdkOptions(call: PreparedCall & Pick<MemberCall, 'additionalDirectories' | 'kits' | 'crew'>, session: Session, db: LinkedDatabase | null = null): Options {
    // rauha 작업 공간 도구: 팀원이 레포를 하나씩 뒤지지 않고 rauha 가 읽은 사실을 부른다. 역할마다 하는 일에 맞는 도구만 붙고,
    // 도구로 본 저장소는 "연 곳"으로 남긴다.
    const allowed = WorkspaceToolAccess.toolsFor(call.role);
    const facts = allowed.length > 0 ? this.options.workspace?.() : undefined;
    const kits = withWorkspace(withDatabase(withConnectors(kitServers(call.kits ?? [], this.options.env), (call.kits ?? []).includes('connectors') ? this.options.connectors?.() : undefined), db), facts, (paths) => session.opened.push(...paths), allowed);
    const base = this.options.prompts.system(call.role, call.kits ?? []);
    const system = withAwsNow(kits.guide === '' ? base : `${base}\n\n${kits.guide}`, call.kits ?? [], (call.kits ?? []).includes('aws') ? (this.options.awsNow?.() ?? '') : '');
    const { tools: pluginTools, ...pluginLoad } = pluginOptions(call.role, this.options.plugins?.() ?? [], call.setting.plugins !== false);
    // 메인 채팅 Claude 는 사용자가 꾸린 팀원을 서브에이전트로 부를 수 있다(일이 크면 넘긴다)
    // 팀원에게는 rauha 기억을 붙이지 않는다(팀원마다 매 턴 다시 읽혀 세션을 쓴다). 사용자 룰·취향·CLAUDE.md 는 코드를 쓰는 팀원도 따라야 해서 둔다.
    // rauha 작업 공간 읽기 도구도 넘긴다: 없으면 팀원이 git·md 를 하나씩 뒤졌다
    const agents = crewAgents(call.crew ?? [], (role) => this.options.prompts.system(role, []), (prompt) => this.withCrewRules(prompt), kits.tools);
    const crew = Object.keys(agents);
    const brief = crewBrief(crew);
    const withCrew = (text: string): string => (brief === '' ? text : `${text}\n\n${brief}`);
    const agentTool = crew.length > 0 ? ['Agent'] : [];
    return {
      ...LEAN_SESSION,
      ...pluginLoad,
      ...(crew.length > 0 ? { agents } : {}),
      model: modelOf(call),
      abortController: session.controller,
      cwd: this.options.cwd,
      ...(readDirs(call.additionalDirectories, this.options.readRoots).length > 0 ? { additionalDirectories: readDirs(call.additionalDirectories, this.options.readRoots) } : {}),
      env: this.options.env,
      ...(this.options.claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: this.options.claudeExecutable } : {}),
      systemPrompt: systemPromptFor(call.role, withCrew(withTeamInstruction(this.withAlwaysRules(db === null ? system : withDbGuide(system, this.options.prompts.dbGuide(call.role))), call.setting.extraInstruction))),
      tools: [...call.setting.tools, ...pluginTools, ...agentTool],
      allowedTools: [...call.setting.tools, ...pluginTools, ...kits.tools, ...agentTool],
      // 도구 묶음은 요청이 그쪽을 가리킬 때만 붙인다(도구 설명이 길어서).
      ...(kits.tools.length > 0 ? { mcpServers: kits.servers } : {}),
      permissionMode: 'dontAsk',
      settingSources: call.setting.readsProject ? ['project'] : [],
      effort: call.setting.effort,
      maxTurns: call.setting.maxTurns,
      ...budgetOf(call),
      outputFormat: { type: 'json_schema', schema: call.outputSchema },
      hooks: {
        PreToolUse: [...(crew.length > 0 ? [{ matcher: 'Agent', hooks: [foregroundAgentHook] }] : []), { hooks: [createToolGuard({ root: this.options.cwd, role: call.role, ...readCapOf(call.role), ...(crew.length > 0 ? { subagentReadCap: crewReadCap } : {}), canWrite: call.canWrite, ask: this.options.ask, remembered: this.remembered, secrets: this.options.secrets, secretFiles: this.secretFilesOnce(), extraRoots: call.additionalDirectories ?? [], publishIntent: () => session.intent.current, connectors: kits.connectorNames, connectorIntent: () => session.connectorIntent.current,...(this.options.rules !== undefined ? { rules: this.options.rules } : {}) })] }],
        PostToolUse: [{ hooks: [session.fetchLog.hook, toolCountHook(session.tally), openedHook(session.opened)] }],
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
/** 시스템 프롬프트 끝에 사용자 규칙("항상 지킬 것")과 사용자 말에서 배운 취향을 붙인다. 둘 다 없으면 그대로 */
export function withUserNotes(system: string, rules: string, style: string, more: { readonly claudeMd?: string; readonly memory?: string } = {}): string {
  const parts = [system];
  const claudeMd = more.claudeMd?.trim() ?? '';
  if (claudeMd !== '') parts.push(`<claude-md>\n사용자가 Claude Code 에 걸어 둔 지시(~/.claude/CLAUDE.md 와 그 @import)입니다. Claude Code 에서처럼 그대로 따르세요.\n${claudeMd}\n</claude-md>`);
  if (rules !== '') parts.push(`<user-rules>\n사용자가 항상 지키라고 정한 규칙입니다.\n${rules}\n</user-rules>`);
  if (style !== '') parts.push(`<user-style>\n사용자가 답변과 작업 방식에 대해 직접 말한 취향입니다. 결과와 보고를 이 취향에 맞추세요. 규칙·권한·사실 확인보다 앞서지는 않습니다.\n${style}\n</user-style>`);
  const memory = more.memory?.trim() ?? '';
  if (memory !== '') parts.push(`<rauha-memory>\n사용자가 rauha 에 저장해 둔 기억입니다(rauha 데이터 폴더). 다시 읽지 않아도 됩니다. 지금 상태와 다를 수 있으니 바뀌었을 만한 사실은 확인하세요.\n${memory}\n</rauha-memory>`);
  return parts.join('\n\n');
}

export function pluginOptions(role: MemberRole, loads: readonly PluginLoad[], wanted = true): Pick<Options, 'plugins' | 'skills'> & { readonly tools: readonly string[] } {
  if (!wanted || loads.length === 0 || !PluginReach.loads(role)) return { tools: [] };
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

/**
 * 이 호출이 쓸 수 있는 상한(SDK maxBudgetUsd). 설정에는 있었지만 SDK 에 넘기지 않아서 길어지는 일을 막는 게 없었다.
 * 닿으면 SDK 가 error_max_budget_usd 로 끝내고, 이어 달리기(MemberContinue)는 턴 한도에서만 하므로 거기서 멈춘다.
 */
export function budgetOf(call: { readonly setting: { readonly maxBudgetUsd: number } }): { maxBudgetUsd?: number } {
  const usd = call.setting.maxBudgetUsd;
  return Number.isFinite(usd) && usd > 0 ? { maxBudgetUsd: usd } : {};
}

/** 부르는 쪽이 정한 모델이 있으면 그것, 없으면 등급의 기본 모델 */
export function modelOf(call: Pick<PreparedCall, 'setting' | 'model'>): string {
  return call.model ?? MODEL_ID[call.setting.tier];
}

const CANCELLED: AccountBlock = { reason: 'cancelled', message: '사용자가 작업을 멈췄습니다.' };

function newSession(): Session {
  return { controller: new AbortController(), fetchLog: createFetchLog(), tally: ToolTally.empty(), opened: [], stderr: [], intent: { current: GitPublishIntent.none() }, connectorIntent: { current: ConnectorWriteIntent.none() } };
}

/** 미리 띄운 프로세스는 띄울 때의 설정이 고정되므로, 역할·설정·출력 형식이 모두 같을 때만 쓴다. */
function spareKey(call: PreparedCall): string {
  return JSON.stringify([call.role, call.setting, call.outputSchema, modelOf(call)]);
}

/**
 * 팀원(서브에이전트)은 기본이 백그라운드라, 지배인이 결과를 기다리지 않고 "맡겼고 아직 진행 중"이라고 답을 끝냈다(2026-11-24 실측).
 * 넘긴 일은 끝날 때까지 기다리게 한다. 한 번에 여러 명에게 넘기면 그대로 동시에 돈다.
 */
export const foregroundAgentHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Agent') return {};
  const toolInput = typeof input.tool_input === 'object' && input.tool_input !== null ? (input.tool_input as Record<string, unknown>) : {};
  // subagent_type 을 빼면 이름 없는 도우미(general-purpose)가 받아 화면에 팀원이 안 나온다(2026-11-25 실측).
  const target = typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type.trim() : '';
  if (target === '') {
    const names = DirectCrew.mates.map((m) => m.role).join(', ');
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Set subagent_type to the team member who should do this (${names}) and call Agent again.` } };
  }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, run_in_background: false } } };
};

/** 도구를 쓸 때마다 이름만 센다(입력·경로는 보지 않는다). */
export function toolCountHook(tally: ToolTally): HookCallback {
  return async (input) => {
    if (input.hook_event_name === 'PostToolUse') tally.record(input.tool_name);
    return {};
  };
}

const OPENED_MAX = 500;
const GIT_C = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;

/**
 * 읽기 도구가 실제로 연 경로만 남긴다(Read 파일, Grep·Glob 폴더, git -C 저장소). 검색어·명령 내용은 담지 않는다.
 * 팀원이 "읽겠다"고 한 곳을 정말 열었는지 RequestCoverage 가 맞춰 본다. 기록 파일에는 쓰지 않는다.
 */
export function openedHook(opened: string[], max = OPENED_MAX): HookCallback {
  const keep = (path: unknown): void => {
    if (typeof path !== 'string' || path.trim() === '') return;
    opened.push(path.trim());
    while (opened.length > max) opened.shift();
  };
  return async (input) => {
    if (input.hook_event_name !== 'PostToolUse') return {};
    const toolInput = (typeof input.tool_input === 'object' && input.tool_input !== null ? input.tool_input : {}) as Record<string, unknown>;
    if (input.tool_name === 'Read') keep(toolInput['file_path']);
    else if (input.tool_name === 'Grep' || input.tool_name === 'Glob') keep(toolInput['path']);
    else if (input.tool_name === 'Bash' && typeof toolInput['command'] === 'string') for (const m of toolInput['command'].matchAll(GIT_C)) keep(m[1] ?? m[2] ?? m[3]);
    return {};
  };
}

/**
 * SDK 메시지 하나에서 진행 줄을 뽑는다: assistant 의 tool_use(서브에이전트 안이면 parent_tool_use_id 가 있다),
 * user 의 tool_result(팀원에게 넘긴 일이 끝났는지).
 */
export function crewSteps(watch: CrewWatch, message: SDKMessage): CrewStep[] {
  const blocks = (content: unknown): Record<string, unknown>[] => (Array.isArray(content) ? content.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null) : []);
  const steps: CrewStep[] = [];
  if (message.type === 'assistant') {
    for (const b of blocks(message.message.content)) {
      if (b['type'] !== 'tool_use' || typeof b['id'] !== 'string' || typeof b['name'] !== 'string') continue;
      const input = typeof b['input'] === 'object' && b['input'] !== null ? (b['input'] as Record<string, unknown>) : {};
      const step = watch.toolUse({ id: b['id'], name: b['name'], input }, message.parent_tool_use_id);
      if (step !== null) steps.push(step);
    }
  } else if (message.type === 'user') {
    for (const b of blocks(message.message.content)) {
      if (b['type'] !== 'tool_result' || typeof b['tool_use_id'] !== 'string') continue;
      const step = watch.toolResult(b['tool_use_id']);
      if (step !== null) steps.push(step);
    }
  }
  return steps;
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

/**
 * 읽기만 하는 역할이 범위 없이 파일 전체를 읽을 때의 줄 한도. 읽은 줄은 그 뒤 턴마다 다시 읽혀 세션을 쓴다
 * (2026-11-22 실측: 깊은 답 한 번에 캐시 쓰기 12만, 조사 팀원 메모 몇 줄에 8만). 코드를 고치는 역할은 파일 전체가 필요해 두지 않는다.
 */
// intake: 실측에서 SPEC(14K자)을 통째로 읽었다. 접수는 범위·수용 기준만 정하면 되므로 목차·맞는 절만 보면 된다
const READ_CAPS: Partial<Record<string, number>> = { answerer: 400, surveyor: 200, intake: 150 };
const readCapOf = (role: string): { readCap?: number } => (READ_CAPS[role] === undefined ? {} : { readCap: READ_CAPS[role] });
/** 지배인의 팀원(서브에이전트) 읽기 한도: 읽기만 하는 팀원과 문서 팀원. 코드를 고치는 팀원(구현·테스트·원인 분석)은 파일 전체가 필요해 두지 않는다 */
const CREW_READ_CAPS: Partial<Record<string, number>> = { surveyor: 200, writer: 200, reviewer: 300, designer: 300, securitychecker: 300 };
export const crewReadCap = (role: string): number | undefined => CREW_READ_CAPS[role];

/**
 * RAUHA_CALL_LOG 에 파일 경로가 있으면 호출 하나마다 역할·모델·토큰(모델별 캐시 생성·읽기 포함)·턴·도구를 한 줄(JSON)로 남긴다.
 * 세션 사용을 호출 단위로 재는 측정 도구(session-bench)용. 내용·경로·프롬프트는 남기지 않는다.
 */
function logCall(role: string, resumed: boolean, usage: MemberUsage, result: SDKResultMessage): void {
  const path = process.env['RAUHA_CALL_LOG'];
  if (path === undefined || path === '') return;
  const models = Object.fromEntries(
    Object.entries(result.modelUsage ?? {}).map(([name, m]) => [name, { in: m.inputTokens, cacheWrite: m.cacheCreationInputTokens, cacheRead: m.cacheReadInputTokens, out: m.outputTokens, cost: m.costUSD }]),
  );
  const line = { at: new Date().toISOString(), role, resumed, model: usage.model, turns: usage.turns, ms: usage.durationMs, cost: usage.costUsd, models, tools: usage.tools ?? [], end: usage.endReason };
  try {
    appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf8');
  } catch {
    // 측정용 기록이라 실패해도 일은 그대로 간다
  }
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
