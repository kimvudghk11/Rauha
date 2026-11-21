import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const prompt = (role: string): string => readFileSync(join(__dirname, '../../../../../prompts', `${role}.md`), 'utf8');
const block = (text: string): string => /<test_methods>([\s\S]*?)<\/test_methods>/.exec(text)?.[1] ?? '';

/** 테스트 팀원이 고르는 12가지 검증 방식(2026-11-21 사용자: "설계·구현은 빠르고 정확하게, 테스트는 완벽한 검증") */
const METHODS = ['Unit', 'Integration', 'End-to-end', 'TDD', 'BDD', 'Coverage', 'Mutation', 'Property-based', 'Regression', 'Contract', 'Performance', 'Security'];

describe('테스트 방식 12가지', () => {
  it('테스트 팀원 프롬프트는 12가지 방식을 모두 이름으로 갖는다', () => {
    const methods = block(prompt('tester'));
    for (const name of METHODS) expect(methods, name).toContain(`**${name}`);
  });

  it('맞는 방식은 빠짐없이 쓰고, 맞지 않는 방식은 건너뛴 이유를 한 줄로 남긴다(12개를 억지로 다 하지 않는다)', () => {
    const methods = block(prompt('tester'));
    expect(methods).toMatch(/every method that fits/i);
    expect(methods).toMatch(/skipped.*one line/i);
  });

  it('프로젝트에 없는 테스트 도구는 새로 설치하지 않는다(뮤테이션·속성 기반은 손으로 대신 확인)', () => {
    const methods = block(prompt('tester'));
    expect(methods).toMatch(/never install/i);
    expect(methods).toMatch(/flip/i);
  });

  it('리뷰어는 바뀐 내용에 맞는데 빠진 검증 방식을 근거와 함께 짚는다', () => {
    expect(prompt('reviewer')).toMatch(/Verification:[\s\S]*<test_methods>/);
  });
});
