import { query } from '@anthropic-ai/claude-agent-sdk';
import { DomainError } from '../../shared/domain-error.js';
import { MODEL_ID } from '../domain/team.js';

export type BlogTone = 'plain' | 'friendly';

export const BLOG_NOTE_LIMIT = 12_000;

const TONE: Readonly<Record<BlogTone, string>> = {
  plain: '담백한 어투: "~했다", "~이다" 같은 평서문으로 군더더기 없이 쓴다.',
  friendly: '친근한 어투: "~했어요", "~더라고요" 같은 부드러운 존댓말로 독자에게 말하듯 쓴다.',
};

const SYSTEM = `당신은 개발 블로그 글을 쓰는 문서 팀원 "잉크"입니다. 사용자가 준 "정리 노트"만 바탕으로 한국어 블로그 초안을 마크다운으로 씁니다.
규칙:
- 노트에 없는 사실(원인, 수치, 도구, 이름, 날짜)을 지어내지 않는다. 추측이면 "~로 보인다"처럼 추측이라고 쓴다.
- "직접 채우기"라고 표시된 칸은 내용을 만들지 말고 "(직접 채우기)" 자리표시자와 한 줄 안내만 남긴다.
- 노트의 "서비스 A", "레포 A", "도메인 A", "IP A", "[값 가림]" 같은 일반 이름은 그대로 쓴다. 원래 이름을 짐작해서 복원하지 않는다.
- 코드 블록은 노트에 있는 것만 그대로 옮긴다. 새 코드를 만들지 않는다.
- 파일을 만들거나 고치지 않고, 도구를 쓰지 않고, 글만 답한다. 달러 금액은 쓰지 않는다.
- 제목은 노트의 제목을 쓰고, 문단 제목은 노트의 칸 이름을 따른다.`;

/** SDK 호출을 바꿔 끼울 수 있게 한 틈(시험에서 가짜 실행을 넣는다) */
export type BlogQuery = (params: Parameters<typeof query>[0]) => AsyncIterable<{ readonly type: string; readonly subtype?: string; readonly result?: string }>;

/**
 * 정리 노트를 바탕으로 블로그 초안을 쓴다. 규칙 초안(draftRule)과 같은 가벼운 단발 호출이다:
 * 가장 값싼 모델(haiku) 한 번, 도구 없음, 쓰기 권한 없음, 한 턴. 파일은 만들지 않고 글만 돌려받는다.
 * 입력은 호출하는 쪽이 이미 공개용 가림을 거친 정리 노트여야 한다.
 */
export async function draftBlog(note: string, tone: BlogTone, env: Record<string, string>, claudeExecutable?: string, timeoutMs = 120_000, run: BlogQuery = query as unknown as BlogQuery): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const messages = run({
      prompt: `어투: ${TONE[tone]}\n\n정리 노트:\n${note.slice(0, BLOG_NOTE_LIMIT)}`,
      options: {
        model: MODEL_ID.haiku,
        env,
        abortController: controller,
        systemPrompt: SYSTEM,
        tools: [],
        allowedTools: [],
        settingSources: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        ...(claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
      },
    });
    for await (const message of messages) {
      if (message.type !== 'result') continue;
      const text = message.subtype === 'success' ? (message.result ?? '').trim() : '';
      if (text === '') throw new DomainError('BLOG_DRAFT_FAILED', '초안을 쓰지 못했어요. 잠시 뒤 다시 해 주세요.');
      return text;
    }
    throw new DomainError('BLOG_DRAFT_FAILED', '초안을 쓰지 못했어요.');
  } finally {
    clearTimeout(timer);
  }
}
