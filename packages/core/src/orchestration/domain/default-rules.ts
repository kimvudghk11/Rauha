import { DomainError } from '../../shared/domain-error.js';
import { Rule, type RuleBucket } from './rule-book.js';

/**
 * 규칙 탭에 처음부터 들어 있는 "기본 규칙". rauha를 만들며 정한 일하는 방식을 규칙으로 옮겼다.
 * 기본 규칙은 코드에 있고, 저장 파일에는 사용자가 끈 것과 고친 것만 남는다(기본값 복원은 그 기록을 지우면 된다).
 *
 * 기본 위험 판정(ToolRisk)과 비밀 파일 차단(SecretPolicy)은 규칙보다 앞서 늘 지켜진다. 그래서 기본 규칙은 그것과 같은 방향이다:
 * - "묻지 않고 할 것"은 ToolRisk가 이미 허용하는 명령만 담는다(ToolRisk가 묻는 명령을 풀어 주지 않는다).
 * - "꼭 허락받을 것"은 ToolRisk가 묻거나 거절하는 명령을 더 분명히 적은 것이다.
 */

/** 규칙이 맞는 한 경우: 도구와, 명령·경로에 모두 들어 있어야 하는 글들 */
export interface DefaultVariant {
  readonly tools: readonly string[];
  readonly includes: readonly string[];
}

export interface DefaultRuleProps {
  readonly id: string;
  readonly text: string;
  readonly bucket: RuleBucket;
  /** "항상 지킬 것"은 비어 있다. 그 밖에는 경우마다 하나씩(경우끼리는 "또는") */
  readonly variants: readonly DefaultVariant[];
  /** 이 규칙을 꺼도 늘 지켜지는 것이 있으면 그 설명(화면에 작게 보인다) */
  readonly note?: string;
}

const BASH = ['Bash'];
const bash = (...includes: string[]): DefaultVariant => ({ tools: BASH, includes });

/** 보호 브랜치. 설정의 보호 브랜치 기본값(main·qa·release)과 같다. */
const PROTECTED = ['main', 'qa', 'release'];

/** 순서는 규칙 탭에서 칸마다 보이는 순서다. */
export const DEFAULT_RULES: readonly DefaultRuleProps[] = [
  // ── 항상 지킬 것 ──
  {
    id: 'default:secrets', bucket: 'always', variants: [],
    text: '비밀 파일(.env, *.pem, *.key, 자격 증명 파일 등)은 읽지도 쓰지도 않는다. 값이 필요하면 사용자에게 어디에 두었는지 묻는다.',
    note: '이 글을 꺼도 비밀 파일 차단은 늘 켜져 있어요(규칙보다 먼저 막아요).',
  },
  { id: 'default:no-dollar', bucket: 'always', variants: [], text: '화면에 보이는 글에 달러(금액)를 쓰지 않는다. 비용은 "늘어남·줄어듦·같음"으로만 말한다.' },
  { id: 'default:unknown', bucket: 'always', variants: [], text: '확인하지 못한 값은 추정해서 지어내지 않고 "모름"이라고 쓴다.' },
  { id: 'default:aws-profile', bucket: 'always', variants: [], text: 'aws 점검은 aws configure로 설정된 프로필로 바로 실행한다. 계정·리전을 매번 사용자에게 되묻지 않는다. 키 입력(aws configure 대화형)은 하지 않는다.' },

  // ── 묻지 않고 할 것(ToolRisk가 이미 허용하는 명령만) ──
  {
    id: 'default:allow-git', bucket: 'allow', text: '기본 git 읽기·준비(status, diff, log, show, blame, add, fetch)는 묻지 않는다.',
    variants: ['git status', 'git diff', 'git log', 'git show', 'git blame', 'git add', 'git fetch'].map((c) => bash(c)),
    note: 'commit·push·PR은 요청에서 시켰을 때만 묻지 않고 해요. 시키지 않았으면 허락 카드로 물어요.',
  },
  {
    id: 'default:allow-aws-read', bucket: 'allow', text: 'aws 조회(describe-·list-·get-)와 aws configure list는 설정된 프로필로 바로 실행한다.',
    variants: [bash('aws', 'describe-'), bash('aws', 'list-'), bash('aws', 'get-'), bash('aws', 'configure', 'list')],
  },
  {
    id: 'default:allow-checks', bucket: 'allow', text: '테스트·타입 검사·빌드·린트 같은 일반 검사 명령은 묻지 않는다.',
    variants: ['yarn test', 'yarn typecheck', 'yarn build', 'yarn lint', 'npm test', 'npm run test', 'npm run build', 'npm run lint', 'pnpm test', 'npx vitest', 'npx tsc'].map((c) => bash(c)),
  },
  {
    id: 'default:allow-claude', bucket: 'allow', text: '브라우저 연동 도구와 claude 연동 확인(auth status·mcp list·--version)은 묻지 않는다.',
    variants: [{ tools: [], includes: ['mcp__playwright__'] }, bash('claude', 'auth', 'status'), bash('claude', 'mcp', 'list'), bash('claude', '--version')],
  },

  // ── 꼭 허락받을 것 ──
  {
    id: 'default:ask-protected', bucket: 'ask', text: 'main·qa·release 보호 브랜치에 push하거나 merge하는 일은 꼭 허락받는다.',
    variants: PROTECTED.flatMap((b) => [bash('git push', b), bash('git merge', b)]),
    note: 'push를 시켰어도 이 브랜치들은 허락 카드로 한 번 더 물어요. 강제 push는 어느 브랜치든 늘 물어요.',
  },
  {
    id: 'default:ask-infra', bucket: 'ask', text: '운영 인프라를 바꾸거나 지우는 일, 비용이 느는 일(terraform apply·destroy, cdk deploy·destroy, kubectl apply·delete, aws 삭제·종료·생성·변경)은 꼭 허락받는다.',
    variants: [
      bash('terraform apply'), bash('terraform destroy'), bash('tofu apply'), bash('tofu destroy'), bash('cdk deploy'), bash('cdk destroy'),
      bash('kubectl apply'), bash('kubectl delete'), bash('aws s3 rm'),
      ...['delete-', 'terminate-', 'run-instances', 'create-', 'put-', 'update-', 'modify-', 'attach-', 'detach-'].map((v) => bash('aws', v)),
    ],
  },
];

