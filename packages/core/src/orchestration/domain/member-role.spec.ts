import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES, ROLE_INFO } from './member-role.js';

describe('ROLE_INFO', () => {
  it('모든 역할에 이름이 있다', () => {
    for (const role of MEMBER_ROLES) expect(ROLE_INFO[role].name).not.toBe('');
    expect(Object.keys(ROLE_INFO).sort()).toEqual([...MEMBER_ROLES].sort());
  });

  it('질문을 나누고 답하는 역할은 진행 단계 이름이 없다 (사용자에게 한 가지 일로 보인다)', () => {
    expect(MEMBER_ROLES.filter((r) => ROLE_INFO[r].stage === null)).toEqual(['router', 'answerer']);
  });

  it('파일을 쓰는 권한은 테스트·구현·리뷰·문서 역할에만 따로 있고 나머지는 팀장과 같다', () => {
    const special = MEMBER_ROLES.filter((r) => ROLE_INFO[r].writeRole !== 'lead');
    expect(special).toEqual(['tester', 'implementer', 'reviewer', 'writer']);
  });

  it('git 팀원은 진행 줄에 "커밋·PR" 단계로 보이고 파일은 쓰지 않는다', () => {
    expect(ROLE_INFO.publisher).toMatchObject({ name: 'git 팀원', stage: '커밋·PR', writeRole: 'lead' });
  });

  it('접수는 화면에는 "팀장", 시작 알림에는 "팀장 접수"로 보인다', () => {
    expect(ROLE_INFO.intake).toMatchObject({ name: '팀장', stepName: '팀장 접수' });
  });
});
