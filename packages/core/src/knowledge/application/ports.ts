import type { RepoFacts, RepoKnowledge } from '../domain/repo-knowledge.js';
import type { RepoRef } from '../domain/repo-ref.js';

/** 저장소의 지금 상태를 읽는다(git). 경로는 작업 폴더 기준, 비밀 파일은 빠져 있다. */
export interface RepoReaderPort {
  current(): Promise<RepoRef | null>;
  files(): Promise<string[]>;
  facts(files: readonly string[]): Promise<RepoFacts>;
  /** 코드 파일은 내보낸 이름, 코드가 아니면 빈 목록, 없는 파일은 null */
  symbolsOf(paths: readonly string[]): Promise<Map<string, readonly string[] | null>>;
  changedSince(basis: RepoRef): Promise<{ readonly paths: string[] } | 'rebuild'>;
  /** 파일 내용 해시. 없는 파일은 null */
  hashes(paths: readonly string[]): Promise<Map<string, string | null>>;
}

export interface KnowledgeStorePort {
  load(): Promise<RepoKnowledge | null>;
  save(knowledge: RepoKnowledge): Promise<void>;
}

/** 팀원 메시지에 넣을 저장소 지식 묶음과 그 기준. git 저장소가 아니면 null. */
export interface KnowledgePort {
  current(): Promise<{ readonly block: string; readonly basis: RepoRef } | null>;
  /** 저장된 지식만 읽는다. 저장소를 훑지도 조사 팀원을 부르지도 않아 빠르다. 저장된 게 없으면 null. 가벼운 질문과 답한 뒤 조사에 쓴다. */
  stored?(): Promise<{ readonly block: string; readonly basis: RepoRef } | null>;
  /** 작업이 끝나 rauha가 바꾼 파일을 알린다. 모델을 부르지 않고 기준과 심볼만 고친다. */
  noteChanged(paths: readonly string[]): Promise<void>;
}
