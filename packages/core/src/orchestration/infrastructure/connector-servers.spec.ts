import { describe, expect, it } from 'vitest';
import { ConnectorBook, ConnectorPreset } from '../domain/connector.js';
import { connectorServers } from './connector-servers.js';

describe('connectorServers', () => {
  it('연결 목록 → 원격 http MCP 서버와 서버 단위 도구 허락(mcp__<서버>)', () => {
    const book = ConnectorBook.empty();
    book.addPreset(ConnectorPreset.of('notion'));
    book.addPreset(ConnectorPreset.of('atlassian'));
    const kit = connectorServers(book);
    expect(kit.servers).toEqual({
      notion: { type: 'http', url: 'https://mcp.notion.com/mcp' },
      atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' },
    });
    expect(kit.tools).toEqual(['mcp__notion', 'mcp__atlassian']);
    expect(kit.names).toEqual(['notion', 'atlassian']);
  });

  it('서버 설정에 비밀(헤더·토큰)을 넣지 않는다. 인증은 Claude Code가 자기 설정 폴더에서 한다', () => {
    const book = ConnectorBook.empty();
    book.addPreset(ConnectorPreset.of('notion'));
    expect(JSON.stringify(connectorServers(book).servers)).not.toMatch(/header|token|authorization/i);
  });

  it('연결이 없으면 아무것도 붙이지 않는다', () => {
    expect(connectorServers(ConnectorBook.empty())).toEqual({ servers: {}, tools: [], names: [] });
  });
});
