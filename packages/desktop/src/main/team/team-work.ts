import type { PermissionAnswer, PermissionAsker, PermissionRequest, ProgressPort, TurnOutcome, UserPort } from '@rauha/core';
import type { Job, JobResultMeta, JobWork } from '@rauha/core/jobs';
import { describeOutcome } from './describe-outcome.js';

/** 작업 하나가 팀에 닿는 길. 작업마다 따로 만든다(대화 상태를 나눠 갖지 않게). */
export interface TeamIo {
  readonly progress: ProgressPort;
  readonly ask: PermissionAsker;
  readonly user: UserPort;
  /** 작업을 멈추면 꺼진다. 팀원 호출에 이어 붙인다. */
  readonly signal: AbortSignal;
}

export interface TeamSession {
  /** depth 'deep': 라우터 없이 같은 질문을 깊게 다시 답한다 */
  handle(input: string, depth?: 'deep'): Promise<TurnOutcome>;
  /** 일이 끝난 뒤 결과 글 끝에 붙일 한 줄(예: 결과가 남은 브랜치). 없으면 null */
  note?(): string | null;
}

export interface TeamWorkDeps {
  readonly newSession: (io: TeamIo, job: Job) => TeamSession;
  /** 허락을 사용자에게 묻는다(화면의 허락 카드). 작업 id를 함께 넘긴다. */
  readonly askUser: (jobId: string, request: PermissionRequest) => Promise<PermissionAnswer>;
}

/** 화면이 없어도 묻지 않고 추천대로 간다(질문 최소화). 허락만 사용자에게 간다. */
const quietUser: UserPort = {
  interactive: false,
  choose: async () => 0,
  confirmFact: async () => ({ kind: 'unsure' }),
  pickPast: async () => null,
};

/** 답 카드에 붙일 꼬리표. 지식 없음은 깊게 답했는데도 읽은 저장소 기준(basis)이 없을 때다. */
export function resultMetaOf(outcome: TurnOutcome): JobResultMeta {
  if (outcome.kind !== 'answer') return { canGoDeeper: false, knowledgeMissing: false };
  const canGoDeeper = outcome.canGoDeeper === true;
  return { canGoDeeper, knowledgeMissing: !canGoDeeper && outcome.basis === null };
}

/**
 * 작업(Job)을 진짜 팀(ChatSession)에 맡긴다. 작업마다 새 세션이라 동시에 불러도 상태가 섞이지 않는다.
 * 서비스 규칙 그대로: 만들기 → 부르기 → 결과 알리기. 판단은 세션과 작업판에 있다.
 */
export function teamWork(deps: TeamWorkDeps): JobWork {
  return async (job, signal, report) => {
    const io: TeamIo = {
      progress: { step: (message, role) => report.note(role ?? null, message) },
      ask: async (request) => {
        report.waiting(true);
        try {
          return await deps.askUser(job.id, request);
        } finally {
          report.waiting(false);
        }
      },
      user: quietUser,
      signal,
    };
    const session = deps.newSession(io, job);
    const stopped = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(new Error('멈춤'));
      signal.addEventListener('abort', () => reject(new Error('멈춤')), { once: true });
    });
    const outcome = await Promise.race([session.handle(job.request, job.deep ? 'deep' : undefined), stopped]);
    const note = session.note?.() ?? null;
    report.result(note === null ? describeOutcome(outcome) : `${describeOutcome(outcome)}\n\n${note}`, resultMetaOf(outcome));
  };
}
