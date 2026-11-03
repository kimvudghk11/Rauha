import type { DesignApproval, DesignPlan, DesignQuestion } from '../../design/application/ports.js';
import type { LearningBook } from '../domain/learning-book.js';
import type { CompanyBook } from '../domain/company-book.js';
import type { CheckedClaim } from '../domain/fact-check.js';
import type { TestRun } from '../domain/test-run.js';
import type { ToolKit } from '../domain/tool-kit.js';
import type { CheckResult } from '../domain/verification.js';
import type { Assumption } from './dto/intake.dto.js';
import type { MemberRole, RoleSetting } from './dto/role-settings.dto.js';

/** 팀원 한 번 호출. 바뀌는 입력(업무 지시서 등)은 userMessage에, 역할 프롬프트는 어댑터가 넣는다. */
export interface MemberCall {
  readonly role: MemberRole;
  readonly setting: RoleSetting;
  readonly userMessage: string;
  readonly outputSchema: Record<string, unknown>;
  /** 작업 폴더 기준 상대 경로를 이 역할이 쓸 수 있는지(WritePolicy). */
  readonly canWrite: (relPath: string) => boolean;
  /** 이 호출만 멈출 때. 판정을 기다리지 않고 미리 시작한 답변을 버릴 때 쓴다. */
  readonly signal?: AbortSignal;
  /** 작업 폴더 밖에서 더 읽을 수 있는 폴더(여러 저장소에 걸친 질문). 절대 경로. */
  readonly additionalDirectories?: readonly string[];
  /** 더 붙일 도구 묶음(브라우저, AWS 지식). 요청이 그쪽을 가리킬 때만 ToolKits가 고른다. */
  readonly kits?: readonly ToolKit[];
}

/** 미리 띄워 둘 호출. 보낼 메시지만 아직 모른다. */
export type PreparedCall = Omit<MemberCall, 'userMessage' | 'signal' | 'additionalDirectories' | 'kits'>;

export interface MemberUsage {
  readonly model: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly denials: readonly string[];
  readonly endReason: string;
}

export interface FetchedPage {
  readonly url: string;
  /** 가져온 본문(앞부분). 남기지 못했으면 null */
  readonly body: string | null;
}

export interface MemberResult {
  /** 구조화 출력. 실패하면 null. */
  readonly output: unknown;
  readonly error: string | null;
  readonly usage: MemberUsage;
  /** 이번 호출에서 팀원이 WebFetch로 실제로 연 주소. web 근거 확인에 쓴다. */
  readonly fetched: readonly FetchedPage[];
  /** 계정 문제(사용 한도, 로그인 안 됨)로 막혔으면 그 내용. 다시 불러도 같은 오류라 바로 멈춘다. 아니면 null이나 없음. */
  readonly blocked?: AccountBlock | null;
}

/**
 * 다시 불러도 소용없어 흐름을 바로 끊어야 하는 이유: 계정 문제(사용 한도, 로그인 안 됨)나 사용자가 직접 멈춤.
 * usage-limit의 message에는 풀리는 시각이 들어 있다.
 */
export interface AccountBlock {
  readonly reason: 'usage-limit' | 'login' | 'cancelled';
  readonly message: string;
}

export interface TeamMemberPort {
  run(call: MemberCall): Promise<MemberResult>;
  /** 같은 역할·설정으로 곧 부를 호출을 미리 띄워 둔다(대화 모드에서 기다리는 시간을 줄인다). 쓴 뒤에도 다시 띄워 둔다. */
  prepare?(call: PreparedCall): void;
}

export interface HeldLock {
  release(): Promise<void>;
}

/** 한 폴더에서 동시에 두 작업이 돌지 않게 하는 잠금. 다른 rauha가 잡고 있으면 null. */
export interface WorkLockPort {
  acquire(): Promise<HeldLock | null>;
}

export interface FileChange {
  readonly path: string;
  readonly kind: 'added' | 'modified' | 'deleted';
}

/** HEAD 대비 바뀐 파일 → 내용 해시. 두 스냅숏을 비교해 한 팀원이 바꾼 파일을 구한다. */
export interface WorkspaceSnapshot {
  readonly files: ReadonlyMap<string, string>;
}

