import type { DigestRepo } from '../domain/repo-digest.js';
import type { StandupRepo } from '../domain/standup.js';
import type { WorkspaceRepo } from '../../workspace/domain/workspace.js';
import type { CiJobLog, CiRun, CommitLine, Manifest, RepoState, SearchHit, SheetData } from '../domain/workspace-text.js';

export type { WorkspaceRepo };

/**
 * rauha 가 팀원 대신 모델 호출 없이 읽어 주는 작업 공간 사실. 팀원은 rauha 작업 공간 도구(MCP)로 필요할 때 부른다.
 * 모두 읽기만 한다. 선택 항목이 없으면 그 도구는 붙지 않는다.
 */
export interface WorkspaceFacts {
  /** 작업 공간의 저장소(하나면 이 저장소) */
  readonly repos: () => readonly WorkspaceRepo[];
  /** 모든 저장소의 브랜치·태그·최근 커밋(모든 사람)·CHANGELOG 앞부분 */
  readonly repoChanges: () => Promise<readonly DigestRepo[]>;
  /** since(YYYY-MM-DD)부터의 내 커밋·브랜치·커밋 안 한 변경 */
  readonly myCommits: (since: string) => Promise<readonly StandupRepo[]>;
  /** 할 일 탭의 끝나지 않은 할 일. 할 일 탭이 없는 화면이면 없다. */
  readonly openTodos?: (() => Promise<readonly string[]>) | undefined;
  /** 오늘(YYYY-MM-DD, 이 컴퓨터 시각) */
  readonly today: () => string;
  /** 저장소마다 push·pull 안 한 커밋, 커밋 안 한 파일, stash, 최근 브랜치 */
  readonly repoStatus?: ((repos: readonly WorkspaceRepo[]) => Promise<readonly RepoState[]>) | undefined;
  /** 여러 저장소에서 git 이 추적하는 파일의 글 찾기(비밀 파일 제외). fixed: 정규식이 아니라 글 그대로 */
  readonly search?: ((repos: readonly WorkspaceRepo[], pattern: string, options: { readonly fixed: boolean; readonly glob: string | null; readonly limit: number }) => Promise<readonly SearchHit[]>) | undefined;
  /** 파일 하나를 바꾼 커밋(이름 바뀜 따라감, 새것부터) */
  readonly fileHistory?: ((repo: WorkspaceRepo, path: string) => Promise<readonly CommitLine[]>) | undefined;
  /** 커밋 하나의 메시지·바뀐 파일·diff(비밀 파일 diff 제외). 없는 커밋이면 null */
  readonly showCommit?: ((repo: WorkspaceRepo, revision: string) => Promise<string | null>) | undefined;
  /** 저장소마다 최근 GitHub Actions 실행 */
  readonly ciRuns?: ((repos: readonly WorkspaceRepo[]) => Promise<{ readonly runs: readonly CiRun[]; readonly notGithub: readonly string[]; readonly signedIn: boolean }>) | undefined;
  /** 실행 하나의 실패한 작업과 로그 끝부분 */
  readonly ciLog?: ((repo: WorkspaceRepo, runId: number) => Promise<readonly CiJobLog[]>) | undefined;
  /** rauha 가 기억하는 지난 작업·답과 그때의 결정(이 저장소). 찾은 것이 없으면 빈 글 */
  readonly pastWork?: ((query: string) => Promise<string>) | undefined;
  /** 회사 부서(기획·디자인·마케팅·품질·운영)가 이미 정한 것(부서별 가장 최근 결과). 없으면 null */
  readonly companyNotes?: (() => Promise<string | null>) | undefined;
  /** 저장소마다 의존성 파일과 그 안의 의존성 */
  readonly dependencies?: ((repos: readonly WorkspaceRepo[]) => Promise<readonly Manifest[]>) | undefined;
  /** 저장소 안 CSV·TSV·XLSX 파일의 시트들(비밀 파일은 던진다) */
  readonly readSpreadsheet?: ((repo: WorkspaceRepo, path: string) => Promise<readonly SheetData[]>) | undefined;

  // ── rauha 앱 자체에 쓰기(작업 폴더 파일이 아니다). 메인 채팅 Claude 에게만 붙는다 ──
  /** 할 일 탭에 카드 하나(checklist 가 있으면 체크리스트). 결과 한 줄을 돌려준다. 규칙을 어기면 이유를 담아 던진다 */
  readonly addTodo?: ((card: { readonly title: string; readonly note: string; readonly checklist: readonly string[] }) => Promise<string>) | undefined;
  /** rauha 기억에 글을 남긴다(같은 제목이면 바꾼다). 다음 대화부터 모든 팀원에게 붙는다 */
  readonly remember?: ((note: { readonly title: string; readonly text: string; readonly source: string | null }) => Promise<string>) | undefined;
  /** 룰 파일(절대 경로)을 항상 따를 규칙으로 남긴다. 원본은 읽기만 하고 호출 때마다 지금 내용을 붙인다 */
  readonly keepRule?: ((path: string) => Promise<string>) | undefined;
}
