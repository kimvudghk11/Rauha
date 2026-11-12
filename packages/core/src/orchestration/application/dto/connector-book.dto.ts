import { Connector, ConnectorBook, type ConnectorFields } from '../../domain/connector.js';

/** 저장 파일 형식(connectors.json). 서버 이름·표시 이름·주소·프리셋만 둔다. 토큰은 Claude Code가 계정 설정 폴더에 따로 둔다. */
export interface ConnectorBookFile {
  readonly version: 1;
  readonly connectors: readonly ConnectorFields[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 저장 파일 ↔ ConnectorBook. 아는 칸만 골라 읽으므로 파일에 끼어든 토큰 같은 값은 다시 저장되지 않는다. */
export class ConnectorBookDto {
  private constructor(private readonly items: readonly Connector[]) {}

  /** 깨진 파일은 빈 목록, 깨진 줄은 그 줄만 버린다(설정 화면이 열려야 하므로). */
  static from(input: unknown): ConnectorBookDto {
    const list = typeof input === 'object' && input !== null && Array.isArray((input as { connectors?: unknown }).connectors) ? ((input as { connectors: unknown[] }).connectors) : [];
    const items: Connector[] = [];
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const id = str(r['id']);
      const url = str(r['url']);
      if (id === null || url === null) continue;
      try {
        const item = Connector.restore({ id, label: str(r['label']) ?? id, url, preset: str(r['preset']) });
        if (items.some((c) => c.serverName === item.serverName || c.url === item.url)) continue;
        items.push(item);
      } catch {
        // 규칙에 안 맞는 줄은 버린다
      }
    }
    return new ConnectorBookDto(items);
  }

  static fromEntity(book: ConnectorBook): ConnectorBookDto {
    return new ConnectorBookDto(book.list());
  }

  toEntity(): ConnectorBook {
    return ConnectorBook.of(this.items);
  }

  toFile(): ConnectorBookFile {
    return { version: 1, connectors: this.items.map((c) => c.toFields()) };
  }
}
