import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '../domain/member-role.js';

const prompt = (role: string): string => readFileSync(join(__dirname, '../../../../../prompts', `${role}.md`), 'utf8');

describe('팀원 프롬프트의 전문성', () => {
  it('라우터와 메인 채팅 Claude(Claude Code 프롬프트 그대로)를 뺀 모든 팀원은 자기 분야 10년차 이상의 전문성을 가지고, 그 깊이로 추측하지 않는다고 적혀 있다', () => {
    for (const role of MEMBER_ROLES.filter((r) => r !== 'router' && r !== 'direct')) {
      const text = prompt(role);
      expect(text, role).toMatch(/<expertise>[\s\S]*10\+ years[\s\S]*never to guess[\s\S]*<\/expertise>/);
    }
  });

  it('개발·인프라·DevOps 팀원은 그 분야의 핵심 지식을 구체적으로 갖는다', () => {
    expect(prompt('operator')).toMatch(/DevOps \/ SRE[\s\S]*Terraform[\s\S]*Kubernetes/);
    expect(prompt('securitychecker')).toMatch(/OWASP/);
    expect(prompt('intake')).toMatch(/tech lead with 10\+ years[\s\S]*leading teams/);
  });
});
