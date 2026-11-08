import { DEFAULT_RULES, DefaultRuleSet, type DefaultEdit, type DefaultVariant } from '../../domain/default-rules.js';
import type { RuleBucket } from '../../domain/rule-book.js';

interface EditJson {
  readonly id: string;
  readonly text: string;
  readonly variants: readonly DefaultVariant[];
}

/** 저장 파일 모양: 끈 기본 규칙과 고친 기본 규칙만 담는다(기본 본문은 코드에 있다). */
export interface DefaultRulesJson {
  readonly disabled: readonly string[];
  readonly edits: readonly EditJson[];
}

/** 화면에 보내는 기본 규칙 한 줄 */
export interface DefaultRuleView {
  readonly id: string;
  readonly text: string;
  readonly bucket: RuleBucket;
  readonly variants: readonly DefaultVariant[];
  readonly enabled: boolean;
  readonly edited: boolean;
  readonly note: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 기본 규칙 상태 ↔ 저장 파일·화면. 깨진 항목은 건너뛰어 기본 규칙으로 연다(파일 하나 때문에 규칙이 다 사라지지 않게). */
export class DefaultRulesDto {
  private constructor(readonly json: DefaultRulesJson) {}

  static from(input: unknown): DefaultRulesDto {
    const o = isObject(input) ? input : {};
    const edits: EditJson[] = [];
    for (const item of Array.isArray(o['edits']) ? o['edits'] : []) {
      if (!isObject(item) || typeof item['id'] !== 'string' || typeof item['text'] !== 'string') continue;
      const variants = (Array.isArray(item['variants']) ? item['variants'] : []).filter(isObject).map((v) => ({ tools: strings(v['tools']), includes: strings(v['includes']) }));
      edits.push({ id: item['id'], text: item['text'], variants });
    }
    return new DefaultRulesDto({ disabled: strings(o['disabled']), edits });
  }

  static fromEntity(set: DefaultRuleSet): DefaultRulesDto {
    return new DefaultRulesDto({ disabled: set.disabledIds, edits: [...set.editedEntries].map(([id, e]) => ({ id, text: e.text, variants: e.variants })) });
  }

  toEntity(): DefaultRuleSet {
    return DefaultRuleSet.restore(this.json.disabled, new Map<string, DefaultEdit>(this.json.edits.map((e) => [e.id, { text: e.text, variants: e.variants }])));
  }

  toJSON(): DefaultRulesJson {
    return this.json;
  }

  /** 화면용 목록 */
  static view(set: DefaultRuleSet): readonly DefaultRuleView[] {
    return set.entries().map((e) => ({ id: e.rule.id, text: e.rule.text, bucket: e.rule.bucket, variants: e.rule.variants, enabled: e.enabled, edited: e.edited, note: DEFAULT_RULES.find((r) => r.id === e.rule.id)?.note ?? null }));
  }
}
