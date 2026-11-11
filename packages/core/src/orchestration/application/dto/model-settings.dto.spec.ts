import { describe, expect, it } from 'vitest';
import { ModelNames } from '../../domain/model-names.js';
import { ModelSettingsDto } from './model-settings.dto.js';

describe('ModelSettingsDto', () => {
  it('아무것도 없거나 객체가 아니면 기본값이다', () => {
    for (const input of [undefined, null, 'x', 3, [], {}]) {
      expect(ModelSettingsDto.from(input).toEntity().equals(ModelNames.defaults())).toBe(true);
    }
  });

  it('올바른 값은 그대로 받는다', () => {
    const dto = ModelSettingsDto.from({ opus: ' claude-fable-5-2 ', sonnet: 'claude-sonnet-5' });
    expect(dto.toRecord()).toEqual({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5', opus: 'claude-fable-5-2' });
    expect(dto.rejected).toEqual([]);
  });

  it('빈 값·공백·긴 값·claude- 로 시작하지 않는 값·문자열이 아닌 값은 그 등급만 기본값으로 돌린다', () => {
    const dto = ModelSettingsDto.from({ haiku: '', sonnet: 'gpt-5', opus: `claude-${'a'.repeat(100)}` });
    expect(dto.toEntity().equals(ModelNames.defaults())).toBe(true);
    expect(dto.rejected).toEqual(['haiku', 'sonnet', 'opus']);
    expect(ModelSettingsDto.from({ opus: 5 }).rejected).toEqual(['opus']);
    expect(ModelSettingsDto.from({ opus: 'claude opus' }).toRecord().opus).toBe('claude-opus-5-5');
  });

  it('없는 등급은 거부로 세지 않고 기본값이다', () => {
    expect(ModelSettingsDto.from({ opus: 'claude-opus-5' }).rejected).toEqual([]);
  });

  it('엔티티에서 만든 값을 다시 읽어도 같다', () => {
    const names = ModelNames.defaults().with('opus', 'claude-opus-5');
    expect(ModelSettingsDto.from(ModelSettingsDto.fromEntity(names).toRecord()).toEntity().equals(names)).toBe(true);
  });
});
