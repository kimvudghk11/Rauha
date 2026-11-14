import { DomainError } from '../../../shared/domain-error.js';

/** 스테이지한 변경을 보고 모델이 쓴 커밋 메시지 초안. 사용자가 고치고 직접 커밋한다. */
export interface CommitDraft {
  readonly subject: string;
  readonly body: string;
}

export const COMMIT_DIFF_LIMIT = 24_000;
const SUBJECT_MAX = 72;
const BODY_MAX = 2000;

export const COMMIT_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'One-line commit subject, 72 characters or fewer, no trailing period' },
    body: { type: 'string', description: 'Optional body: why the change was made, wrapped plain text. Empty if the subject says enough.' },
  },
  required: ['subject', 'body'],
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class CommitDraftDto {
  private constructor() {}

  static from(output: unknown): CommitDraft {
    if (!isObject(output)) throw new DomainError('COMMIT_DRAFT_FAILED', 'Could not write a commit message.');
    const firstLine = (typeof output['subject'] === 'string' ? output['subject'] : '').trim().split('\n')[0] ?? '';
    const subject = [...firstLine.trim().replace(/\.+$/, '')].slice(0, SUBJECT_MAX).join('').trim();
    if (subject === '') throw new DomainError('COMMIT_DRAFT_FAILED', 'Could not write a commit message.');
    const body = (typeof output['body'] === 'string' ? output['body'] : '').trim().slice(0, BODY_MAX);
    return { subject, body };
  }
}

/** 모델에 보낼 글: 이 레포의 커밋 방식 안내 + 스테이지한 diff(상한까지) */
export function commitDraftPrompt(stagedDiff: string, style: string): string {
  const diff = stagedDiff.length > COMMIT_DIFF_LIMIT ? `${stagedDiff.slice(0, COMMIT_DIFF_LIMIT)}\n(diff cut here)` : stagedDiff;
  return `Commit style of this repo: ${style || 'not known; use a short imperative English subject.'}\n\nStaged diff:\n${diff}`;
}
