import { DomainError } from '../../../shared/domain-error.js';
import { MEMBER_ROLES, ROLE_INFO, type MemberRole } from '../../domain/member-role.js';
import type { ModelTier } from '../../domain/team.js';

export type { MemberRole };

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RoleSetting {
  readonly tier: ModelTier;
  readonly effort: Effort;
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
  readonly tools: readonly string[];
  /** 프로젝트 설정(CLAUDE.md 등)을 읽는지. 입력 종류만 가르는 라우터는 읽지 않아 빨리 끝난다. */
  readonly readsProject: boolean;
  /** 사용자가 이 팀원에게 더한 지시(팀 설정). 시스템 프롬프트 끝에 붙는다. */
  readonly extraInstruction?: string;
}

/** 팀 설정에서 쓸 수 있는 도구 */
export const ROLE_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Edit', 'Write', 'Bash'];

/** 끌 수 없는 팀원: 접수·라우터·답변·테스트·구현·리뷰·저장소 파악·부서장은 작업 흐름이 늘 부른다. */
export const REQUIRED_ROLES: readonly MemberRole[] = ['intake', 'router', 'answerer', 'tester', 'implementer', 'reviewer', 'surveyor', 'chief'];

/** 사용자가 팀원 하나에 바꾼 것(안 바꾼 칸은 없다 = 기본값 그대로) */
export interface RoleOverride {
  readonly enabled?: boolean;
  readonly tier?: ModelTier;
  readonly effort?: Effort;
  readonly tools?: readonly string[];
  readonly extraInstruction?: string;
}

export type RoleOverrides = Readonly<Partial<Record<MemberRole, RoleOverride>>>;

const EXTRA_LIMIT = 2000;

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
const WRITE_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'Bash'];
const TIERS: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** 상태 머신이 sonnet으로 올렸을 때 쓰는 설정. 표에 없는 조합은 역할 기본값에서 모델만 바꾼다. */
const ESCALATED: Readonly<Partial<Record<MemberRole, Partial<Record<ModelTier, Partial<RoleSetting>>>>>> = {
  tester: { sonnet: { maxBudgetUsd: 1 } },
  implementer: { sonnet: { maxBudgetUsd: 2 } },
};

/**
 * 역할별 모델·effort·상한. 모델은 보통 상태 머신이 배정하고(forAssignment), 실험대에서 바꿔 보기 쉽도록
 * `RAUHA_ROLE_<ROLE>=<tier>[:<effort>]` 환경 변수로 그 역할의 모델을 고정할 수 있다.
 */
export class RoleSettingsDto {
  private constructor(
    private readonly settings: Readonly<Record<MemberRole, RoleSetting>>,
    /** 환경 변수로 모델을 고정한 역할. 배정 모델을 무시한다. */
    private readonly pinned: ReadonlySet<MemberRole> = new Set(),
    /** 팀 설정에서 끈 역할. 부르면 DomainError. */
    private readonly disabled: ReadonlySet<MemberRole> = new Set(),
  ) {}