export interface WorkspacePort {
  /** 커밋하지 않은 파일 목록. git 저장소가 아니면 null. */
  dirtyFiles(): Promise<string[] | null>;
  /** 프로젝트 파일 목록(추적 중 + 새 파일, 실행 폴더 기준). 접수 팀장이 훑는 시간을 줄인다. */
  listFiles(): Promise<string[]>;
  /** 근거 확인용 파일 읽기(실행 폴더 기준). 밖이거나 없으면 null. */
  readFile(path: string): Promise<string | null>;
  snapshot(): Promise<WorkspaceSnapshot>;
  changesBetween(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChange[];
  changesSinceHead(): Promise<FileChange[]>;
  /** /review 대상 파일. null = 지금 HEAD 대비 커밋 안 한 변경, 브랜치·커밋 = 그것과 갈라진 뒤의 변경. 없는 이름이면 DomainError. */
  reviewChanges(target: string | null): Promise<FileChange[]>;
}

export interface TestsResult {
  readonly run: TestRun;
  readonly ids: readonly string[];
  /** 통과한 테스트의 전체 이름. test 근거 확인에 쓴다. */
  readonly passed: readonly string[];
  readonly digest: string;
  readonly command: string;
}

export interface ChecksPort {
  runTests(files: readonly string[]): Promise<TestsResult>;
  /** 전체 테스트·타입 검사·린트. 없는 검사는 status 'skip'. */
  runSuite(): Promise<CheckResult[]>;
}

export interface RunLogPort {
  recordCall(role: MemberRole, attempt: number, call: MemberCall, result: MemberResult): Promise<void>;
  recordChecks(label: string, results: readonly CheckResult[]): Promise<void>;
  /** 기록 폴더 경로를 돌려준다. */
  finish(summary: Record<string, unknown>, guideMarkdown: string): Promise<string>;
}

/** correct: 맞음(사실로 처리), wrong: 틀림(정정을 넣어 2차 구현), unsure: 모름(추측으로 남김) */
export type FactAnswer = { readonly kind: 'correct' } | { readonly kind: 'wrong'; readonly correction: string } | { readonly kind: 'unsure' };

/** 사용자에게 해석과 추측을 확인받는다. 물어볼 화면이 없으면 interactive가 false이고 아무것도 묻지 않는다. */
export interface UserPort {
  readonly interactive: boolean;
  /** 0 = 추천 해석(chosen), 1.. = alternatives의 순서. */
  choose(assumption: Assumption): Promise<number>;
  /** 코드에 들어갔는데 근거가 확인되지 않은 사실이 맞는지 묻는다. */
  confirmFact(claim: CheckedClaim): Promise<FactAnswer>;
  /** "아까 그 기능"의 후보 중 하나를 고르게 한다. null = 새 작업. */
  pickPast(candidates: readonly PastCandidate[]): Promise<string | null>;
  /** 여러 저장소 작업 공간에서 어느 저장소 일인지 고르게 한다. 고른 이름, 고르지 않으면 null. 없으면 묻지 않는다. */
  pickRepo?(candidates: readonly { readonly name: string; readonly root: string }[]): Promise<string | null>;
  /** 설계 대화: 설계 팀원의 질문 하나에 답하게 한다. 그만두면 null. 없으면 설계 대화를 하지 않는다. */
  discuss?(question: DesignQuestion): Promise<string | null>;
  /** 설계 대화: 설계안을 보여 주고 승인·고칠 점·그만두기를 고르게 한다. */
  approve?(plan: DesignPlan): Promise<DesignApproval>;
}

/** 기억에서 찾은 지난 작업 후보 */
export interface PastCandidate {
  readonly id: string;
  readonly title: string;
  /** ISO 시각 */
  readonly at: string;
}

export interface ProgressPort {
  /** role: 그 팀원이 일을 시작했다는 알림일 때만 넣는다. 화면은 다음 알림까지 그 팀원이 일하는 중으로 보여 준다. */
  step(message: string, role?: MemberRole): void;
}

/** 회사 장부(부서마다 가장 최근 결과의 요약)를 읽고 쓴다. 읽을 수 없으면 빈 장부를 돌려준다. */
export interface CompanyBookPort {
  load(): Promise<CompanyBook>;
  save(book: CompanyBook): Promise<void>;
}

/** 학습 노트(작업에서 쓰인 패턴과 이유)를 읽고 쓴다. 읽을 수 없으면 빈 노트를 돌려준다. */
export interface LearningPort {
  load(): Promise<LearningBook>;
  save(book: LearningBook): Promise<void>;
}
