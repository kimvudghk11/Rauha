import type { AiProviderId } from './external-ai.js';

/** 바깥 AI(Kiro · Codex) 채널 */
export const EXTERNAL_AI_IPC = {
  status: 'external-ai:status',
  ask: 'external-ai:ask',
  login: 'external-ai:login',
  logout: 'external-ai:logout',
} as const;

export interface AiStatusView {
  readonly id: AiProviderId;
  readonly installed: boolean;
  readonly signedIn: boolean;
  /** 이메일·로그인 방식 등(모르면 빈 글) */
  readonly who: string;
}

export type AiResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export interface ExternalAiApi {
  status(): Promise<readonly AiStatusView[]>;
  /** 한 번 묻기(파일을 고치지 못하게). 작업 폴더에서 실행한다 */
  ask(id: AiProviderId, prompt: string): Promise<AiResult<{ readonly text: string; readonly seconds: number }>>;
  /** 새 터미널 창에서 그 CLI 의 로그인을 연다(브라우저 로그인은 CLI 가 띄운다) */
  login(id: AiProviderId): Promise<AiResult<null>>;
  logout(id: AiProviderId): Promise<AiResult<null>>;
}
