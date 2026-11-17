import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { ModelNames } from './model-names.js';

describe('ModelNames', () => {
  it('기본값은 등급마다 지금 쓰는 모델 ID다(haiku 는 쓰지 않는다)', () => {
    const names = ModelNames.defaults();
    expect(names.idOf('sonnet')).toBe('claude-sonnet-5-5');
    expect(names.idOf('opus')).toBe('claude-opus-5-5');
    expect(names.idOf('fable')).toBe('claude-fable-5-2');
    expect(ModelNames.TIERS).toEqual(['sonnet', 'opus', 'fable']);
  });

  it('한 등급만 바꾸면 나머지는 그대로고 원본은 변하지 않는다', () => {
    const base = ModelNames.defaults();
    const next = base.with('opus', 'claude-opus-4-8');
    expect(next.idOf('opus')).toBe('claude-opus-4-8');
    expect(next.idOf('sonnet')).toBe('claude-sonnet-5-5');
    expect(base.idOf('opus')).toBe('claude-opus-5-5');
  });

  it('앞뒤 공백은 지우고 저장한다', () => {
    expect(ModelNames.defaults().with('sonnet', '  claude-sonnet-5  ').idOf('sonnet')).toBe('claude-sonnet-5');
  });

  it.each(['', '   ', 'sonnet', 'gpt-5', 'claude-', 'claude-opus 5', 'claude-opus-5\nx', `claude-${'a'.repeat(80)}`, 'claude-한글'])('이상한 값 %j 는 거부한다', (bad) => {
    expect(() => ModelNames.defaults().with('opus', bad)).toThrowError(DomainError);
    expect(ModelNames.checkId(bad)).not.toBeNull();
  });

  it('알려진 ID는 모두 유효하다', () => {
    for (const id of ModelNames.KNOWN) expect(ModelNames.checkId(id)).toBeNull();
  });

  it('알려진 ID 목록은 Fable 5.2 · Opus 5.5 · 5 · 4.8 · Sonnet 5.5 · 5 이고 haiku 는 없다', () => {
    expect(ModelNames.KNOWN).toEqual(expect.arrayContaining(['claude-fable-5-2', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-sonnet-5']));
    expect(ModelNames.KNOWN.some((id) => id.includes('haiku'))).toBe(false);
  });

  it('기본값과 같은지 등급별로 알려 준다', () => {
    const names = ModelNames.defaults().with('sonnet', 'claude-sonnet-5');
    expect(names.isDefault('sonnet')).toBe(false);
    expect(names.isDefault('opus')).toBe(true);
  });

  it('같은 값이면 같은 것이다', () => {
    expect(ModelNames.defaults().equals(ModelNames.defaults())).toBe(true);
    expect(ModelNames.defaults().equals(ModelNames.defaults().with('opus', 'claude-opus-5'))).toBe(false);
  });
});