  static defaults(): RoleSettingsDto {
    return new RoleSettingsDto({
      intake: { tier: 'sonnet', effort: 'low', maxTurns: 30, maxBudgetUsd: 0.5, tools: READ_TOOLS, readsProject: true },
      tester: { tier: 'haiku', effort: 'medium', maxTurns: 60, maxBudgetUsd: 0.5, tools: WRITE_TOOLS, readsProject: true },
      implementer: { tier: 'haiku', effort: 'medium', maxTurns: 80, maxBudgetUsd: 1, tools: WRITE_TOOLS, readsProject: true },
      // 리뷰어는 읽기만 한다. 같은 모델은 같은 실수를 놓치기 쉬워서 구현보다 한 단계 위(sonnet).
      reviewer: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      // 라우터는 입력 종류만 가른다. 도구도 프로젝트 설정도 없이 짧게.
      router: { tier: 'haiku', effort: 'low', maxTurns: 4, maxBudgetUsd: 0.05, tools: [], readsProject: false },
      // 질문에는 코드나 공식 문서를 읽고 답하되 파일은 쓰지 않는다. 일반 기술 질문은 문서 여러 장을 열어 봐야 해서 턴·예산을 넉넉히.
      // "테스트 돌려봐", "git log 보여줘"처럼 명령 결과를 묻는 말은 사용자에게 시키지 않고 직접 돌려 답한다(위험한 명령은 ToolRisk가 묻는다).
      answerer: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 저장소 지식의 영역 메모를 쓴다. 이 저장소 파일만 보면 되니 웹 없이 가장 싼 모델로.
      surveyor: { tier: 'haiku', effort: 'low', maxTurns: 40, maxBudgetUsd: 0.5, tools: ['Read', 'Grep', 'Glob'], readsProject: true },
      // 코드가 아닌 결과물(포트폴리오·보고서·정리 문서)을 만든다. git 기록을 읽어야 해서 Bash, 문서만 쓰므로 Write·Edit은 .md로 막는다.
      writer: { tier: 'sonnet', effort: 'medium', maxTurns: 120, maxBudgetUsd: 3, tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'], readsProject: true },
      // 설계 대화: 사용자와 여러 번 주고받으며 설계안을 쓴다. 코드와 문서는 읽기만 한다.
      designer: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1.5, tools: READ_TOOLS, readsProject: true },
      // 운영 요청(aws 같은 CLI로 조회·변경하고 결과를 알린다). 파일은 쓰지 않고 명령만 실행한다. 위험한 명령은 도구 검사가 사용자에게 묻는다.
      operator: { tier: 'sonnet', effort: 'medium', maxTurns: 60, maxBudgetUsd: 1.5, tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch'], readsProject: true },
      // 증상을 받아 원인을 찾는다. 재현하려고 테스트를 돌릴 수 있지만 파일은 고치지 않고 보고만 한다(고치는 일은 사용자가 따로 시키면 작업 흐름으로 간다).
      debugger: { tier: 'sonnet', effort: 'medium', maxTurns: 80, maxBudgetUsd: 1.5, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 바꾸기 전에 영향받을 곳과 깨질 수 있는 곳을 짚는다. git 기록·diff를 읽을 수 있지만 파일은 고치지 않는다.
      riskchecker: { tier: 'sonnet', effort: 'medium', maxTurns: 60, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 사업·제품 아이디어와 앱·웹 구성, 알맞은 아키텍처·패턴을 제안한다. 비슷한 서비스를 찾아볼 수 있어야 해서 웹 도구를 쓰고, 파일은 쓰지 않는다. 참신함이 중요해 노력 수준을 높인다.
      // 여러 저장소 요청을 저장소별 일과 그 사이의 약속으로 나누고, 끝난 뒤 약속이 양쪽 코드에서 맞는지 본다. 모든 저장소를 읽어야 해서 턴을 넉넉히.
      splitter: { tier: 'sonnet', effort: 'high', maxTurns: 80, maxBudgetUsd: 1.5, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      planner: { tier: 'sonnet', effort: 'high', maxTurns: 60, maxBudgetUsd: 1.5, tools: READ_TOOLS, readsProject: true },
      // 부서장: 7년차 이상의 판단으로 부서 일을 나누고(계획) 팀원의 보고를 하나로 모은다(종합). 호출 수가 적어 가장 높은 모델을 쓴다. 파일은 쓰지 않는다.
      chief: { tier: 'opus', effort: 'medium', maxTurns: 40, maxBudgetUsd: 2, tools: READ_TOOLS, readsProject: true },
      bm: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      marketer: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      growth: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      uxdesigner: { tier: 'sonnet', effort: 'medium', maxTurns: 50, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      brand: { tier: 'sonnet', effort: 'medium', maxTurns: 40, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      // 의존성 점검 같은 읽기 명령을 돌릴 수 있다. 파일은 고치지 않는다.
      securitychecker: { tier: 'sonnet', effort: 'medium', maxTurns: 60, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 릴리스 노트를 쓰려고 git 기록을 읽는다.
      releaser: { tier: 'sonnet', effort: 'low', maxTurns: 50, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
    });
  }

  withEnv(env: Readonly<Record<string, string | undefined>>): RoleSettingsDto {
    const next = { ...this.settings };
    const pinned = new Set(this.pinned);
    for (const role of MEMBER_ROLES) {
      const key = `RAUHA_ROLE_${role.toUpperCase()}`;
      const value = env[key];
      if (value === undefined || value.trim() === '') continue;
      const [tier, effort] = value.trim().split(':');
      if (!TIERS.includes(tier as ModelTier) || (effort !== undefined && !EFFORTS.includes(effort as Effort))) {
        throw new DomainError('INVALID_INPUT', `${key}: <${TIERS.join('|')}>[:<${EFFORTS.join('|')}>] 형식이어야 합니다.`);
      }
      next[role] = { ...next[role], tier: tier as ModelTier, ...(effort !== undefined ? { effort: effort as Effort } : {}) };
      pinned.add(role);
    }
    return new RoleSettingsDto(next, pinned, this.disabled);
  }

  /**
   * 팀 설정(사용자가 바꾼 것)을 얹는다. 규칙은 여기서 지킨다: 필수 팀원은 끌 수 없고, 도구는 아는 도구만, 모델 등급은 고르면 상태 머신의
   * 승격 배정보다 앞선다(고른 등급 그대로). 안 바꾼 칸은 기본값 그대로라 설정이 비어 있으면 동작이 달라지지 않는다.
   */
  withOverrides(overrides: RoleOverrides): RoleSettingsDto {
    const next = { ...this.settings };
    const pinned = new Set(this.pinned);
    const disabled = new Set(this.disabled);
    for (const role of MEMBER_ROLES) {
      const o = overrides[role];
      if (o === undefined) continue;
      if (o.enabled === false) {
        if (REQUIRED_ROLES.includes(role)) throw new DomainError('ROLE_REQUIRED', `${ROLE_INFO[role].name}은(는) 작업 흐름에 꼭 필요해서 끌 수 없습니다.`);
        disabled.add(role);
      }
      const unknown = o.tools?.find((t) => !ROLE_TOOLS.includes(t));
      if (unknown !== undefined) throw new DomainError('INVALID_INPUT', `${ROLE_INFO[role].name}: 알 수 없는 도구 ${unknown}`);
      const extra = o.extraInstruction?.trim() ?? '';
      if (extra.length > EXTRA_LIMIT) throw new DomainError('INVALID_INPUT', `${ROLE_INFO[role].name}: 추가 지시는 ${EXTRA_LIMIT}자까지입니다.`);
      next[role] = {
        ...next[role],
        ...(o.tier !== undefined ? { tier: o.tier } : {}),
        ...(o.effort !== undefined ? { effort: o.effort } : {}),
        ...(o.tools !== undefined ? { tools: [...o.tools] } : {}),
        ...(extra !== '' ? { extraInstruction: extra } : {}),
      };
      if (o.tier !== undefined) pinned.add(role);
    }
    return new RoleSettingsDto(next, pinned, disabled);
  }

  isEnabled(role: MemberRole): boolean {
    return !this.disabled.has(role);
  }

  private of(role: MemberRole): RoleSetting {
    if (this.disabled.has(role)) throw new DomainError('ROLE_DISABLED', `${ROLE_INFO[role].name}은(는) 꺼 둔 팀원이에요. 설정의 팀 설정에서 켤 수 있어요.`);
    return this.settings[role];
  }

  /** 모든 역할의 설정. 화면에 팀 구성을 보여 줄 때 쓴다. */
  entries(): readonly ({ readonly role: MemberRole } & RoleSetting)[] {
    return MEMBER_ROLES.map((role) => ({ role, ...this.settings[role] }));
  }

  get(role: MemberRole): RoleSetting {
    return this.of(role);
  }

  /**
   * 가벼운 질문("1+1은 얼마야?", 인사)에 답하는 설정: 싼 모델, 낮은 effort, 적은 턴, 읽기 도구만(웹·명령 없음).
   * 환경 변수로 답변 팀원 모델을 고정했으면 그 모델을 따른다.
   */
  lightAnswerer(): RoleSetting {
    const base = this.settings.answerer;
    if (this.pinned.has('answerer')) return base;
    return { ...base, tier: 'haiku', effort: 'low', maxTurns: 12, maxBudgetUsd: 0.2, tools: ['Read', 'Grep', 'Glob'] };
  }

  /** 분석의 설계·계획 호출: 설계 팀원을 effort high로. 환경 변수로 고정한 역할은 고정한 그대로. */
  forBlueprint(tier: ModelTier): RoleSetting {
    const base = this.forAssignment('designer', tier);
    return this.pinned.has('designer') ? base : { ...base, effort: 'high' };
  }

  /** 상태 머신이 배정한 모델로 부를 때의 설정. 환경 변수로 고정한 역할은 고정 모델을 쓴다. */
  forAssignment(role: MemberRole, tier: ModelTier): RoleSetting {
    const base = this.of(role);
    if (this.pinned.has(role) || tier === base.tier) return base;
    return { ...base, tier, ...ESCALATED[role]?.[tier] };
  }
}
