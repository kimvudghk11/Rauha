import { DomainError } from '../../../shared/domain-error.js';
import { MEMBER_ROLES, type MemberRole } from '../../domain/member-role.js';
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
}

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
  ) {}

  static defaults(): RoleSettingsDto {
    return new RoleSettingsDto({
      intake: { tier: 'sonnet', effort: 'low', maxTurns: 15, maxBudgetUsd: 0.5, tools: READ_TOOLS, readsProject: true },
      tester: { tier: 'haiku', effort: 'medium', maxTurns: 30, maxBudgetUsd: 0.5, tools: WRITE_TOOLS, readsProject: true },
      implementer: { tier: 'haiku', effort: 'medium', maxTurns: 40, maxBudgetUsd: 1, tools: WRITE_TOOLS, readsProject: true },
      // 리뷰어는 읽기만 한다. 같은 모델은 같은 실수를 놓치기 쉬워서 구현보다 한 단계 위(sonnet).
      reviewer: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      // 라우터는 입력 종류만 가른다. 도구도 프로젝트 설정도 없이 짧게.
      router: { tier: 'haiku', effort: 'low', maxTurns: 2, maxBudgetUsd: 0.05, tools: [], readsProject: false },
      // 질문에는 코드나 공식 문서를 읽고 답하되 파일은 쓰지 않는다. 일반 기술 질문은 문서 여러 장을 열어 봐야 해서 턴·예산을 넉넉히.
      answerer: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      // 저장소 지식의 영역 메모를 쓴다. 이 저장소 파일만 보면 되니 웹 없이 가장 싼 모델로.
      surveyor: { tier: 'haiku', effort: 'low', maxTurns: 20, maxBudgetUsd: 0.5, tools: ['Read', 'Grep', 'Glob'], readsProject: true },
      // 코드가 아닌 결과물(포트폴리오·보고서·정리 문서)을 만든다. git 기록을 읽어야 해서 Bash, 문서만 쓰므로 Write·Edit은 .md로 막는다.
      writer: { tier: 'sonnet', effort: 'medium', maxTurns: 60, maxBudgetUsd: 3, tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'], readsProject: true },
      // 설계 대화: 사용자와 여러 번 주고받으며 설계안을 쓴다. 코드와 문서는 읽기만 한다.
      designer: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1.5, tools: READ_TOOLS, readsProject: true },
      // 운영 요청(aws 같은 CLI로 조회·변경하고 결과를 알린다). 파일은 쓰지 않고 명령만 실행한다. 위험한 명령은 도구 검사가 사용자에게 묻는다.
      operator: { tier: 'sonnet', effort: 'medium', maxTurns: 30, maxBudgetUsd: 1.5, tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch'], readsProject: true },
      // 증상을 받아 원인을 찾는다. 재현하려고 테스트를 돌릴 수 있지만 파일은 고치지 않고 보고만 한다(고치는 일은 사용자가 따로 시키면 작업 흐름으로 간다).
      debugger: { tier: 'sonnet', effort: 'medium', maxTurns: 40, maxBudgetUsd: 1.5, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 바꾸기 전에 영향받을 곳과 깨질 수 있는 곳을 짚는다. git 기록·diff를 읽을 수 있지만 파일은 고치지 않는다.
      riskchecker: { tier: 'sonnet', effort: 'medium', maxTurns: 30, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 사업·제품 아이디어와 앱·웹 구성, 알맞은 아키텍처·패턴을 제안한다. 비슷한 서비스를 찾아볼 수 있어야 해서 웹 도구를 쓰고, 파일은 쓰지 않는다. 참신함이 중요해 노력 수준을 높인다.
      planner: { tier: 'sonnet', effort: 'high', maxTurns: 30, maxBudgetUsd: 1.5, tools: READ_TOOLS, readsProject: true },
      // 부서장: 7년차 이상의 판단으로 부서 일을 나누고(계획) 팀원의 보고를 하나로 모은다(종합). 호출 수가 적어 가장 높은 모델을 쓴다. 파일은 쓰지 않는다.
      chief: { tier: 'opus', effort: 'medium', maxTurns: 20, maxBudgetUsd: 2, tools: READ_TOOLS, readsProject: true },
      bm: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      marketer: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      growth: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      uxdesigner: { tier: 'sonnet', effort: 'medium', maxTurns: 25, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      brand: { tier: 'sonnet', effort: 'medium', maxTurns: 20, maxBudgetUsd: 1, tools: READ_TOOLS, readsProject: true },
      // 의존성 점검 같은 읽기 명령을 돌릴 수 있다. 파일은 고치지 않는다.
      securitychecker: { tier: 'sonnet', effort: 'medium', maxTurns: 30, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
      // 릴리스 노트를 쓰려고 git 기록을 읽는다.
      releaser: { tier: 'sonnet', effort: 'low', maxTurns: 25, maxBudgetUsd: 1, tools: [...READ_TOOLS, 'Bash'], readsProject: true },
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
    return new RoleSettingsDto(next, pinned);
  }

  /** 모든 역할의 설정. 화면에 팀 구성을 보여 줄 때 쓴다. */
  entries(): readonly ({ readonly role: MemberRole } & RoleSetting)[] {
    return MEMBER_ROLES.map((role) => ({ role, ...this.settings[role] }));
  }

  get(role: MemberRole): RoleSetting {
    return this.settings[role];
  }

  /** 상태 머신이 배정한 모델로 부를 때의 설정. 환경 변수로 고정한 역할은 고정 모델을 쓴다. */
  forAssignment(role: MemberRole, tier: ModelTier): RoleSetting {
    const base = this.settings[role];
    if (this.pinned.has(role) || tier === base.tier) return base;
    return { ...base, tier, ...ESCALATED[role]?.[tier] };
  }
}
