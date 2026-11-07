import type { ApprovalSummary } from './approval-summary.js';
import type { ChangeReview } from './branch-impact.js';
import { ROLE_INFO, type Job, type JobBoard, type JobStatus, type MemberRole } from '@rauha/core/jobs';

/** main ↔ 화면 IPC 채널. 화면은 이 채널로만 main과 이야기한다. */
export const IPC = {
  submit: 'job:submit',
  stop: 'job:stop',
  /** main → 화면: 작업판이 바뀔 때마다 보낸다 */
  board: 'job:board',
  /** 화면 → main: 지금 작업판을 한 번 달라(화면을 새로 열 때) */
  boardNow: 'job:board-now',
  /** main → 화면: 허락을 기다리는 요청 목록이 바뀔 때마다 */
  approvals: 'approval:list',
  approvalsNow: 'approval:list-now',
  /** 화면 → main: 허락 요청에 답한다 */
  approvalAnswer: 'approval:answer',
  /** 화면 → main: 허락 요청 하나의 변경 검토(diff·main/qa 영향)를 git으로 계산해 달라 */
  approvalReview: 'approval:review',
  /** main → 화면: 알림을 눌러 그 작업의 팀 상세를 열어 달라 */
  openJob: 'ui:open-job',
  /** main → 화면: 앱 메뉴(Cmd+,)에서 탭을 열어 달라 */
  openTab: 'ui:open-tab',
  /** 화면 → main: 터미널 rauha 실행 파일을 찾는다 / 확인받은 것만 지운다 */
  terminalFind: 'terminal:find',
  terminalRemove: 'terminal:remove',
} as const;

/** 단계 막대 한 칸. 지나온 단계는 done, 지금 단계는 now. */
export interface StepView {
  readonly label: string;
  readonly state: 'done' | 'now';
}

export interface NoteView {
  readonly role: MemberRole | null;
  readonly roleName: string | null;
  readonly message: string;
  readonly at: string;
}

export interface JobView {
  readonly id: string;
  readonly request: string;
  readonly status: JobStatus;
  readonly stopReason: string | null;
  readonly queuedAt: string;
  readonly endedAt: string | null;
  /** 지금 일하는 팀원(없으면 null) */
  readonly role: MemberRole | null;
  readonly roleName: string | null;
  /** 방에 서 있는 캐릭터들: 일에 나온 팀원(많아야 셋, 오래된 순). 아직 없으면 팀장 하나. */
  readonly cast: readonly MemberRole[];
  readonly steps: readonly StepView[];
  /** 가장 최근 한 줄 */
  readonly lastLine: string | null;
  readonly result: string | null;
  readonly notes: readonly NoteView[];
}

export interface BoardView {
  readonly jobs: readonly JobView[];
  readonly running: number;
  readonly waiting: number;
  readonly queued: number;
  readonly limit: number;
}

/** 허락 요청 하나(화면용). 정리(summary)와 원본 명령을 함께 보낸다. */
export interface ApprovalView {
  readonly id: string;
  readonly jobId: string;
  readonly role: MemberRole;
  readonly roleName: string;
  readonly tool: string;
  /** 원본 명령이나 파일 경로 */
  readonly detail: string;
  readonly reason: string;
  readonly at: string;
  readonly summary: ApprovalSummary;
}

/** 허락 화면의 네 버튼 */
export type ApprovalChoice = { readonly kind: 'once' } | { readonly kind: 'job' } | { readonly kind: 'revise'; readonly note: string } | { readonly kind: 'deny' };

/** preload가 화면에 열어 주는 API(window.rauha) */
export interface RauhaApi {
  submit(text: string): Promise<JobView | null>;
  stop(id: string): void;
  onBoard(listener: (board: BoardView) => void): void;
  boardNow(): Promise<BoardView>;
  onApprovals(listener: (list: readonly ApprovalView[]) => void): void;
  approvalsNow(): Promise<readonly ApprovalView[]>;
  answerApproval(id: string, choice: ApprovalChoice): void;
  /** 코드 허락의 정리: 바뀐 파일·diff·보호 브랜치별 영향. 레포를 알 수 없으면 null */
  reviewApproval(id: string): Promise<ChangeReview | null>;
  onOpenJob(listener: (jobId: string) => void): void;
  onOpenTab(listener: (tab: string) => void): void;
  /** 실행 중인 OS(darwin·win32·linux). 단축키 표기와 창 모양에 쓴다. */
  readonly platform: string;
  findTerminalRauha(): Promise<readonly TerminalRauhaView[]>;
  removeTerminalRauha(paths: readonly string[]): Promise<readonly string[]>;
}

/** 첫 실행에서 사용자에게 보여 줄 터미널 rauha 실행 파일 한 줄 */
export interface TerminalRauhaView {
  readonly path: string;
  readonly entry: string;
}

const CAST_MAX = 3;

/** 기록에 나온 단계 이름을 순서대로(같은 단계는 한 번). 끝난 작업은 모두 done, 아니면 마지막이 now. */
export function stepsOf(job: Job): readonly StepView[] {
  const labels: string[] = [];
  for (const note of job.notes) {
    const stage = note.role === null ? null : ROLE_INFO[note.role].stage;
    if (stage !== null && labels[labels.length - 1] !== stage && !labels.includes(stage)) labels.push(stage);
  }
  return labels.map((label, i) => ({ label, state: !job.isOver && i === labels.length - 1 ? 'now' : 'done' }));
}

export function castOf(job: Job): readonly MemberRole[] {
  const seen: MemberRole[] = [];
  for (const note of job.notes) if (note.role !== null && !seen.includes(note.role)) seen.push(note.role);
  return seen.length === 0 ? ['intake'] : seen.slice(-CAST_MAX);
}

export function jobView(job: Job): JobView {
  const role = job.activeRole;
  return {
    id: job.id,
    request: job.request,
    status: job.status,
    stopReason: job.stopReason,
    queuedAt: job.queuedAt,
    endedAt: job.endedAt,
    role,
    roleName: role === null ? null : ROLE_INFO[role].name,
    cast: castOf(job),
    steps: stepsOf(job),
    lastLine: job.lastNote?.message ?? null,
    result: job.result,
    notes: job.notes.map((n) => ({ role: n.role, roleName: n.role === null ? null : ROLE_INFO[n.role].name, message: n.message, at: n.at })),
  };
}

export function boardView(board: JobBoard): BoardView {
  return { jobs: board.jobs.map(jobView), ...board.counts(), limit: board.limit };
}
