import { describe, expect, it } from 'vitest';
import { ConnectorBook, ConnectorPreset } from '../../domain/connector.js';
import { ConnectorBookDto } from './connector-book.dto.js';

describe('ConnectorBookDto', () => {
  it('저장 형식에는 서버 이름·표시 이름·주소·프리셋만 남는다(토큰 평문 없음)', () => {
    const book = ConnectorBook.empty();
    book.addPreset(ConnectorPreset.of('notion'));
    book.addCustom('사내 위키', 'https://mcp.example.com/mcp');
    const file = ConnectorBookDto.fromEntity(book).toFile();
    expect(file).toEqual({
      version: 1,
      connectors: [
        { id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', preset: 'notion' },
        { id: 'custom1', label: '사내 위키', url: 'https://mcp.example.com/mcp', preset: null },
      ],
    });
    expect(JSON.stringify(file)).not.toMatch(/token|secret|password/i);
  });

  it('파일에 끼어든 토큰 같은 값은 읽지 않고 버린다', () => {
    const dto = ConnectorBookDto.from({ version: 1, connectors: [{ id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', preset: 'notion', accessToken: 'sk-xxx', headers: { Authorization: 'Bearer x' } }] });
    expect(JSON.stringify(dto.toFile())).not.toContain('sk-xxx');
    expect(JSON.stringify(dto.toFile())).not.toContain('Bearer');
    expect(dto.toEntity().serverNames()).toEqual(['notion']);
  });

  it('빈 파일·깨진 값은 빈 목록이고, 깨진 줄 하나는 그 줄만 버린다', () => {
    expect(ConnectorBookDto.from(undefined).toEntity().list()).toEqual([]);
    expect(ConnectorBookDto.from('garbage').toEntity().list()).toEqual([]);
    const dto = ConnectorBookDto.from({ version: 1, connectors: [{ id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp', preset: 'notion' }, { id: 'x y', url: 'ftp://nope' }, { id: 'custom1', label: 'W', url: 'http://plain.example.com' }] });
    expect(dto.toEntity().serverNames()).toEqual(['notion']);
  });
});
