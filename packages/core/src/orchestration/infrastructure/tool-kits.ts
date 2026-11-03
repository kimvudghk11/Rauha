import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ToolKit } from '../domain/tool-kit.js';
import { BROWSER_SERVER, BROWSER_TOOLS, localBrowserServer } from './browser-mcp.js';

/**
 * AWS가 운영하는 공개 지식 서버(AWS Knowledge MCP). AWS 계정·자격 증명 없이 쓰고, 설치할 것도 없다.
 * 최신 공식 문서 검색·읽기, 리전별 서비스·API·CloudFormation 자원 제공 여부, AWS가 정리한 작업 절차(스킬)를 준다.
 */
export const AWS_KNOWLEDGE_URL = 'https://knowledge-mcp.global.api.aws';
export const AWS_SERVER = 'aws';
export const AWS_TOOL_PREFIX = `mcp__${AWS_SERVER}__`;
const AWS_TOOLS = ['search_documentation', 'read_documentation', 'get_regional_availability', 'list_regions', 'retrieve_skill'].map((name) => `${AWS_TOOL_PREFIX}aws___${name}`);

export interface KitServers {
  readonly servers: Record<string, McpServerConfig>;
  /** allowedTools에 더할 도구 이름 */
  readonly tools: readonly string[];
}

/** 고른 도구 묶음 → SDK에 붙일 MCP 서버와 허락할 도구 */
export function kitServers(kits: readonly ToolKit[], env: Record<string, string | undefined>): KitServers {
  const servers: Record<string, McpServerConfig> = {};
  const tools: string[] = [];
  for (const kit of kits) {
    if (kit === 'browser') {
      servers[BROWSER_SERVER] = localBrowserServer(env);
      tools.push(...BROWSER_TOOLS);
    }
    if (kit === 'aws') {
      servers[AWS_SERVER] = { type: 'http', url: AWS_KNOWLEDGE_URL };
      tools.push(...AWS_TOOLS);
    }
  }
  return { servers, tools };
}
