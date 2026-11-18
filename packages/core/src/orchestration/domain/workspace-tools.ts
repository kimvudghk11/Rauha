import { DomainError } from '../../shared/domain-error.js';
import type { MemberRole } from './member-role.js';

/** rauha 작업 공간 도구 이름. 팀원에게는 mcp__rauha__<이름> 으로 보인다. */
export const WORKSPACE_TOOL_NAMES = [
  'workspace_repos', 'repo_changes', 'my_commits', 'todo_list', 'repo_status', 'search_repos', 'file_history', 'show_commit',
  'ci_runs', 'ci_log', 'past_work', 'company_notes', 'dependencies', 'read_spreadsheet',
] as const;
export type WorkspaceToolName = (typeof WORKSPACE_TOOL_NAMES)[number];

/** 도구를 받지 않는 역할: 라우터는 입력 종류만 가르고 도구 없이 짧게 끝난다. */
const NO_TOOLS: ReadonlySet<MemberRole> = new Set(['router']);
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

  /**
   * 이 역할이 쓰는 작업 공간 도구(없으면 빈 목록). 한도보다 답의 질을 먼저 본다(2026-11-18 사용자 결정):
   * 라우터를 뺀 모든 팀원(개발·품질·운영·기획·마케팅·디자인)이 모든 도구를 받아, 필요한 사실을 스스로 가져온다.
   */
  static toolsFor(role: MemberRole): readonly WorkspaceToolName[] {
    return NO_TOOLS.has(role) ? [] : WORKSPACE_TOOL_NAMES;
  }

  static wants(role: MemberRole): boolean {
    return WorkspaceToolAccess.toolsFor(role).length > 0;
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
