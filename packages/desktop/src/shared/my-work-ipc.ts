import type { WorkCommit } from './my-work.js';

/** 이력서용 내 작업 채널 */
export const MY_WORK_IPC = {
  scan: 'my-work:scan',
  resume: 'my-work:resume',
  ghLogins: 'my-work:gh-logins',
  ghLogin: 'my-work:gh-login',
  ghScan: 'my-work:gh-scan',
} as const;

export type MyWorkResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export interface MyWorkApi {
  /** 작업 폴더 모든 레포의 커밋(since: 초 단위 UNIX 시각, 0 이면 처음부터) */
  scan(since: number): Promise<MyWorkResult<{ readonly commits: readonly WorkCommit[]; readonly repos: number }>>;
  /** 커밋 요약 메모(제목·숫자만)로 이력서 문장 초안(Sonnet 한 번) */
  resume(note: string): Promise<MyWorkResult<string>>;
  /** gh CLI 에 로그인한 GitHub 계정들(clone 없이 읽기용) */
  ghLogins(): Promise<{ readonly installed: boolean; readonly logins: readonly string[] }>;
  /** 새 터미널에서 GitHub 계정 하나 더 로그인 */
  ghLogin(): Promise<MyWorkResult<null>>;
  /** 계정에 묶은 GitHub 로그인들로 레포·커밋·스택을 읽는다(force 면 저장해 둔 것 무시) */
  ghScan(force: boolean): Promise<MyWorkResult<{ readonly at: string; readonly repos: number; readonly commits: number; readonly notes: readonly string[] }>>;
}
