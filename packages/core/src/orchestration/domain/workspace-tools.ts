import { DomainError } from '../../shared/domain-error.js';
import type { MemberRole } from './member-role.js';

/** rauha 작업 공간 도구 이름. 팀원에게는 mcp__rauha__<이름> 으로 보인다. */
export const WORKSPACE_TOOL_NAMES = [
  'workspace_repos', 'repo_changes', 'my_commits', 'todo_list', 'repo_status', 'search_repos', 'file_history', 'show_commit',
  'ci_runs', 'ci_log', 'past_work', 'company_notes', 'dependencies',
] as const;
export type WorkspaceToolName = (typeof WORKSPACE_TOOL_NAMES)[number];

const ALL: readonly WorkspaceToolName[] = WORKSPACE_TOOL_NAMES;
/** 기획·마케팅·디자인 부서: 회사가 정한 것, 최근에 나간 기능, 지난 결정 */
const BUSINESS: readonly WorkspaceToolName[] = ['company_notes', 'workspace_repos', 'repo_changes', 'past_work'];

/**
 * 역할마다 하는 일에 필요한 도구만 붙인다(도구 설명도 입력이라 한도를 쓴다). 빈 목록이면 서버를 붙이지 않는다.
 * 테스트 팀원(정해진 동작만 검증)·라우터(판정만)·조사 팀원(한 레포 지도)은 받지 않는다.
 */
