import { describe, expect, it } from 'vitest';
import { startupFailure } from './startup-failure.js';

describe('startupFailure', () => {
  it('프롬프트 파일이 없어서 못 열면 앱을 다시 설치하라고 알려 준다', () => {
    const f = startupFailure(new Error('프롬프트 파일이 없습니다: /res/prompts/_common.md'), '/log/app.log');
    expect(f.title).toContain('열지 못했어요');
    expect(f.body).toContain('다시 설치');
    expect(f.body).toContain('/log/app.log');
  });

  it('알 수 없는 오류도 한 줄 이유와 로그 위치를 보여 준다', () => {
    const f = startupFailure(new Error('boom\n  at x (file.js:1)'), '/log/app.log');
    expect(f.body).toContain('boom');
    expect(f.body).not.toContain('at x');
    expect(f.body).toContain('/log/app.log');
  });

  it('Error가 아닌 값이 던져져도 글로 바꾼다', () => {
    expect(startupFailure('문자열 오류', '/l').body).toContain('문자열 오류');
    expect(startupFailure(undefined, '/l').body).toContain('알 수 없는 오류');
  });

  it('이유가 너무 길면 줄인다', () => {
    expect(startupFailure(new Error('가'.repeat(1000)), '/l').body.length).toBeLessThan(600);
  });
});
