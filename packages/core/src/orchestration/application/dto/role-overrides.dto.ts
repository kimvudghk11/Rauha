import { MEMBER_ROLES, type MemberRole } from '../../domain/member-role.js';
import type { ModelTier } from '../../domain/team.js';
import type { Effort, RoleOverride, RoleOverrides } from './role-settings.dto.js';

const TIERS: readonly string[] = ['haiku', 'sonnet', 'opus'];
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 팀 설정 파일·화면 입력 ↔ RoleOverrides. 모르는 역할·틀린 칸은 버리고(= 기본값) 나머지로 연다.
 * 규칙(필수 팀원은 끌 수 없음, 아는 도구만 …)은 RoleSettingsDto.withOverrides가 지킨다.
 */
export class RoleOverridesDto {
  private constructor(readonly overrides: RoleOverrides) {}

  static from(input: unknown): RoleOverridesDto {
    const out: Partial<Record<MemberRole, RoleOverride>> = {};
    const roles = isObject(input) && isObject(input['roles']) ? input['roles'] : isObject(input) ? input : {};
    for (const role of MEMBER_ROLES) {
      const raw = roles[role];
      if (!isObject(raw)) continue;
      const o: { -readonly [K in keyof RoleOverride]: RoleOverride[K] } = {};
      if (raw['enabled'] === false) o.enabled = false;
      if (typeof raw['tier'] === 'string' && TIERS.includes(raw['tier'])) o.tier = raw['tier'] as ModelTier;
      if (typeof raw['effort'] === 'string' && EFFORTS.includes(raw['effort'])) o.effort = raw['effort'] as Effort;
      if (Array.isArray(raw['tools'])) o.tools = [...new Set(raw['tools'].filter((t): t is string => typeof t === 'string'))];
      if (typeof raw['extraInstruction'] === 'string' && raw['extraInstruction'].trim() !== '') o.extraInstruction = raw['extraInstruction'].trim();
      if (Object.keys(o).length > 0) out[role] = o;
    }
    return new RoleOverridesDto(out);
  }

  toJSON(): { roles: RoleOverrides } {
    return { roles: this.overrides };
  }
}
