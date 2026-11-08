import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RoleSettingsDto } from '@rauha/core';
import { MEMBER_ROLES, REQUIRED_ROLES, ROLE_INFO, type MemberRole } from '@rauha/core/jobs';
import type { TeamMemberInfo, TeamOp, TeamView } from '../shared/ipc.js';
import { TeamSettings, TeamSettingsError, type MemberDefaults } from '../shared/team-settings.js';

/** 코어의 역할 설정(기본값)에서 팀원 하나의 기본 모델·노력·도구 */
export function defaultsOf(role: MemberRole): MemberDefaults {
  const s = RoleSettingsDto.defaults().get(role);
  return { tier: s.tier, effort: s.effort, tools: s.tools };
}

/** 화면이 팀원 목록을 그릴 때 쓰는 정보(이름·단계·기본값·끌 수 있는지) */
export function memberInfos(): readonly TeamMemberInfo[] {
  return MEMBER_ROLES.map((role) => ({ role, title: ROLE_INFO[role].name, stage: ROLE_INFO[role].stage, required: REQUIRED_ROLES.includes(role), defaults: defaultsOf(role) }));
}

export const teamView = (settings: TeamSettings): TeamView => ({ settings: settings.toJSON(), members: memberInfos() });

/** 코어가 받아들이는 설정인지(안 받으면 DomainError) */
function acceptedByCore(settings: TeamSettings): boolean {
  try {
    RoleSettingsDto.defaults().withOverrides(settings.overrides());
    return true;
  } catch {
    return false;
  }
}

/** 화면에서 온 일(바깥 입력)을 팀 설정에 적용한다. 규칙에 어긋나면 이유를 돌려주고 바꾸지 않는다. 결과는 기본값과 같은 칸을 지운 모양이다. */
export function applyTeamOp(settings: TeamSettings, op: unknown): { readonly ok: true; readonly settings: TeamSettings; readonly view: TeamView } | { readonly ok: false; readonly error: string } {
  try {
    if (typeof op !== 'object' || op === null) return { ok: false, error: '알 수 없는 요청이에요.' };
    const o = op as TeamOp;
    const role = (o as { role?: unknown }).role;
    const known = (r: unknown): r is MemberRole => typeof r === 'string' && (MEMBER_ROLES as readonly string[]).includes(r);
    let next: TeamSettings;
    switch (o.kind) {
      case 'change':
        if (!known(role)) return { ok: false, error: '없는 팀원이에요.' };
        next = settings.change(role, typeof o.patch === 'object' && o.patch !== null ? o.patch : {});
        break;
      case 'reset':
        if (!known(role)) return { ok: false, error: '없는 팀원이에요.' };
        next = settings.reset(role);
        break;
      case 'resetAll':
        next = settings.resetAll();
        break;
      default:
        return { ok: false, error: '알 수 없는 요청이에요.' };
    }
    next = next.pruned(defaultsOf);
    if (!acceptedByCore(next)) return { ok: false, error: '이 설정은 엔진이 받아들이지 않아요.' };
    return { ok: true, settings: next, view: teamView(next) };
  } catch (error) {
    if (error instanceof TeamSettingsError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 팀 설정을 JSON 파일 하나에 둔다(이 PC에만). 없거나 깨졌거나 엔진이 못 받는 파일은 기본(바꾼 것 없음)으로 연다. */
export class TeamSettingsStore {
  constructor(private readonly file: string) {}

  async load(): Promise<TeamSettings> {
    try {
      const settings = TeamSettings.from(JSON.parse(await readFile(this.file, 'utf8'))).pruned(defaultsOf);
      return acceptedByCore(settings) ? settings : TeamSettings.initial();
    } catch {
      return TeamSettings.initial();
    }
  }

  async save(settings: TeamSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings.toJSON(), null, 2), 'utf8');
  }
}
