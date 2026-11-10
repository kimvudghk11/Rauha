import type { ApprovalReply, DirectionReply, PermissionAnswer, PermissionAsker, PermissionRequest, ProgressPort, TurnOutcome, UserPort } from '@rauha/core';
import type { Job, JobResultMeta, JobWork } from '@rauha/core/jobs';
import type { AskPayload, AskReply } from './approvals.js';
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
  /**
   * 분석의 질문 카드(방향 고르기·계획 승인)를 사용자에게 보인다. signal이 꺼지면 카드를 닫고 그만두기로 답한다.
   * 없으면 물어볼 화면이 없는 것으로 보고, 분석은 방향 비교까지만 하고 멈춘다.
   */
  readonly askCard?: (jobId: string, payload: AskPayload, signal: AbortSignal) => Promise<AskReply>;
}

/** 화면이 없어도 묻지 않고 추천대로 간다(질문 최소화). 허락만 사용자에게 간다. */
const quietUser: UserPort = {
  interactive: false,
  choose: async () => 0,
  confirmFact: async () => ({ kind: 'unsure' }),
  pickPast: async () => null,
};

/** 답 카드에 붙일 꼬리표. 지식 없음은 질문 답 경로가 깊게(canGoDeeper가 false로 명시) 답했는데도 읽은 저장소 기준(basis)이 없을 때만이다. 운영·문서·반복 답처럼 저장소를 읽는 길이 아닌 답은 해당 없음. */
export function resultMetaOf(outcome: TurnOutcome): JobResultMeta {
  if (outcome.kind !== 'answer') return { canGoDeeper: false, knowledgeMissing: false };
  const canGoDeeper = outcome.canGoDeeper === true;
  return { canGoDeeper, knowledgeMissing: outcome.canGoDeeper === false && outcome.basis === null, ...(outcome.toolsLine !== undefined ? { toolsLine: outcome.toolsLine } : {}) };
}

/**
 * 작업(Job)을 진짜 팀(ChatSession)에 맡긴다. 작업마다 새 세션이라 동시에 불러도 상태가 섞이지 않는다.
 * 서비스 규칙 그대로: 만들기 → 부르기 → 결과 알리기. 판단은 세션과 작업판에 있다.
 */
export function teamWork(deps: TeamWorkDeps): JobWork {
  return async (job, signal, report) => {
    // 사용자의 답을 기다리는 동안 작업은 "기다림"이다(허락이든 방향 고르기든)
    const waiting = async <T>(wait: () => Promise<T>): Promise<T> => {
      report.waiting(true);
      try {
        return await wait();
      } finally {
        report.waiting(false);
      }
    };
    const askCard = deps.askCard;
    const io: TeamIo = {
      progress: { step: (message, role) => report.note(role ?? null, message) },
      ask: (request) => waiting(() => deps.askUser(job.id, request)),
      user:
        askCard === undefined
          ? quietUser
          : {
              ...quietUser,
              analysis: {
                chooseDirection: (card, cardSignal) => waiting(() => askCard(job.id, { kind: 'directions', card }, cardSignal)) as Promise<DirectionReply>,
                decide: (card, cardSignal) => waiting(() => askCard(job.id, { kind: 'approval', card }, cardSignal)) as Promise<ApprovalReply>,
              },
            },
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
    // 팀이 일을 끝까지 못 했으면 "끝"이 아니라 "멈춤"으로 보인다(결과 글에 이유가 있다)
    if (outcome.kind === 'work' && outcome.outcome.status === 'stopped') throw new Error('팀이 일을 마치지 못했어요');
    // 승인한 계획을 구현하다 멈춘 분석도 "끝"이 아니라 "멈춤"이다. 사용자가 그만둔 분석은 끝이다.
    if (outcome.kind === 'analysis' && outcome.implemented?.status === 'stopped') throw new Error('팀이 일을 마치지 못했어요');
  };
}
