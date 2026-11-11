import type { CollectionsJson, EnvironmentsView, HistoryJson } from './api-dto.js';
import type { ResponseSummaryProps } from './api-response.js';

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
} as const;

export type SendFail = 'invalid' | 'missing' | 'blocked' | 'busy' | 'timeout' | 'cancelled' | 'network';

export type SendResult =
  | {
      readonly ok: true;
      readonly response: ResponseSummaryProps;
      /** 복사용으로 가린 응답(본문이 작을 때만). 없으면 화면이 헤더·토큰 모양만 가려서 복사한다 */
      readonly masked: ResponseSummaryProps | null;
      readonly historyId: string;
    }
  | { readonly ok: false; readonly kind: SendFail; readonly error: string; readonly missing: readonly string[]; readonly historyId: string | null };

/** 컬렉션·환경 바꾸기 결과. 비밀은 변수 이름으로 바뀌어 있고, 옮겨 담은 값이 있으면 새 환경 목록(값 없이)이 같이 온다. */
export type ApiOpResult<T> = ({ readonly ok: true; readonly envs: EnvironmentsView | null } & T) | { readonly ok: false; readonly error: string };

export type CollectionResult = ApiOpResult<{ readonly collections: CollectionsJson; /** 새로 생긴 항목(복제·가져오기·새 요청) */ readonly focusId: string | null }>;
export type EnvResult = { readonly ok: true; readonly envs: EnvironmentsView } | { readonly ok: false; readonly error: string };
export type ExportResult = { readonly ok: true; readonly text: string; readonly fileName: string; readonly saved: string | null } | { readonly ok: false; readonly error: string };

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
}
