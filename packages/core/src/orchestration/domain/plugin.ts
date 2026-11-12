import { DomainError } from '../../shared/domain-error.js';
import type { MemberRole } from './member-role.js';

/**
 * 플러그인·스킬: Claude Code 가 계정 설정 폴더(CLAUDE_CONFIG_DIR)에 설치·관리한다. rauha 는 Claude Code 명령을 대신 눌러 주고,
 * 팀원을 띄울 때 켜 둔 플러그인과 사용자 스킬을 붙인다.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** 플러그인 하나: 이름@마켓플레이스. Claude Code 명령에 그대로 넘기므로 옵션처럼 보이는 글자를 받지 않는다. */
export class PluginId {
  private constructor(
    readonly name: string,
    readonly marketplace: string,
  ) {}

  static of(raw: string): PluginId {
    const [name, marketplace, ...rest] = raw.trim().split('@');
    if (rest.length > 0 || name === undefined || marketplace === undefined || !NAME.test(name) || !NAME.test(marketplace)) throw new DomainError('INVALID_PLUGIN', `플러그인 이름이 올바르지 않습니다: ${raw.slice(0, 80)}`);
    return new PluginId(name, marketplace);
  }

  get value(): string {
    return `${this.name}@${this.marketplace}`;
  }

  equals(other: PluginId): boolean {
    return this.value === other.value;
  }
}

/** 마켓플레이스 출처: GitHub owner/repo 또는 https 주소. 로컬 경로·다른 방식은 받지 않는다. */
export class MarketplaceSource {
  private constructor(readonly value: string) {}

  static of(raw: string): MarketplaceSource {
    const text = raw.trim();
    if (GITHUB_REPO.test(text)) return new MarketplaceSource(text);
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new DomainError('INVALID_MARKETPLACE', 'GitHub owner/repo 나 https 주소를 넣어 주세요.');
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || text.startsWith('-')) throw new DomainError('INVALID_MARKETPLACE', 'GitHub owner/repo 나 https 주소를 넣어 주세요.');
    return new MarketplaceSource(url.href);
  }
}

/** 마켓플레이스 이름(지우기에 쓴다) */
export class MarketplaceName {
  private constructor(readonly value: string) {}

  static of(raw: string): MarketplaceName {
    if (!NAME.test(raw.trim())) throw new DomainError('INVALID_MARKETPLACE', `마켓플레이스 이름이 올바르지 않습니다: ${raw.slice(0, 80)}`);
    return new MarketplaceName(raw.trim());
  }
}

/** 사용자 스킬 폴더 이름(<설정 폴더>/skills/<이름>). 경로를 벗어나지 않게 폴더 이름만 받는다. */
export class SkillName {
  private constructor(readonly value: string) {}

  static of(raw: string): SkillName {
    if (!NAME.test(raw) || raw.startsWith('.')) throw new DomainError('INVALID_SKILL', `스킬 이름이 올바르지 않습니다: ${raw.slice(0, 80)}`);
    return new SkillName(raw);
  }
}

interface PickSpec {
  readonly id: string;
  /** 따로 더해야 하는 마켓플레이스. Anthropic 공식 디렉터리(anthropic-plugin-directory)는 Claude Code 에 이미 있어 null */
  readonly marketplace: string | null;
  readonly label: string;
  /** 업무에서 무엇을 해 주는지 한 줄(플러그인 설명에서 확인한 것만) */
  readonly summary: string;
  /** 채팅에 바로 쓸 수 있는 예시 요청(한국어, 1~2개) */
  readonly examples: readonly string[];
  /** 설치 전에 알아야 할 것(없으면 null) */
  readonly note: string | null;
}

/**
 * 추천 플러그인. 짧게 엄선한다: obra 의 superpowers, 사용자가 이름을 댄 ponytail(DietrichGebert/ponytail, MIT),
 * 그리고 Anthropic 이 만든 공식 플러그인 몇 개(anthropics/claude-plugins-official). 나머지는 Claude Code 처럼 목록에서 찾아 설치한다.
 */