const BY_ROLE: Readonly<Record<MemberRole, readonly WorkspaceToolName[]>> = {
  // 답하고, 문서를 쓰고, 원인을 찾고, 전체를 보는 팀원은 모두
  answerer: ALL,
  writer: ALL,
  debugger: ALL,
  chief: ALL,
  planner: [...BUSINESS, 'search_repos', 'dependencies', 'repo_status', 'todo_list'],
  // 개발 흐름
  intake: ['past_work', 'workspace_repos', 'company_notes'],
  splitter: ['workspace_repos', 'search_repos', 'repo_status', 'dependencies', 'past_work'],
  designer: ['workspace_repos', 'repo_changes', 'search_repos', 'file_history', 'show_commit', 'past_work', 'company_notes', 'dependencies'],
  implementer: ['search_repos', 'file_history', 'past_work'],
  reviewer: ['search_repos', 'file_history', 'show_commit', 'past_work'],
  tester: [],
  router: [],
  surveyor: [],
  // 품질·보안
  riskchecker: ['repo_changes', 'repo_status', 'search_repos', 'file_history', 'show_commit', 'ci_runs', 'ci_log', 'past_work', 'dependencies'],
  securitychecker: ['search_repos', 'dependencies', 'file_history', 'show_commit', 'repo_changes', 'company_notes'],
  // 운영
  operator: ['repo_status', 'repo_changes', 'show_commit', 'ci_runs', 'ci_log', 'past_work'],
  releaser: ['repo_changes', 'show_commit', 'ci_runs', 'ci_log', 'my_commits', 'company_notes', 'todo_list', 'repo_status'],
  publisher: ['repo_status', 'repo_changes', 'show_commit', 'ci_runs'],
  // 기획·마케팅·디자인
  bm: [...BUSINESS, 'dependencies'],
  marketer: BUSINESS,
  growth: BUSINESS,
  brand: ['company_notes', 'past_work'],
  uxdesigner: [...BUSINESS, 'search_repos'],
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAMES_MAX = 50;
const PATH_MAX = 500;
const PATTERN_MAX = 200;
/** 해시·태그·브랜치 이름. - 로 시작하면 git 옵션으로 읽히므로 막는다 */
const REVISION = /^(?!-)[\w./~^@{}-]{1,100}$/;

/**
 * 이름(대소문자 무시) 또는 루트 경로 끝으로 저장소를 고른다. names 가 비면 모두.
 */
export function matchRepos<T extends { readonly name: string; readonly root: string }>(repos: readonly T[], names: readonly string[]): T[] {
  const wanted = names.map((n) => n.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()).filter((n) => n !== '');
  if (wanted.length === 0) return [...repos];
  return repos.filter((r) => {
    const root = r.root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return wanted.some((w) => w === r.name.toLowerCase() || root === w || root.endsWith(`/${w}`));
  });
}

export class WorkspaceToolAccess {
  private constructor() {}

  /** 이 역할이 쓰는 작업 공간 도구(없으면 빈 목록) */
  static toolsFor(role: MemberRole): readonly WorkspaceToolName[] {
    return BY_ROLE[role];
  }

  static wants(role: MemberRole): boolean {
    return BY_ROLE[role].length > 0;
  }
}

/** 도구 입력 검사. 틀리면 이유를 담아 던진다(팀원이 고쳐 다시 부른다). */
export class WorkspaceToolInput {
  private constructor() {}

  /** YYYY-MM-DD 또는 없음(null) */
  static since(input: unknown): string | null {
    if (input === undefined || input === null || input === '') return null;
    if (typeof input !== 'string' || !DAY.test(input.trim())) throw new DomainError('INVALID_INPUT', 'since must be a date like 2026-11-01.');
    return input.trim();
  }

  /** 저장소 하나의 이름(꼭 있어야 한다) */
  static repo(input: unknown): string {
    if (typeof input !== 'string' || input.trim() === '') throw new DomainError('INVALID_INPUT', 'repo is required: one repository name from workspace_repos.');
    return input.trim();
  }

  /** 저장소 안의 상대 경로. 빈 값·NUL·저장소 밖(..)은 안 된다. 역슬래시는 슬래시로 */
  static path(input: unknown): string {
    if (typeof input !== 'string') throw new DomainError('INVALID_INPUT', 'path must be a file path inside the repository.');
    const p = input.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (p === '' || p.length > PATH_MAX || p.includes('\0') || p.split('/').includes('..') || /^([a-z]:)?\//i.test(p)) throw new DomainError('INVALID_INPUT', 'path must be relative to the repository root, like src/app.ts.');
    return p;
  }

  /** 커밋 해시(4~40자리 16진수) 또는 태그·브랜치 이름 */
  static revision(input: unknown): string {
    if (typeof input !== 'string' || !REVISION.test(input.trim())) throw new DomainError('INVALID_INPUT', 'commit must be a hash like a1b2c3d or a tag name like v1.2.0.');
    return input.trim();
  }

  /** 찾을 글(1~200자, 첫 글자가 - 이면 안 된다: git 옵션으로 읽히지 않게) */
  static pattern(input: unknown): string {
    if (typeof input !== 'string' || input.trim() === '' || input.length > PATTERN_MAX || input.includes('\0')) throw new DomainError('INVALID_INPUT', `pattern must be 1 to ${PATTERN_MAX} characters.`);
    return input;
  }

  /** 파일 거르기 glob(예: *.ts, src/**). 없으면 null */
  static glob(input: unknown): string | null {
    if (input === undefined || input === null || input === '') return null;
    if (typeof input !== 'string' || input.length > PATH_MAX || input.includes('\0') || input.split(/[\\/]/).includes('..') || input.startsWith('-')) throw new DomainError('INVALID_INPUT', 'glob must be a file pattern like *.ts or src/**.');
    return input.trim();
  }

  /** Actions 실행 번호 */
  static runId(input: unknown): number {
    if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) throw new DomainError('INVALID_INPUT', 'run_id must be a run number from ci_runs.');
    return input;
  }

  /** 저장소 이름 목록. 없으면 빈 배열(모든 저장소) */
  static names(input: unknown): string[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input) || input.some((n) => typeof n !== 'string')) throw new DomainError('INVALID_INPUT', 'repos must be a list of repository names.');
    if (input.length > NAMES_MAX) throw new DomainError('INVALID_INPUT', `Up to ${NAMES_MAX} repositories at once.`);
    return input as string[];
  }
}
