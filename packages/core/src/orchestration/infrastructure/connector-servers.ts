import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ConnectorBook } from '../domain/connector.js';

export interface ConnectorServers {
  readonly servers: Record<string, McpServerConfig>;
  /** allowedTools에 더할 이름. 서버 이름만 쓰면 그 서버의 도구 전부다(쓰기는 가드가 따로 묻는다). */
  readonly tools: readonly string[];
  /** 커넥터 서버 이름들(가드가 이 서버의 쓰기 도구를 묻는다) */
  readonly names: readonly string[];
}

/**
 * 연결 목록 → SDK mcpServers. 헤더·토큰은 넣지 않는다: Claude Code가 서버 이름+설정으로 자기 설정 폴더(CLAUDE_CONFIG_DIR)에
 * 저장한 OAuth 토큰을 찾아 쓴다. 그래서 로그인 때와 팀원 실행 때 이 함수 하나로 같은 설정을 만든다.
 */
export function connectorServers(book: ConnectorBook): ConnectorServers {
  const servers: Record<string, McpServerConfig> = {};
  for (const c of book.list()) servers[c.serverName] = { type: 'http', url: c.url };
  const names = book.serverNames();
  return { servers, tools: names.map((n) => `mcp__${n}`), names };
}
