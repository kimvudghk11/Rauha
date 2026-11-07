import { DomainError } from '../../../shared/domain-error.js';
import type { RuleBucket } from '../../domain/rule-book.js';

/** 사용자가 말로 적은 규칙을 모델이 정리한 초안. 사용자가 확인하기 전에는 규칙이 되지 않는다. */
export interface RuleDraft {
  readonly text: string;
  readonly bucket: RuleBucket;
  /** global이면 path 없음, 아니면 사용자가 말한 폴더·레포 이름이나 경로 */
  readonly scope: 'global' | 'workspace' | 'folder';
  readonly path: string | null;
  readonly tools: readonly string[];
  readonly includes: readonly string[];
}

/** 모델에게 요구하는 출력 모양(JSON schema) */
export const RULE_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '규칙을 한 줄로 다듬은 글(한국어)' },
    bucket: { type: 'string', enum: ['always', 'allow', 'ask'], description: 'always=항상 지킬 것, allow=묻지 않고 할 것, ask=꼭 허락받을 것' },
    scope: { type: 'string', enum: ['global', 'workspace', 'folder'], description: '전체, 이 작업 폴더, 특정 레포·폴더' },
    path: { type: 'string', description: 'scope가 folder일 때 사용자가 말한 폴더·레포 이름이나 경로, 아니면 빈 글' },
    tools: { type: 'array', items: { type: 'string', enum: ['Bash', 'Write', 'Edit', 'Read'] } },
    includes: { type: 'array', items: { type: 'string' }, description: 'allow·ask일 때 명령이나 경로에 들어 있어야 하는 짧은 글들(예: git push, terraform apply)' },
  },
  required: ['text', 'bucket', 'scope', 'includes'],
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter((s) => s !== '') : []);

/** 모델 출력(바깥 입력) → 초안. 모양이 틀리거나 판정할 수 없는 규칙은 DomainError로 거절한다. */
export class RuleDraftDto {
  private constructor() {}

  static from(input: unknown): RuleDraft {
    if (!isObject(input)) throw new DomainError('INVALID_RULE_DRAFT', '규칙을 정리하지 못했어요.');
    const text = typeof input['text'] === 'string' ? input['text'].trim() : '';
    const bucket = input['bucket'];
    if (text === '') throw new DomainError('INVALID_RULE_DRAFT', '규칙 글을 정리하지 못했어요.');
    if (bucket !== 'always' && bucket !== 'allow' && bucket !== 'ask') throw new DomainError('INVALID_RULE_DRAFT', '어느 칸의 규칙인지 정하지 못했어요.');
    const scope = input['scope'] === 'workspace' || input['scope'] === 'folder' ? input['scope'] : 'global';
    const path = typeof input['path'] === 'string' && input['path'].trim() !== '' ? input['path'].trim() : null;
    const includes = bucket === 'always' ? [] : strs(input['includes']);
    if (bucket !== 'always' && includes.length === 0) throw new DomainError('INVALID_RULE_DRAFT', '명령이나 경로에서 찾을 글을 정하지 못했어요. "항상 지킬 것"으로 적거나 어떤 명령인지 더 알려 주세요.');
    // 폴더 범위인데 어느 폴더인지 모르면 전체 규칙이 되어 버리지 않게 거절한다(좁게 말한 규칙이 넓어지면 안 된다)
    if (scope === 'folder' && path === null) throw new DomainError('INVALID_RULE_DRAFT', '어느 폴더의 규칙인지 정하지 못했어요.');
    return { text, bucket, scope, path: scope === 'global' ? null : path, tools: bucket === 'always' ? [] : strs(input['tools']), includes };
  }
}
