import { ModelNames } from '../../domain/model-names.js';
import type { ModelTier } from '../../domain/team.js';

/**
 * 설정에 저장된 등급별 모델 ID(바깥 입력). 이상한 값은 그 등급만 기본값으로 돌리고(깨진 설정으로 앱이 못 열리지 않게)
 * 어느 등급이 거부됐는지 `rejected` 로 알린다.
 */
export class ModelSettingsDto {
  private constructor(
    private readonly names: ModelNames,
    readonly rejected: readonly ModelTier[],
  ) {}

  static from(input: unknown): ModelSettingsDto {
    const raw = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    let names = ModelNames.defaults();
    const rejected: ModelTier[] = [];
    for (const tier of ModelNames.TIERS) {
      const value = raw[tier];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' || ModelNames.checkId(value) !== null) {
        rejected.push(tier);
        continue;
      }
      names = names.with(tier, value);
    }
    return new ModelSettingsDto(names, rejected);
  }

  static fromEntity(names: ModelNames): ModelSettingsDto {
    return new ModelSettingsDto(names, []);
  }

  toEntity(): ModelNames {
    return this.names;
  }

  toRecord(): Record<ModelTier, string> {
    return this.names.toRecord();
  }
}
