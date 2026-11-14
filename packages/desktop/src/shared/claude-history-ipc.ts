import type { TranscriptEntry } from './claude-history.js';

/** Claude 대화 내역 채널(읽기만) */
export const CLAUDE_HISTORY_IPC = {
  list: 'claude-history:list',
  open: 'claude-history:open',
} as const;

export interface ClaudeSessionView {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly bytes: number;
  readonly source: string;
  /** 프로그램(rauha 팀원 등)이 시작한 대화: 기본으로 숨긴다 */
  readonly automated: boolean;
}

export type ClaudeHistoryResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export interface ClaudeHistoryApi {
  /** 이 컴퓨터의 Claude Code 대화들(모든 프로젝트, 최근 순) */
  list(): Promise<ClaudeHistoryResult<{ readonly sessions: readonly ClaudeSessionView[]; readonly roots: readonly string[] }>>;
  /** 목록의 id 로 대화 하나 열기 */
  open(id: string): Promise<ClaudeHistoryResult<{ readonly entries: readonly TranscriptEntry[]; readonly truncated: boolean }>>;
}
