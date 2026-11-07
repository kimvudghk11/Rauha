import { DomainError } from '../../../shared/domain-error.js';
import { Rule, RuleBook, type RuleBucket, type RuleScope } from '../../domain/rule-book.js';

interface RuleJson {
  readonly id: string;
  readonly text: string;
  readonly bucket: RuleBucket;
  readonly scope: RuleScope;
  readonly tools: readonly string[];
  readonly includes: readonly string[];
}

const BUCKETS: readonly string[] = ['always', 'allow', 'ask'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function scopeFrom(v: unknown): RuleScope {
  if (isObject(v) && v['kind'] === 'global') return { kind: 'global' };
  if (isObject(v) && (v['kind'] === 'workspace' || v['kind'] === 'folder') && typeof v['path'] === 'string' && v['path'].trim() !== '') return { kind: v['kind'], path: v['path'] };
  throw new DomainError('INVALID_RULE_SCOPE', '규칙 범위가 올바르지 않습니다.');
}

/** 규칙 파일(JSON)과 화면 입력 ↔ RuleBook. 바깥 입력 검증·변환은 여기서 하고 규칙은 엔티티가 지킨다. */
export class RuleBookDto {
  private constructor(readonly rules: readonly RuleJson[]) {}

  /** 모양이 틀린 입력은 DomainError. 파일이 없거나 비어 있는 것(빈 규칙)은 호출하는 쪽이 empty()를 쓴다. */
  static from(input: unknown): RuleBookDto {
    const list = isObject(input) ? input['rules'] : input;
    if (!Array.isArray(list)) throw new DomainError('INVALID_RULES', '규칙 목록이 올바르지 않습니다.');
    const rules = list.map((item): RuleJson => {
      if (!isObject(item)) throw new DomainError('INVALID_RULES', '규칙 하나의 모양이 올바르지 않습니다.');
      const bucket = item['bucket'];
      if (typeof item['id'] !== 'string' || typeof item['text'] !== 'string' || typeof bucket !== 'string' || !BUCKETS.includes(bucket)) {
        throw new DomainError('INVALID_RULES', '규칙에는 id·글·칸이 있어야 합니다.');
      }
      return { id: item['id'], text: item['text'], bucket: bucket as RuleBucket, scope: scopeFrom(item['scope']), tools: strings(item['tools']), includes: strings(item['includes']) };
    });
    return new RuleBookDto(rules);
  }

  static empty(): RuleBookDto {
    return new RuleBookDto([]);
  }

  static fromEntity(book: RuleBook): RuleBookDto {
    return new RuleBookDto(book.rules.map((r) => ({ id: r.id, text: r.text, bucket: r.bucket, scope: r.scope, tools: r.match.tools, includes: r.match.includes })));
  }

  toEntity(): RuleBook {
    return RuleBook.of(this.rules.map((r) => Rule.create({ id: r.id, text: r.text, bucket: r.bucket, scope: r.scope, match: { tools: r.tools, includes: r.includes } })));
  }

  toJSON(): { rules: readonly RuleJson[] } {
    return { rules: this.rules };
  }
}
