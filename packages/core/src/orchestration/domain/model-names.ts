import { DomainError } from '../../shared/domain-error.js';
import { MODEL_ID, type ModelTier } from './team.js';

const TIERS: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];
const ID_MAX = 64;
/** claude- 로 시작하고 소문자·숫자·점·밑줄·하이픈만(공백·줄바꿈·한글 없음) */
const ID_SHAPE = /^claude-[a-z0-9][a-z0-9._-]*$/;

/** 설정 화면이 제안으로 보여 주는 알려진 모델 ID(최신 → 이전). 이 목록에 없는 ID도 직접 넣을 수 있다. */
const KNOWN_IDS: readonly string[] = [
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-haiku-5-5',
];

/** 등급(haiku·sonnet·opus)마다 실제로 부를 모델 ID. 같은 값이면 같은 것이고 불변이다. */
export class ModelNames {
  static readonly KNOWN: readonly string[] = KNOWN_IDS;
  static readonly TIERS: readonly ModelTier[] = TIERS;

  private constructor(private readonly ids: Readonly<Record<ModelTier, string>>) {}

  static defaults(): ModelNames {
    return new ModelNames({ ...MODEL_ID });
  }

  /** 쓸 수 없는 값이면 이유(영어 한 줄, 화면에 그대로 보인다), 괜찮으면 null. */
  static checkId(id: string): string | null {
    const text = id.trim();
    if (text === '') return 'Model ID is empty.';
    if (text.length > ID_MAX) return `Model ID is longer than ${ID_MAX} characters.`;
    if (!ID_SHAPE.test(text)) return 'Model ID must start with "claude-" and use only lowercase letters, digits, "." "_" "-".';
    return null;
  }

  idOf(tier: ModelTier): string {
    return this.ids[tier];
  }

  /** 한 등급만 바꾼 새 값. 이상한 ID는 DomainError(INVALID_MODEL_ID). */
  with(tier: ModelTier, id: string): ModelNames {
    const reason = ModelNames.checkId(id);
    if (reason !== null) throw new DomainError('INVALID_MODEL_ID', reason);
    return new ModelNames({ ...this.ids, [tier]: id.trim() });
  }

  isDefault(tier: ModelTier): boolean {
    return this.ids[tier] === MODEL_ID[tier];
  }

  equals(other: ModelNames): boolean {
    return TIERS.every((t) => this.ids[t] === other.ids[t]);
  }

  toRecord(): Record<ModelTier, string> {
    return { ...this.ids };
  }
}
