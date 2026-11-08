import type { ApprovalSummary } from './approval-summary.js';
import type { ChangeReview } from './branch-impact.js';
import type { RuleView } from './rules-form.js';
import type { FolderKind } from './folder-kind.js';
import type { RepoStatus } from './git-status.js';
import type { GitApi } from './git-api.js';
import type { Settings } from './settings.js';
import type { UpdateView } from './update-record.js';
import type { InfraRisk } from '@rauha/core/jobs';
import { ROLE_INFO, type Job, type JobBoard, type JobStatus, type MemberRole } from '@rauha/core/jobs';

/** main ↔ 화면 IPC 채널. 화면은 이 채널로만 main과 이야기한다. */
export const IPC = {
  submit: 'job:submit',
  stop: 'job:stop',
  /** 같은 질문을 깊게 다시 답해 달라("더 깊게") */
  deeper: 'job:deeper',
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
  /** 규칙 탭: 목록 · 더하기 · 지우기 */
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  usageGet: 'usage:get',
  accountsList: 'accounts:list',
  folderPick: 'folder:pick',
  reposList: 'repos:list',
  /** git 탭: 함수 이름(고정 목록) + 레포 루트 + 인자를 한 채널로 보낸다 */
  gitCall: 'git:call',
  rulesDraft: 'rules:draft',
  rulesList: 'rules:list',
  rulesAdd: 'rules:add',
  rulesRemove: 'rules:remove',
  /** main → 화면: 알림을 눌러 그 작업의 팀 상세를 열어 달라 */
  openJob: 'ui:open-job',
  /** main → 화면: 앱 메뉴(Cmd+,)에서 탭을 열어 달라 */
  openTab: 'ui:open-tab',
  /** main → 화면: 전체 화면에 들어가거나 나왔다(맥 신호등이 사라지는 때) */
  fullScreen: 'ui:fullscreen',
  /** 화면 → main: 터미널 rauha 실행 파일을 찾는다 / 확인받은 것만 지운다 */
  terminalFind: 'terminal:find',
  terminalRemove: 'terminal:remove',
  /** 새 버전 알림: 상태 읽기(main → 화면 푸시도 같은 이름) · 지금 확인 · 내려받기 열기 · 나중에 */
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateDismiss: 'update:dismiss',
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
  /** 답 아래 "더 깊게" 버튼을 보일지(가볍게 답한 질문만) */
  readonly canGoDeeper: boolean;
  /** 깊게 답했지만 저장소 정보를 아직 못 읽은 채였다 */
  readonly knowledgeMissing: boolean;
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
  /** 운영 팀원이 함께 낸 인프라 위험도(없으면 null → 모름) */
  readonly risk: InfraRisk | null;
}

/** 허락 화면의 네 버튼 */
export type ApprovalChoice = { readonly kind: 'once' } | { readonly kind: 'job' } | { readonly kind: 'revise'; readonly note: string } | { readonly kind: 'deny' };

/** preload가 화면에 열어 주는 API(window.rauha) */
export interface RauhaApi {
  submit(text: string): Promise<JobView | null>;
  stop(id: string): void;
  /** 끝난 작업의 질문을 깊게 다시 묻는 새 작업을 만든다 */
  goDeeper(id: string): Promise<JobView | null>;
  onBoard(listener: (board: BoardView) => void): void;
  boardNow(): Promise<BoardView>;
  onApprovals(listener: (list: readonly ApprovalView[]) => void): void;
  approvalsNow(): Promise<readonly ApprovalView[]>;
  answerApproval(id: string, choice: ApprovalChoice): void;
  /** 코드 허락의 정리: 바뀐 파일·diff·보호 브랜치별 영향. 레포를 알 수 없으면 null */
  reviewApproval(id: string): Promise<ChangeReview | null>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** 구독 사용률(%)과 초기화 시각. 아직 못 읽었으면 null */
  getUsage(): Promise<UsageView | null>;
  listAccounts(): Promise<AccountsView>;
  /** 폴더 고르기 창을 연다. 취소하면 null */
  pickFolder(): Promise<string | null>;
  listRepos(): Promise<readonly RepoRow[]>;
  /** git 탭: 앱이 아는 레포에서만 순수 git 명령을 돌린다(모델 호출 없음) */
  readonly git: GitApi;
  /** 말로 적은 규칙을 haiku 한 번으로 정리한 초안. 사용자가 확인해야 규칙이 된다. */
  draftRule(sentence: string): Promise<DraftResult>;
  listRules(): Promise<readonly RuleView[]>;
  /** 규칙을 더한다. 규칙이 안 맞으면 이유를 돌려준다(저장하지 않는다). */
  addRule(rule: RuleView): Promise<RulesResult>;
  removeRule(id: string): Promise<readonly RuleView[]>;
  onOpenJob(listener: (jobId: string) => void): void;
  onOpenTab(listener: (tab: string) => void): void;
  onFullScreen(listener: (on: boolean) => void): void;
  /** 실행 중인 OS(darwin·win32·linux). 단축키 표기와 창 모양에 쓴다. */
  readonly platform: string;
  findTerminalRauha(): Promise<readonly TerminalRauhaView[]>;
  removeTerminalRauha(paths: readonly string[]): Promise<readonly string[]>;
  readonly update: UpdateApi;
}

/** 새 버전 알림 API. 내려받을 주소는 화면이 보내지 않는다(main이 검증한 것만 연다). */
export interface UpdateApi {
  state(): Promise<UpdateView>;
  check(): Promise<UpdateView>;
  /** 브라우저로 설치 파일 내려받기를 연다. 열 주소가 없으면 false */
  download(): Promise<boolean>;
  dismiss(): Promise<UpdateView>;
  onState(listener: (view: UpdateView) => void): void;
}

export type SettingsPatch = Partial<Omit<Settings, 'notify'>> & { notify?: Partial<Settings['notify']> };

export interface UsageWindowView {
  readonly percent: number;
  readonly resetsAt: string | null;
}

/** 구독 한도. 돈(달러)이 아니라 %로만 보인다. */
export interface UsageView {
  readonly session: UsageWindowView | null;
  readonly weekly: UsageWindowView | null;
}

export interface AccountsView {
  readonly names: readonly string[];
  /** 설정에서 고른 계정(없으면 null = 폴더 규칙) */
  readonly selected: string | null;
}

/** 레포 탭 한 줄 */
export interface RepoRow {
  readonly name: string;
  readonly root: string;
  readonly relative: string;
  readonly kind: FolderKind;
  readonly status: RepoStatus | null;
  /** 지금 이 폴더에서 일하는(끝나지 않은) 작업 수 */
  readonly working: number;
  /** 그중 worktree에서 도는 작업 수(같은 레포에 먼저 도는 일이 있어서 따로 일하는 것) */
  readonly worktrees: number;
}

export type DraftResult = { readonly ok: true; readonly draft: Omit<RuleView, 'id'> } | { readonly ok: false; readonly error: string };

export type RulesResult = { readonly ok: true; readonly rules: readonly RuleView[] } | { readonly ok: false; readonly error: string };

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
    canGoDeeper: job.resultMeta.canGoDeeper,
    knowledgeMissing: job.resultMeta.knowledgeMissing,
    notes: job.notes.map((n) => ({ role: n.role, roleName: n.role === null ? null : ROLE_INFO[n.role].name, message: n.message, at: n.at })),
  };
}

export function boardView(board: JobBoard): BoardView {
  return { jobs: board.jobs.map(jobView), ...board.counts(), limit: board.limit };
}
