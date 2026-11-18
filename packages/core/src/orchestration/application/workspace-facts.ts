import type { DigestRepo } from '../domain/repo-digest.js';
import type { StandupRepo } from '../domain/standup.js';

/**
 * rauha 가 팀원 대신 모델 호출 없이 읽어 주는 작업 공간 사실. 팀원은 rauha 작업 공간 도구(MCP)로 필요할 때 부른다.
 * 읽기만 한다.
 */
export interface WorkspaceFacts {
  /** 모든 저장소의 브랜치·태그·최근 커밋(모든 사람)·CHANGELOG 앞부분 */
  readonly repoChanges: () => Promise<readonly DigestRepo[]>;
  /** since(YYYY-MM-DD)부터의 내 커밋·브랜치·커밋 안 한 변경 */
  readonly myCommits: (since: string) => Promise<readonly StandupRepo[]>;
  /** 할 일 탭의 끝나지 않은 할 일. 할 일 탭이 없는 화면이면 없다. */
  readonly openTodos?: (() => Promise<readonly string[]>) | undefined;
  /** 오늘(YYYY-MM-DD, 이 컴퓨터 시각) */
  readonly today: () => string;
}
