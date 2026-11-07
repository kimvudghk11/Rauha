import { DomainError } from '../../shared/domain-error.js';

/** 규칙 칸 셋: 항상 지킬 것(팀원 프롬프트에 들어간다) · 묻지 않고 할 것 · 꼭 허락받을 것 */
export type RuleBucket = 'always' | 'allow' | 'ask';

/** 규칙이 닿는 범위: 전체(사용자) · 이 작업 폴더 · 특정 레포·폴더 */
export type RuleScope = { readonly kind: 'global' } | { readonly kind: 'workspace'; readonly path: string } | { readonly kind: 'folder'; readonly path: string };

/** 도구 호출에 맞는지 보는 조건. 비어 있으면 어느 호출에도 맞지 않는다("항상 지킬 것"은 글만 있다). */
export interface RuleMatch {
  /** 맞을 도구 이름(Bash·Write …). 비면 모든 도구 */
  readonly tools: readonly string[];
  /** 명령·경로에 이 글이 모두 들어 있어야 맞는다(대소문자 무시) */
  readonly includes: readonly string[];
}

export interface RuleProps {
  readonly id: string;
  readonly text: string;
  readonly bucket: RuleBucket;
  readonly scope: RuleScope;
  readonly match: RuleMatch;
}

/** 판정: 규칙이 정했으면 allow·ask, 규칙에 안 맞으면 null(기본 위험 규칙에 맡긴다) */
export type RuleVerdict = 'allow' | 'ask';

const norm = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();

/** 규칙 하나. 값은 불변이다. */
export class Rule {
  private constructor(private readonly props: RuleProps) {}

  /** 글은 비울 수 없다. 묻지 않음·허락 규칙은 도구 호출과 맞춰 볼 조건(includes)이 하나는 있어야 판정할 수 있다. */
  static create(props: RuleProps): Rule {
    const text = props.text.trim();
    if (text === '') throw new DomainError('EMPTY_RULE', '규칙 글이 비어 있습니다.');
    const includes = props.match.includes.map((s) => s.trim()).filter((s) => s !== '');
    if (props.bucket !== 'always' && includes.length === 0) {
      throw new DomainError('RULE_NEEDS_MATCH', '묻지 않을 것·허락받을 것 규칙에는 명령이나 경로에서 찾을 글이 하나는 있어야 합니다.');
    }
    return new Rule({ ...props, text, match: { tools: [...props.match.tools], includes } });
  }

  get id(): string {
    return this.props.id;
  }
  get text(): string {
    return this.props.text;
  }
  get bucket(): RuleBucket {
    return this.props.bucket;
  }
  get scope(): RuleScope {
    return this.props.scope;
  }
  get match(): RuleMatch {
    return this.props.match;
  }

  /** 이 폴더에서 일할 때 이 규칙이 적용되는지: 전체는 늘, 작업 폴더·폴더는 그 폴더 안일 때 */
  appliesIn(folder: string): boolean {
    if (this.props.scope.kind === 'global') return true;
    const base = norm(this.props.scope.path);
    const here = norm(folder);
    return here === base || here.startsWith(`${base}/`);
  }

  /** 도구 호출이 이 규칙의 조건에 맞는지. detail은 명령이나 파일 경로다. */
  matches(tool: string, detail: string): boolean {
    const { tools, includes } = this.props.match;
    if (includes.length === 0) return false;
    if (tools.length > 0 && !tools.includes(tool)) return false;
    const hay = detail.toLowerCase();
    return includes.every((s) => hay.includes(s.toLowerCase()));
  }
}

/** 규칙 모음. 값은 불변이다(바꾸면 새 모음을 돌려준다). */
export class RuleBook {
  private constructor(readonly rules: readonly Rule[]) {}

  static empty(): RuleBook {
    return new RuleBook([]);
  }

  static of(rules: readonly Rule[]): RuleBook {
    return rules.reduce((book, rule) => book.add(rule), RuleBook.empty());
  }

  add(rule: Rule): RuleBook {
    if (this.rules.some((r) => r.id === rule.id)) throw new DomainError('DUPLICATE_RULE', `같은 id의 규칙이 이미 있습니다: ${rule.id}`);
    return new RuleBook([...this.rules, rule]);
  }

  remove(id: string): RuleBook {
    return new RuleBook(this.rules.filter((r) => r.id !== id));
  }

  /**
   * 이 폴더에서 이 도구 호출을 규칙이 어떻게 판정하는지. "꼭 허락받을 것"이 "묻지 않고 할 것"보다 앞선다(안전한 쪽).
   * 어느 규칙에도 안 맞으면 null.
   */
  verdictFor(tool: string, detail: string, folder: string): RuleVerdict | null {
    const hits = this.rules.filter((r) => r.bucket !== 'always' && r.appliesIn(folder) && r.matches(tool, detail));
    if (hits.some((r) => r.bucket === 'ask')) return 'ask';
    return hits.some((r) => r.bucket === 'allow') ? 'allow' : null;
  }

  /** 이 폴더에서 팀원 프롬프트에 넣을 "항상 지킬 것" 글들 */
  alwaysTexts(folder: string): string[] {
    return this.rules.filter((r) => r.bucket === 'always' && r.appliesIn(folder)).map((r) => r.text);
  }
}
