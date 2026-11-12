import { query, type McpServerConfig, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SdkServerStatus } from '../../shared/connector-api.js';
import type { ConnectorProbe } from './connector-service.js';

export interface SdkProbeOptions {
  /** process.env + 지금 계정의 CLAUDE_CONFIG_DIR. 로그인 토큰은 Claude Code 가 이 폴더에 저장한다. */
  readonly env: Record<string, string>;
  readonly executable?: string | undefined;
}

/** SDK 의 Query 에 있지만 타입 선언에는 아직 없는 MCP 로그인 제어(0.3.296 의 sdk.mjs 에 있음). 없으면 로그인을 시작할 수 없다고 알린다. */
interface McpAuthControls {
  mcpAuthenticate?: (serverName: string, redirectUri?: string) => Promise<unknown>;
  mcpClearAuth?: (serverName: string) => Promise<unknown>;
}

/**
 * 메시지를 보내지 않는 Claude Code 세션 하나를 띄워 MCP 서버 상태를 묻고 로그인을 시킨다(모델 호출 없음).
 * OAuth 는 Claude Code 가 한다: 로그인 주소를 주고, localhost 로 돌아오는 응답을 받아, 토큰을 계정 설정 폴더에 저장한다.
 * rauha 는 그 주소를 시스템 브라우저로 열기만 하고 토큰은 보지 않는다.
 */
export async function openSdkProbe(servers: Record<string, McpServerConfig>, options: SdkProbeOptions): Promise<ConnectorProbe> {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => (release = resolve));
  async function* idle(): AsyncGenerator<SDKUserMessage, void, unknown> {
    await hold;
  }
  const controller = new AbortController();
  const session = query({
    prompt: idle(),
    options: {
      abortController: controller,
      // claude.ai 에서 연결한 커넥터까지 불러오면 확인이 느려진다. 여기서는 rauha 가 붙인 서버만 본다.
      env: { ...options.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
      mcpServers: servers,
      tools: [],
      settingSources: [],
      permissionMode: 'dontAsk',
      ...(options.executable !== undefined ? { pathToClaudeCodeExecutable: options.executable } : {}),
      stderr: () => undefined,
    },
  });
  const controls = session as unknown as McpAuthControls;
  // 세션이 끝나며 던지는 오류는 상태 묻기 쪽에서 드러난다
  void (async () => {
    try {
      for await (const _ of session) void _;
    } catch {
      /* closed */
    }
  })();
  return {
    status: async (name) => {
      const list = await session.mcpServerStatus();
      return (list.find((s) => s.name === name)?.status ?? 'missing') as SdkServerStatus;
    },
    authenticate: async (name) => {
      if (typeof controls.mcpAuthenticate !== 'function') throw new Error('This Claude Code version cannot start a connector sign-in.');
      const reply = (await controls.mcpAuthenticate.call(session, name)) as { authUrl?: unknown } | undefined;
      return { authUrl: typeof reply?.authUrl === 'string' ? reply.authUrl : null };
    },
    clearAuth: async (name) => {
      if (typeof controls.mcpClearAuth === 'function') await controls.mcpClearAuth.call(session, name);
    },
    close: () => {
      release();
      controller.abort();
    },
  };
}
