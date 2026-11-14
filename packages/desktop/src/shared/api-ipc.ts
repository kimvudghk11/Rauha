import type { CapturedValue, CheckResult } from './api-after.js';
import type { SyncReport } from './api-collections.js';
import type { CookieView } from './api-cookies.js';
import type { CollectionsJson, EnvironmentsView, HistoryJson } from './api-dto.js';
import type { ApiSource } from './api-extract.js';
import type { ProjectRecord } from './api-project.js';
import type { ResponseSummaryProps } from './api-response.js';
import type { PlanTestsResult, RunTestsResult, SaveReportResult } from './api-test-dto.js';

/** API 탭이 main과 이야기하는 좁은 채널들. 인자는 모두 main이 DTO로 다시 검사한다. */
export const API_IPC = {
  send: 'api:send',
  cancel: 'api:cancel',
  collectionsGet: 'api:collections:get',
  collectionsApply: 'api:collections:apply',
  envGet: 'api:env:get',
  envApply: 'api:env:apply',
  historyGet: 'api:history:get',
  historyRemove: 'api:history:remove',
  historyClear: 'api:history:clear',
  import: 'api:import',
  export: 'api:export',
  projectsList: 'api:projects:list',
  projectsSync: 'api:projects:sync',
  testsPlan: 'api:tests:plan',
  testsRun: 'api:tests:run',
  testsSave: 'api:tests:save',
  cookiesGet: 'api:cookies:get',
  cookiesClear: 'api:cookies:clear',
  saveBody: 'api:save-body',
  pickFile: 'api:pick-file',
} as const;

export type SendFail = 'invalid' | 'missing' | 'blocked' | 'busy' | 'timeout' | 'cancelled' | 'network';

/** 응답 뒤 규칙의 결과(화면용: 비밀 변수 값은 •••• 로) */
export interface AfterView {
  readonly captured: readonly CapturedValue[];
  readonly checks: readonly CheckResult[];
  /** 저장하지 못한 이유 등(없으면 null) */
  readonly note: string | null;
}

export interface CookiesView {
  readonly count: number;
  readonly items: readonly CookieView[];
}

export type SaveBodyResult = { readonly ok: true; readonly saved: string | null } | { readonly ok: false; readonly error: string };

export type SendResult =
  | {
      readonly ok: true;
      readonly response: ResponseSummaryProps;
      /** 복사용으로 가린 응답(본문이 작을 때만). 없으면 화면이 헤더·토큰 모양만 가려서 복사한다 */
      readonly masked: ResponseSummaryProps | null;
      readonly historyId: string;
      /** 응답 뒤 규칙 결과(규칙이 없으면 null) */
      readonly after: AfterView | null;
      /** 응답에서 변수를 저장해 환경이 바뀌었으면 새 환경 목록(값 없이) */
      readonly envs: EnvironmentsView | null;
      /** 지금 쿠키 저장소의 쿠키 수 */
      readonly cookies: number;
    }
  | { readonly ok: false; readonly kind: SendFail; readonly error: string; readonly missing: readonly string[]; readonly historyId: string | null };

/** 컬렉션·환경 바꾸기 결과. 비밀은 변수 이름으로 바뀌어 있고, 옮겨 담은 값이 있으면 새 환경 목록(값 없이)이 같이 온다. */
export type ApiOpResult<T> = ({ readonly ok: true; readonly envs: EnvironmentsView | null } & T) | { readonly ok: false; readonly error: string };

export type CollectionResult = ApiOpResult<{ readonly collections: CollectionsJson; /** 새로 생긴 항목(복제·가져오기·새 요청) */ readonly focusId: string | null }>;
export type EnvResult = { readonly ok: true; readonly envs: EnvironmentsView } | { readonly ok: false; readonly error: string };
export type ExportResult = { readonly ok: true; readonly text: string; readonly fileName: string; readonly saved: string | null } | { readonly ok: false; readonly error: string };

/** API 탭의 프로젝트 고르기 목록 한 줄 */
export interface ProjectRow {
  readonly root: string;
  readonly name: string;
  readonly relative: string;
  /** 마지막으로 읽은 결과(아직 안 읽었으면 null) */
  readonly source: ProjectRecord['source'] | null;
  readonly endpoints: number;
}
export interface ProjectList {
  readonly selected: string | null;
  readonly items: readonly ProjectRow[];
}

/** synced: 읽어서 합침, unchanged: 지문이 같아 그대로, frontend: 프론트엔드 레포라 만들지 않음, empty: API를 못 찾음, busy: 이미 읽는 중 */
export type ProjectSyncStatus = 'synced' | 'unchanged' | 'frontend' | 'empty' | 'busy';
export type ProjectSyncResult = ApiOpResult<{
  readonly status: ProjectSyncStatus;
  readonly source: ApiSource | null;
  readonly report: SyncReport | null;
  readonly collections: CollectionsJson;
  /** 프로젝트 폴더 id */
  readonly focusId: string | null;
  /** 파일이 너무 많아 일부만 훑었다 */
  readonly truncated: boolean;
}>;

export interface ApiApi {
  /** 요청 하나를 보낸다. 같은 key가 이미 가는 중이면 다시 보내지 않고 busy로 답한다 */
  send(req: unknown): Promise<SendResult>;
  cancel(key: string): Promise<boolean>;
  collections: {
    get(): Promise<CollectionsJson>;
    apply(op: unknown): Promise<CollectionResult>;
  };
  env: {
    get(): Promise<EnvironmentsView>;
    apply(op: unknown): Promise<EnvResult>;
  };
  history: {
    get(): Promise<HistoryJson>;
    remove(id: string): Promise<HistoryJson>;
    clear(): Promise<HistoryJson>;
  };
  /** cURL 한 줄·.http 글·OpenAPI JSON을 컬렉션에 가져온다 */
  import(req: unknown): Promise<CollectionResult>;
  /** 요청을 cURL로, 요청이나 폴더를 .http로 내보낸다(save가 true면 저장 위치를 묻고 파일로 쓴다) */
  export(req: unknown, save?: boolean): Promise<ExportResult>;
  /** 작업 폴더의 프로젝트에서 API 컬렉션을 만든다(고른 프로젝트 하나만 읽는다) */
  projects: {
    list(): Promise<ProjectList>;
    /** { root, force? } */
    sync(req: unknown): Promise<ProjectSyncResult>;
  };
  /** AI API 시험: 케이스 만들기(모델 1번) → 미리보기 → 실행(이 컴퓨터로만) → 리포트 */
  tests: {
    /** { requestId, request } */
    plan(req: unknown): Promise<PlanTestsResult>;
    /** { planId, caseIds, confirmed } */
    run(req: unknown): Promise<RunTestsResult>;
    /** 마지막 리포트를 .md 로 저장(저장 위치를 묻는다) */
    save(planId: string): Promise<SaveReportResult>;
  };
  /** 쿠키 저장소(앱을 끄면 비워진다) */
  cookies: {
    get(): Promise<CookiesView>;
    /** domain 을 주면 그 도메인만 */
    clear(domain?: string): Promise<CookiesView>;
  };
  /** 마지막 응답 본문 전체를 파일로 저장(저장 위치를 묻는다) */
  saveBody(historyId: string): Promise<SaveBodyResult>;
  /** multipart 파일 필드에 넣을 파일 고르기(취소하면 null) */
  pickFile(): Promise<string | null>;
}
