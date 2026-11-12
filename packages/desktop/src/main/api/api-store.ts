import { ApiCollections } from '../../shared/api-collections.js';
import { CollectionsDto, EnvironmentsDto, HistoryDto } from '../../shared/api-dto.js';
import { ApiEnvironments } from '../../shared/api-env.js';
import { ApiProjects, ApiProjectsDto } from '../../shared/api-project.js';
import { ApiHistory } from '../../shared/api-response.js';
import { JsonFile } from '../data/json-file.js';

/** 읽고 쓰는 곳(시험에서는 메모리로 바꾼다) */
export interface ApiStorePort<T> {
  load(): Promise<T>;
  save(value: T): Promise<void>;
}

const stamp = (): string => new Date().toISOString();

/** 컬렉션: 앱 데이터 폴더의 api-collections.json. 깨진 파일은 옆에 복사해 두고 읽을 수 있는 만큼 연다. */
export class CollectionsStore implements ApiStorePort<ApiCollections> {
  private readonly json: JsonFile;
  constructor(file: string) {
    this.json = new JsonFile(file);
  }
  async load(): Promise<ApiCollections> {
    const read = await this.json.read();
    if (read.kind === 'missing') return ApiCollections.empty();
    if (read.kind === 'broken') {
      await this.json.keepCopy(stamp());
      return ApiCollections.empty();
    }
    const dto = CollectionsDto.from(read.value);
    if (dto.skipped > 0) await this.json.keepCopy(stamp());
    return dto.toEntity();
  }
  save(c: ApiCollections): Promise<void> {
    return this.json.write(CollectionsDto.fromEntity(c).toJSON());
  }
}

/** 환경: 비밀 값이 들어 있는 유일한 파일(api-environments.json). 맥·리눅스에서는 소유자만 읽고 쓰게(0600) 만든다. */
export class EnvironmentsStore implements ApiStorePort<ApiEnvironments> {
  private readonly json: JsonFile;
  constructor(file: string) {
    this.json = new JsonFile(file, 0o600);
  }
  async load(): Promise<ApiEnvironments> {
    const read = await this.json.read();
    if (read.kind === 'missing') return ApiEnvironments.empty();
    if (read.kind === 'broken') {
      await this.json.keepCopy(stamp());
      return ApiEnvironments.empty();
    }
    return EnvironmentsDto.from(read.value).toEntity();
  }
  save(e: ApiEnvironments): Promise<void> {
    return this.json.write(EnvironmentsDto.fromEntity(e).toJSON());
  }
}

/** 고른 프로젝트와 프로젝트별 마지막 동기화 기록: api-projects.json */
export class ApiProjectsStore implements ApiStorePort<ApiProjects> {
  private readonly json: JsonFile;
  constructor(file: string) {
    this.json = new JsonFile(file);
  }
  async load(): Promise<ApiProjects> {
    const read = await this.json.read();
    if (read.kind !== 'ok') return ApiProjects.empty();
    return ApiProjectsDto.from(read.value).toEntity();
  }
  save(p: ApiProjects): Promise<void> {
    return this.json.write(ApiProjectsDto.fromEntity(p).toJSON());
  }
}

/** 기록: api-history.json. 이미 가려진(비밀이 빠진) 모양만 들어온다. */
export class HistoryStore implements ApiStorePort<ApiHistory> {
  private readonly json: JsonFile;
  constructor(file: string) {
    this.json = new JsonFile(file);
  }
  async load(): Promise<ApiHistory> {
    const read = await this.json.read();
    if (read.kind !== 'ok') return ApiHistory.empty();
    return HistoryDto.from(read.value).toEntity();
  }
  save(h: ApiHistory): Promise<void> {
    return this.json.write(HistoryDto.fromEntity(h).toJSON());
  }
}
