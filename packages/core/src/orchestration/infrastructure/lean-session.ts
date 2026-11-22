import type { Options } from '@anthropic-ai/claude-agent-sdk';

/**
 * rauha 가 띄우는 모든 모델 세션에 붙이는 설정: rauha 가 직접 넘긴 MCP 서버만 쓰고, 사용자 claude.ai 계정의 커넥터
 * (Figma·Notion·Docs 등)는 붙이지 않는다.
 * 2026-11-22 세션 기록 실측: 커넥터 도구 목록(deferred_tools_delta 126KB)과 사용법(mcp_instructions_delta 13KB)이 첫 턴 뒤에
 * 끼어들어 호출마다 3~4만 토큰을 새로 캐시에 쓰고 앞 캐시까지 깼다 — 아무 도구도 안 쓴 답 하나에 캐시 쓰기 6만.
 * rauha 의 커넥터는 커넥터 화면에서 연결해 mcpServers 로 직접 넘기므로 영향이 없다.
 */
export const LEAN_SESSION = {
  strictMcpConfig: true,
  settings: { disableClaudeAiConnectors: true },
} as const satisfies Pick<Options, 'strictMcpConfig' | 'settings'>;
