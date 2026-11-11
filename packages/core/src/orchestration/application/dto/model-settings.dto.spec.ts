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

  it('설정 파일이 변조되어 줄바꿈·제어 문자·보이지 않는 글자·옵션 모양·경로 모양이 든 값은 그 등급만 기본값으로 돌린다', () => {
    const bad = ['claude-opus-5\nclaude-x', 'claude-opus-5\u0000', 'claude-‮opus', 'claude-opus​-5', 'claude-opus-5 --dangerous', 'claude-../../x', 'claude-a/b', 'claude-opus-5;rm', 'claude-', 'claude--x', 'CLAUDE-opus-5', 'claude-ópus-5', 'claude-opus-5[1m]'];
    for (const value of bad) {
      const dto = ModelSettingsDto.from({ opus: value });
      expect(dto.rejected, JSON.stringify(value)).toEqual(['opus']);
      expect(dto.toRecord().opus).toBe('claude-opus-5-5');
    }
  });

  it('값이 배열·객체·불리언 모양이면 거절하고, 알 수 없는 등급 이름은 무시한다', () => {
    const dto = ModelSettingsDto.from({ haiku: ['claude-haiku-5-5'], sonnet: { id: 'claude-sonnet-5' }, opus: true, fable: 'claude-fable-5', constructor: 'claude-x', toString: 'claude-y' });
    expect(dto.rejected).toEqual(['haiku', 'sonnet', 'opus']);
    expect(dto.toEntity().equals(ModelNames.defaults())).toBe(true);
  });

  it('프로토타입에서 물려받은 값은 설정으로 보지 않는다(오염된 객체)', () => {
    const polluted = Object.create({ opus: 'claude-evil-model' }) as Record<string, unknown>;
    expect(ModelSettingsDto.from(polluted).toRecord().opus).toBe('claude-opus-5-5');
  });

  it('JSON 으로 들어온 __proto__ 키가 있어도 등급 값은 바뀌지 않는다', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"opus":"claude-evil"},"sonnet":"claude-sonnet-5"}');
    expect(ModelSettingsDto.from(parsed).toRecord()).toEqual({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5', opus: 'claude-opus-5-5' });
    expect(({} as Record<string, unknown>)['opus']).toBeUndefined();
  });

  it('없는 등급은 거부로 세지 않고 기본값이다', () => {
    expect(ModelSettingsDto.from({ opus: 'claude-opus-5' }).rejected).toEqual([]);
  });

  it('엔티티에서 만든 값을 다시 읽어도 같다', () => {
    const names = ModelNames.defaults().with('opus', 'claude-opus-5');
    expect(ModelSettingsDto.from(ModelSettingsDto.fromEntity(names).toRecord()).toEntity().equals(names)).toBe(true);
  });
});
