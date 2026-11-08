import type { BugNoteJson } from './bug-note-dto.js';

/** 답답한 점 메모가 main과 이야기하는 좁은 채널. AWS 자격은 main 안에서만 쓰이고 화면으로 오가지 않는다. */
export const BUG_IPC = {
  get: 'bugs:get',
  apply: 'bugs:apply',
  preview: 'bugs:preview',
  upload: 'bugs:upload',
  download: 'bugs:download',
} as const;

export interface BugStateJson {
  readonly items: readonly BugNoteJson[];
  /** 올리기·받기를 못 하는 이유(프로필 이름을 안 적었다 등). 할 수 있으면 null */
  readonly syncBlocked: string | null;
}

export type BugResult = { readonly ok: true; readonly state: BugStateJson } | { readonly ok: false; readonly error: string };

export interface BugPreviewItem {
  readonly id: string;
  readonly title: string;
  readonly memo: string;
  readonly redactions: number;
}

/** 올리기 전 미리보기: 가린 뒤 실제로 올라갈 글. digest를 올리기에 그대로 돌려줘야 올라간다. */
export type BugPreviewResult = { readonly ok: true; readonly items: readonly BugPreviewItem[]; readonly digest: string } | { readonly ok: false; readonly error: string };

export type BugUploadResult =
  | { readonly ok: true; readonly uploaded: number; readonly failed: number; readonly firstError: string | null; readonly state: BugStateJson }
  | { readonly ok: false; readonly error: string };

export type BugDownloadResult =
  | { readonly ok: true; readonly added: number; readonly updated: number; readonly skipped: number; readonly state: BugStateJson }
  | { readonly ok: false; readonly error: string };

/** 화면용 API(window.rauha.bugs) */
export interface BugApi {
  get(): Promise<BugStateJson>;
  /** 적기·해결·해결 취소·지우기. 규칙을 어기면 이유를 돌려준다 */
  apply(op: unknown): Promise<BugResult>;
  /** 올릴 메모를 가린 결과를 만든다(아직 올리지 않는다) */
  preview(): Promise<BugPreviewResult>;
  /** 사용자가 미리보기를 확인한 뒤: 같은 지문일 때만 올린다 */
  upload(digest: string): Promise<BugUploadResult>;
  download(): Promise<BugDownloadResult>;
}
