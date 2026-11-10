import { EXTRA_CHARACTER_IDS } from './character-ids.js';
import { MEMBER_ROLES, REQUIRED_ROLES, ROLE_TOOLS, type MemberRole, type RoleOverrides } from '@rauha/core/jobs';

export type Tier = 'haiku' | 'sonnet' | 'opus';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus'];
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const NAME_LIMIT = 12;
export const EXTRA_LIMIT = 2000;

export class TeamSettingsError extends Error {}

/** 팀원 하나에 사용자가 바꾼 것. 안 바꾼 칸은 없다(= 기본값 그대로). */
export interface MemberSetting {
  /** 끈 팀원만 false로 남는다 */
  readonly enabled?: false;
  readonly tier?: Tier;
  readonly effort?: Effort;
  readonly tools?: readonly string[];
  readonly extraInstruction?: string;
  /** 캐릭터 이름(화면에 보이는 이름) */
  readonly name?: string;
  /** 어느 캐릭터 그림을 쓸지(기본 22종의 역할 id 또는 고를 수 있는 새 캐릭터 id) */
  readonly character?: string;
}

export type TeamSettingsJson = { readonly members: Readonly<Partial<Record<MemberRole, MemberSetting>>> };

/** 기본값(코어의 역할 설정)을 알아야 "바꾼 것"만 남길 수 있어서 main이 넘겨 준다. */
export interface MemberDefaults {
  readonly tier: Tier;
  readonly effort: Effort;
  readonly tools: readonly string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
const isCharacter = (v: unknown): v is string => isRole(v) || (typeof v === 'string' && (EXTRA_CHARACTER_IDS as readonly string[]).includes(v));
const isRole = (v: unknown): v is MemberRole => typeof v === 'string' && (MEMBER_ROLES as readonly string[]).includes(v);

/**
 * 팀 설정: 팀원 22명의 켜기·끄기, 모델 등급, 도구, 추가 지시, 이름, 캐릭터. 값은 불변이다.
 * 아무것도 안 바꾼 설정(initial)은 코어의 기본 역할 설정을 그대로 쓰므로 동작이 달라지지 않는다.
 */
export class TeamSettings {
  private constructor(private readonly members: Readonly<Partial<Record<MemberRole, MemberSetting>>>) {}

  static initial(): TeamSettings {
    return new TeamSettings({});
  }

  /** 저장 파일·화면 입력에서. 틀린 칸은 버려 기본값으로 둔다(깨진 파일 때문에 팀이 못 열리지 않게). */
  static from(input: unknown): TeamSettings {
    const raw = isObject(input) && isObject(input['members']) ? input['members'] : {};
    const out: Partial<Record<MemberRole, MemberSetting>> = {};
    for (const role of MEMBER_ROLES) {
      const m = raw[role];
      if (!isObject(m)) continue;
      const s: { -readonly [K in keyof MemberSetting]: MemberSetting[K] } = {};
      if (m['enabled'] === false && !REQUIRED_ROLES.includes(role)) s.enabled = false;
      if (typeof m['tier'] === 'string' && (TIERS as readonly string[]).includes(m['tier'])) s.tier = m['tier'] as Tier;
      if (typeof m['effort'] === 'string' && (EFFORTS as readonly string[]).includes(m['effort'])) s.effort = m['effort'] as Effort;
      if (Array.isArray(m['tools'])) s.tools = [...new Set(m['tools'].filter((t): t is string => typeof t === 'string' && ROLE_TOOLS.includes(t)))];
      if (typeof m['extraInstruction'] === 'string' && m['extraInstruction'].trim() !== '') s.extraInstruction = m['extraInstruction'].trim().slice(0, EXTRA_LIMIT);
      if (typeof m['name'] === 'string' && m['name'].trim() !== '') s.name = m['name'].trim().slice(0, NAME_LIMIT);
      if (isCharacter(m['character'])) s.character = m['character'];
      if (Object.keys(s).length > 0) out[role] = s;
    }
    return new TeamSettings(out);
  }

  toJSON(): TeamSettingsJson {
    return { members: this.members };
  }

  of(role: MemberRole): MemberSetting {
    return this.members[role] ?? {};
  }

  isEnabled(role: MemberRole): boolean {
    return this.of(role).enabled !== false;
  }

