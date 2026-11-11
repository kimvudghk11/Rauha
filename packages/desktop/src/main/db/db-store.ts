import { ConnectionsDto, DbConnections } from '../../shared/db-connections.js';
import { JsonFile } from '../data/json-file.js';

/** 읽고 쓰는 곳(시험에서는 메모리로 바꾼다) */
export interface ConnectionsPort {
  load(): Promise<DbConnections>;
  save(value: DbConnections): Promise<void>;
}

/** 저장한 DB 파일 목록: 앱 데이터 폴더의 db-connections.json. 파일 경로만 들어 있고 비밀은 없다. 깨진 파일은 옆에 복사해 두고 빈 목록으로 연다. */
export class ConnectionsStore implements ConnectionsPort {
  private readonly json: JsonFile;
  constructor(file: string) {
    this.json = new JsonFile(file);
  }
  async load(): Promise<DbConnections> {
    const read = await this.json.read();
    if (read.kind === 'missing') return DbConnections.empty();
    if (read.kind === 'broken') {
      await this.json.keepCopy(new Date().toISOString());
      return DbConnections.empty();
    }
    const dto = ConnectionsDto.from(read.value);
    if (dto.skipped > 0) await this.json.keepCopy(new Date().toISOString());
    return dto.toEntity();
  }
  save(c: DbConnections): Promise<void> {
    return this.json.write(ConnectionsDto.fromEntity(c).toJSON());
  }
}

/** 시험용 메모리 저장소 */
export class MemoryConnectionsStore implements ConnectionsPort {
  private value = DbConnections.empty();
  async load(): Promise<DbConnections> {
    return this.value;
  }
  async save(value: DbConnections): Promise<void> {
    this.value = value;
  }
}
