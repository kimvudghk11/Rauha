import { describe, expect, it } from 'vitest';
import { AWS_KNOWLEDGE_URL, kitServers } from './tool-kits.js';

describe('kitServers', () => {
  it('묶음이 없으면 서버도 도구도 붙이지 않는다', () => {
    expect(kitServers([], {})).toEqual({ servers: {}, tools: [] });
  });

  it('AWS 묶음은 계정 없이 쓰는 AWS 공개 지식 서버를 붙이고 그 도구를 모두 허락한다', () => {
    const kits = kitServers(['aws'], {});
    expect(kits.servers).toEqual({ aws: { type: 'http', url: AWS_KNOWLEDGE_URL } });
    expect(kits.tools).toEqual([
      'mcp__aws__aws___search_documentation',
      'mcp__aws__aws___read_documentation',
      'mcp__aws__aws___get_regional_availability',
      'mcp__aws__aws___list_regions',
      'mcp__aws__aws___retrieve_skill',
    ]);
  });

  it('브라우저와 AWS를 함께 붙일 수 있다', () => {
    const kits = kitServers(['browser', 'aws'], {});
    expect(Object.keys(kits.servers)).toEqual(['browser', 'aws']);
    expect(kits.tools).toContain('mcp__browser__browser_snapshot');
    expect(kits.tools).toContain('mcp__aws__aws___search_documentation');
  });
});
