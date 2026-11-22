import { describe, expect, it } from 'vitest';
import { LEAN_SESSION } from './lean-session.js';

describe('LEAN_SESSION', () => {
  it('rauha 가 넘긴 MCP 서버만 쓰고 사용자 claude.ai 커넥터는 붙이지 않는다(커넥터 목록이 호출마다 3~4만 토큰을 새로 쓰고 캐시를 깼다)', () => {
    expect(LEAN_SESSION.strictMcpConfig).toBe(true);
    expect(LEAN_SESSION.settings.disableClaudeAiConnectors).toBe(true);
  });
});
