import { describe, expect, it } from 'vitest';
import { ModelFallback } from './model-fallback.js';
import { ModelNames } from './model-names.js';

describe('ModelFallback.isModelError', () => {
  it.each([
    "There's an issue with the selected model (claude-opus-5-5). It may not exist or you may not have access to it.",
    'error: not_found_error: model: claude-opus-5-5',
    'The model claude-opus-5-5 does not exist',
    'model_not_found',
    'You do not have access to the model claude-opus-5-5',
    'Invalid model name: claude-x',
    'permission_error: your account is not allowed to use this model',
    'Model claude-opus-5-5 is not available for this account',
    'result: 404 model not found',
  ])('모델을 쓸 수 없다는 메시지 %j 는 모델 오류다', (message) => {
    expect(ModelFallback.isModelError(message)).toBe(true);
  });

  it.each(['', 'timeout while reading file', 'error_max_turns: ', 'Usage limit reached for Opus models', 'Not logged in', '결과 메시지를 받지 못했습니다.', 'file not found: src/a.ts', '구조화 출력이 없습니다.'])('다른 오류 %j 는 모델 오류가 아니다', (message) => {
    expect(ModelFallback.isModelError(message)).toBe(false);
  });

  it('오류가 없으면 모델 오류가 아니다', () => {
    expect(ModelFallback.isModelError(null)).toBe(false);
  });
});

describe('ModelFallback 대체 순서', () => {
  const modelError = 'The model does not exist';

  it('같은 등급의 이전 버전 → 한 단계 낮은 등급 순으로 대체한다', () => {
    const fb = ModelFallback.start(ModelNames.defaults(), 'opus');
    expect(fb.next(modelError, false)).toEqual({ tier: 'opus', model: 'claude-opus-5' });
    expect(fb.next(modelError, false)).toEqual({ tier: 'sonnet', model: 'claude-sonnet-5-5' });
  });

  it('무한 반복하지 않고 최대 2번만 대체한다', () => {
    const fb = ModelFallback.start(ModelNames.defaults(), 'opus');
    fb.next(modelError, false);
    fb.next(modelError, false);
    expect(fb.next(modelError, false)).toBeNull();
    expect(fb.next(modelError, false)).toBeNull();
  });

  it('이전 버전을 모르는 모델은 바로 한 단계 낮은 등급으로 간다', () => {
    const fb = ModelFallback.start(ModelNames.defaults(), 'haiku');
    expect(fb.next(modelError, false)).toBeNull();
    const sonnet = ModelFallback.start(ModelNames.defaults().with('sonnet', 'claude-sonnet-5'), 'sonnet');
    expect(sonnet.next(modelError, false)).toEqual({ tier: 'haiku', model: 'claude-haiku-5-5' });
  });

  it('사용자가 넣은 Fable 은 Fable 의 이전 버전으로, 그다음 그 칸의 한 단계 낮은 등급으로 간다', () => {
    const names = ModelNames.defaults().with('opus', 'claude-fable-5-2');
    const fb = ModelFallback.start(names, 'opus');
    expect(fb.next(modelError, false)).toEqual({ tier: 'opus', model: 'claude-fable-5-1' });
    expect(fb.next(modelError, false)).toEqual({ tier: 'sonnet', model: 'claude-sonnet-5-5' });
  });

  it('알려진 계보에 없는 ID 는 이전 버전을 지어내지 않고 낮은 등급으로 간다', () => {
    const names = ModelNames.defaults().with('opus', 'claude-opus-9-9');
    expect(ModelFallback.start(names, 'opus').next(modelError, false)).toEqual({ tier: 'sonnet', model: 'claude-sonnet-5-5' });
  });

  it('낮은 등급 칸이 같은 모델이면 건너뛴다', () => {
    const names = ModelNames.defaults().with('sonnet', 'claude-opus-5');
    const fb = ModelFallback.start(names, 'opus');
    expect(fb.next(modelError, false)).toEqual({ tier: 'opus', model: 'claude-opus-5' });
    expect(fb.next(modelError, false)).toBeNull();
  });

  it('모델 오류가 아니거나 계정 문제로 막힌 경우에는 대체하지 않는다', () => {
    expect(ModelFallback.start(ModelNames.defaults(), 'opus').next('timeout', false)).toBeNull();
    expect(ModelFallback.start(ModelNames.defaults(), 'opus').next(null, false)).toBeNull();
    expect(ModelFallback.start(ModelNames.defaults(), 'opus').next(modelError, true)).toBeNull();
  });

  it('대체했으면 한국어 한 줄로 알린다', () => {
    const fb = ModelFallback.start(ModelNames.defaults(), 'opus');
    expect(fb.notice()).toBeNull();
    fb.next(modelError, false);
    expect(fb.notice()).toBe('opus-5-5 모델을 쓸 수 없어서 대신 opus-5 모델로 실행했어요.');
    fb.next(modelError, false);
    expect(fb.notice()).toBe('opus-5-5 모델을 쓸 수 없어서 대신 sonnet-5-5 모델로 실행했어요.');
  });

  it('마지막 호출도 모델 오류로 끝났으면 알리지 않는다(대체가 통하지 않았다)', () => {
    const fb = ModelFallback.start(ModelNames.defaults(), 'opus');
    fb.next(modelError, false);
    expect(fb.notice(modelError)).toBeNull();
    expect(fb.notice('error_max_turns: ')).not.toBeNull();
  });
});