const PICKS: readonly PickSpec[] = [
  {
    id: 'superpowers@anthropic-plugin-directory',
    marketplace: null,
    label: 'Superpowers',
    summary: 'Skills for disciplined development: brainstorm a design first, write a plan, test-driven development, systematic debugging, and verify before calling work done.',
    examples: ['로그인 기능 만들기 전에 설계부터 같이 잡아줘', '이 테스트가 왜 깨지는지 체계적으로 디버깅해줘'],
    note: null,
  },
  {
    id: 'ponytail@ponytail',
    marketplace: 'DietrichGebert/ponytail',
    label: 'Ponytail',
    summary: 'Pushes teammates toward the least new code that works: standard library first, no speculative abstractions, and it names the work it skipped.',
    examples: ['이 기능 최소한의 코드로 만들어줘', '이 모듈에서 줄일 수 있는 코드 찾아줘'],
    note: 'Adds hooks that run with Node.js every session, so node must be installed.',
  },
  {
    id: 'feature-dev@anthropic-plugin-directory',
    marketplace: null,
    label: 'Feature development (Anthropic)',
    summary: 'A step-by-step feature workflow with agents that explore the codebase, design the architecture and review the result.',
    examples: ['결제 취소 기능을 코드베이스 파악부터 단계별로 만들어줘'],
    note: null,
  },
  {
    id: 'pr-review-toolkit@anthropic-plugin-directory',
    marketplace: null,
    label: 'PR review toolkit (Anthropic)',
    summary: 'Review agents that check comments, tests, error handling, type design and overall code quality.',
    examples: ['지금 바뀐 코드를 에러 처리·테스트 관점에서 리뷰해줘'],
    note: null,
  },
  {
    id: 'frontend-design@anthropic-plugin-directory',
    marketplace: null,
    label: 'Frontend design (Anthropic)',
    summary: 'A skill for building distinctive, production-grade web screens instead of generic-looking UI.',
    examples: ['이 랜딩 페이지 디자인 완성도 있게 다듬어줘'],
    note: null,
  },
  {
    id: 'skill-creator@anthropic-plugin-directory',
    marketplace: null,
    label: 'Skill creator (Anthropic)',
    summary: 'Create your own skills, improve existing ones and measure how well they work.',
    examples: ['우리 팀 배포 절차를 스킬로 만들어줘'],
    note: null,
  },
];

export class PluginPick {
  private constructor(
    readonly id: PluginId,
    readonly marketplace: MarketplaceSource | null,
    private readonly spec: PickSpec,
  ) {}

  static all(): PluginPick[] {
    return PICKS.map((p) => new PluginPick(PluginId.of(p.id), p.marketplace === null ? null : MarketplaceSource.of(p.marketplace), p));
  }

  get label(): string {
    return this.spec.label;
  }
  get summary(): string {
    return this.spec.summary;
  }
  get examples(): readonly string[] {
    return this.spec.examples;
  }
  get note(): string | null {
    return this.spec.note;
  }
}

/**
 * 설치한 플러그인·사용자 스킬을 붙이는 팀원. 플러그인은 세션 시작 훅·스킬 목록으로 호출마다 입력을 늘리므로,
 * 실제로 일하는 팀원에게만 붙이고 분류·접수·나누기 같은 짧은 판정 호출에는 붙이지 않는다(한도 절약).
 */
const PLUGIN_ROLES: ReadonlySet<MemberRole> = new Set(['answerer', 'implementer', 'tester', 'debugger', 'designer', 'planner', 'writer', 'reviewer', 'uxdesigner', 'operator', 'riskchecker', 'securitychecker']);

export class PluginReach {
  private constructor() {}

  static loads(role: MemberRole): boolean {
    return PLUGIN_ROLES.has(role);
  }
}