/** 사용자가 고친 기본 규칙 하나(글과 경우들) */
export interface DefaultEdit {
  readonly text: string;
  readonly variants: readonly DefaultVariant[];
}

export interface DefaultRuleEntry {
  /** 지금 효력이 있는 모양(고쳤으면 고친 것) */
  readonly rule: DefaultRuleProps;
  readonly enabled: boolean;
  readonly edited: boolean;
}

const byId = (id: string): DefaultRuleProps => {
  const found = DEFAULT_RULES.find((r) => r.id === id);
  if (found === undefined) throw new DomainError('UNKNOWN_DEFAULT_RULE', '없는 기본 규칙입니다.');
  return found;
};

/** 기본 규칙의 현재 상태: 어떤 것을 껐고 어떤 것을 고쳤는지. 값은 불변이다. */
export class DefaultRuleSet {
  private constructor(private readonly disabled: ReadonlySet<string>, private readonly edits: ReadonlyMap<string, DefaultEdit>) {}

  static initial(): DefaultRuleSet {
    return new DefaultRuleSet(new Set(), new Map());
  }

  /** 저장해 둔 것에서 복원한다. 모르는 id는 버리고, 맞지 않는 고침은 버려 기본으로 돌린다. */
  static restore(disabled: Iterable<string>, edits: ReadonlyMap<string, DefaultEdit>): DefaultRuleSet {
    const known = new Set(DEFAULT_RULES.map((r) => r.id));
    const ok = new Map<string, DefaultEdit>();
    for (const [id, edit] of edits) {
      if (!known.has(id)) continue;
      try {
        ok.set(id, validated(byId(id), edit));
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
    }
    return new DefaultRuleSet(new Set([...disabled].filter((id) => known.has(id))), ok);
  }

  get disabledIds(): readonly string[] {
    return [...this.disabled];
  }
  get editedEntries(): ReadonlyMap<string, DefaultEdit> {
    return this.edits;
  }

  entries(): readonly DefaultRuleEntry[] {
    return DEFAULT_RULES.map((original) => {
      const edit = this.edits.get(original.id);
      return { rule: edit === undefined ? original : { ...original, text: edit.text, variants: edit.variants }, enabled: !this.disabled.has(original.id), edited: edit !== undefined };
    });
  }

  setEnabled(id: string, enabled: boolean): DefaultRuleSet {
    byId(id);
    const next = new Set(this.disabled);
    if (enabled) next.delete(id);
    else next.add(id);
    return new DefaultRuleSet(next, this.edits);
  }

  /** 글과 경우를 고친다. 검증은 규칙 엔티티와 같은 기준(찾을 글이 있어야 한다)이다. */
  edit(id: string, edit: DefaultEdit): DefaultRuleSet {
    const next = new Map(this.edits);
    next.set(id, validated(byId(id), edit));
    return new DefaultRuleSet(this.disabled, next);
  }

  /** 기본 규칙 하나를 처음 모양(켬, 고치지 않음)으로 되돌린다 */
  restoreOne(id: string): DefaultRuleSet {
    byId(id);
    const disabled = new Set(this.disabled);
    disabled.delete(id);
    const edits = new Map(this.edits);
    edits.delete(id);
    return new DefaultRuleSet(disabled, edits);
  }

  restoreAll(): DefaultRuleSet {
    return DefaultRuleSet.initial();
  }

  /** 엔진이 쓸 규칙들: 켜 둔 기본 규칙 → 경우마다 규칙 하나(범위는 전체). 팀원 프롬프트와 도구 검사가 이것을 읽는다. */
  toRules(): readonly Rule[] {
    return this.entries()
      .filter((e) => e.enabled)
      .flatMap(({ rule }) =>
        rule.bucket === 'always'
          ? [Rule.create({ id: rule.id, text: rule.text, bucket: 'always', scope: { kind: 'global' }, match: { tools: [], includes: [] } })]
          : rule.variants.map((v, i) => Rule.create({ id: `${rule.id}#${i}`, text: rule.text, bucket: rule.bucket, scope: { kind: 'global' }, match: v })),
      );
  }
}

function validated(original: DefaultRuleProps, edit: DefaultEdit): DefaultEdit {
  const text = edit.text.trim();
  if (text === '') throw new DomainError('EMPTY_RULE', '규칙 글이 비어 있습니다.');
  if (original.bucket === 'always') return { text, variants: [] };
  const variants = edit.variants.map((v) => ({ tools: [...v.tools], includes: v.includes.map((s) => s.trim()).filter((s) => s !== '') })).filter((v) => v.includes.length > 0);
  if (variants.length === 0) throw new DomainError('RULE_NEEDS_MATCH', '묻지 않을 것·허락받을 것 규칙에는 명령이나 경로에서 찾을 글이 하나는 있어야 합니다.');
  return { text, variants };
}