  /** 팀원 하나를 바꾼다. null을 주면 그 칸을 기본값으로 되돌린다. 규칙을 어기면 이유를 알리고 바꾸지 않는다. */
  change(role: MemberRole, patch: { readonly enabled?: boolean; readonly tier?: Tier | null; readonly effort?: Effort | null; readonly tools?: readonly string[] | null; readonly extraInstruction?: string | null; readonly name?: string | null; readonly character?: string | null }): TeamSettings {
    const cur = this.of(role);
    const next: { -readonly [K in keyof MemberSetting]: MemberSetting[K] } = { ...cur };
    if (patch.enabled !== undefined) {
      if (!patch.enabled && REQUIRED_ROLES.includes(role)) throw new TeamSettingsError('This teammate is required by the workflow and cannot be turned off.');
      if (patch.enabled) delete next.enabled;
      else next.enabled = false;
    }
    const put = <K extends keyof MemberSetting>(key: K, value: MemberSetting[K] | null | undefined): void => {
      if (value === undefined) return;
      if (value === null) delete next[key];
      else next[key] = value;
    };
    if (patch.tier !== undefined && patch.tier !== null && !TIERS.includes(patch.tier)) throw new TeamSettingsError('Pick a model tier: haiku, sonnet or opus.');
    if (patch.effort !== undefined && patch.effort !== null && !EFFORTS.includes(patch.effort)) throw new TeamSettingsError('Pick the effort level again.');
    put('tier', patch.tier);
    put('effort', patch.effort);
    if (patch.tools !== undefined && patch.tools !== null) {
      const unknown = patch.tools.find((t) => !ROLE_TOOLS.includes(t));
      if (unknown !== undefined) throw new TeamSettingsError(`Unknown tool: ${unknown}`);
    }
    put('tools', patch.tools === undefined || patch.tools === null ? patch.tools : [...new Set(patch.tools)]);
    if (patch.extraInstruction !== undefined && patch.extraInstruction !== null) {
      const t = patch.extraInstruction.trim();
      if (t.length > EXTRA_LIMIT) throw new TeamSettingsError(`Extra instructions can be up to ${EXTRA_LIMIT} characters.`);
      put('extraInstruction', t === '' ? null : t);
    } else put('extraInstruction', patch.extraInstruction);
    if (patch.name !== undefined && patch.name !== null) {
      const t = patch.name.trim();
      if (t.length > NAME_LIMIT) throw new TeamSettingsError(`A name can be up to ${NAME_LIMIT} characters.`);
      put('name', t === '' ? null : t);
    } else put('name', patch.name);
    if (patch.character !== undefined && patch.character !== null && !isCharacter(patch.character)) throw new TeamSettingsError('That character does not exist.');
    put('character', patch.character);
    const members = { ...this.members };
    if (Object.keys(next).length === 0) delete members[role];
    else members[role] = next;
    return new TeamSettings(members);
  }

  /** 팀원 하나를 기본값으로(꺼짐·등급·도구·지시·이름·캐릭터 모두) */
  reset(role: MemberRole): TeamSettings {
    const members = { ...this.members };
    delete members[role];
    return new TeamSettings(members);
  }

  resetAll(): TeamSettings {
    return TeamSettings.initial();
  }

  /** 기본값과 같은 칸은 지운다(저장 파일에는 정말 바꾼 것만 남는다). */
  pruned(defaultsOf: (role: MemberRole) => MemberDefaults): TeamSettings {
    let next: TeamSettings = this;
    for (const role of MEMBER_ROLES) {
      const s = this.of(role);
      const d = defaultsOf(role);
      next = next.change(role, {
        ...(s.tier === d.tier ? { tier: null } : {}),
        ...(s.effort === d.effort ? { effort: null } : {}),
        ...(s.tools !== undefined && sameSet(s.tools, d.tools) ? { tools: null } : {}),
        ...(s.character === role ? { character: null } : {}),
      });
    }
    return next;
  }

  /** 코어(RoleSettingsDto.withOverrides)에 넘길 모양. 이름·캐릭터는 화면용이라 빠진다. */
  overrides(): RoleOverrides {
    const out: { -readonly [R in MemberRole]?: NonNullable<RoleOverrides[R]> } = {};
    for (const role of MEMBER_ROLES) {
      const s = this.of(role);
      const o = {
        ...(s.enabled === false ? { enabled: false } : {}),
        ...(s.tier !== undefined ? { tier: s.tier } : {}),
        ...(s.effort !== undefined ? { effort: s.effort } : {}),
        ...(s.tools !== undefined ? { tools: s.tools } : {}),
        ...(s.extraInstruction !== undefined ? { extraInstruction: s.extraInstruction } : {}),
      };
      if (Object.keys(o).length > 0) out[role] = o;
    }
    return out;
  }

  /** 화면 캐릭터 덮어쓰기용: 역할 → 이름·그림 */
  looks(): { readonly names: Readonly<Partial<Record<MemberRole, string>>>; readonly characters: Readonly<Partial<Record<MemberRole, string>>> } {
    const names: Partial<Record<MemberRole, string>> = {};
    const characters: Partial<Record<MemberRole, string>> = {};
    for (const role of MEMBER_ROLES) {
      const s = this.of(role);
      if (s.name !== undefined) names[role] = s.name;
      if (s.character !== undefined) characters[role] = s.character;
    }
    return { names, characters };
  }
}
