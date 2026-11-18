import { DomainError } from '../../shared/domain-error.js';
import type { MemberRole } from './member-role.js';

/**
 * rauha 작업 공간 도구(레포 목록·최근 변경·내 커밋·할 일)를 받는 역할: 답하고, 문서를 쓰고, 분석·계획하고, 커밋·릴리스를 정리하는 팀원.
 * 한 레포 안에서 테스트·구현만 하는 팀원과 라우터처럼 판정만 하는 팀원은 받지 않는다(도구 설명만큼 한도를 아낀다).
 */
const ROLES: ReadonlySet<MemberRole> = new Set(['answerer', 'writer', 'debugger', 'planner', 'riskchecker', 'designer', 'releaser', 'publisher', 'chief']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAMES_MAX = 50;

export class WorkspaceToolAccess {
  private constructor() {}

  static wants(role: MemberRole): boolean {
    return ROLES.has(role);
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

  /** 저장소 이름 목록. 없으면 빈 배열(모든 저장소) */
  static names(input: unknown): string[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input) || input.some((n) => typeof n !== 'string')) throw new DomainError('INVALID_INPUT', 'repos must be a list of repository names.');
    if (input.length > NAMES_MAX) throw new DomainError('INVALID_INPUT', `Up to ${NAMES_MAX} repositories at once.`);
    return input as string[];
  }
}
