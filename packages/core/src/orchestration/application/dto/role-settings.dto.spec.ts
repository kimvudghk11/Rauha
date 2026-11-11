import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { RoleOverridesDto } from './role-overrides.dto.js';
import { REQUIRED_ROLES, RoleSettingsDto } from './role-settings.dto.js';

describe('RoleSettingsDto', () => {
  it('기본값: 접수는 sonnet low, 테스트·구현은 haiku medium', () => {
    const roles = RoleSettingsDto.defaults();
    expect(roles.get('intake')).toMatchObject({ tier: 'sonnet', effort: 'low' });
    expect(roles.get('tester')).toMatchObject({ tier: 'haiku', effort: 'medium' });
    expect(roles.get('implementer')).toMatchObject({ tier: 'haiku', effort: 'medium' });
    expect(roles.get('implementer').tools).toContain('Bash');
    expect(roles.get('intake').tools).not.toContain('Write');
  });

  it('환경 변수로 역할의 모델과 effort를 바꾼다', () => {
    const roles = RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_IMPLEMENTER: 'sonnet:high', RAUHA_ROLE_TESTER: 'opus' });
    expect(roles.get('implementer')).toMatchObject({ tier: 'sonnet', effort: 'high' });
    expect(roles.get('tester')).toMatchObject({ tier: 'opus', effort: 'medium' });
  });

  it('구현 시니어(sonnet)는 주니어보다 예산 상한이 크다', () => {
    const roles = RoleSettingsDto.defaults();
    expect(roles.forAssignment('implementer', 'sonnet')).toMatchObject({ tier: 'sonnet', effort: 'medium', maxBudgetUsd: 2 });
    expect(roles.forAssignment('implementer', 'haiku')).toMatchObject({ tier: 'haiku', maxBudgetUsd: 1 });
  });

  it('환경 변수로 고정한 역할은 배정 모델과 상관없이 그 모델을 쓴다', () => {
    const roles = RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_IMPLEMENTER: 'sonnet:high' });
    expect(roles.forAssignment('implementer', 'haiku')).toMatchObject({ tier: 'sonnet', effort: 'high' });
  });

  it('고정하지 않은 역할은 배정 모델을 따른다', () => {
    const roles = RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_TESTER: 'opus' });
    expect(roles.forAssignment('implementer', 'sonnet').tier).toBe('sonnet');
  });

  it('리뷰어는 sonnet이고 파일을 쓰는 도구가 없다', () => {
    const reviewer = RoleSettingsDto.defaults().get('reviewer');
    expect(reviewer).toMatchObject({ tier: 'sonnet', effort: 'medium' });
    expect(reviewer.tools).toContain('Read');
    for (const tool of ['Edit', 'Write', 'Bash']) expect(reviewer.tools).not.toContain(tool);
  });

  it('라우터는 도구 없는 haiku, 답변 팀원은 읽기만 하는 sonnet', () => {
    const roles = RoleSettingsDto.defaults();
    expect(roles.get('router')).toMatchObject({ tier: 'haiku', effort: 'low', tools: [] });
    expect(roles.get('answerer')).toMatchObject({ tier: 'sonnet' });
    expect(roles.get('answerer').tools).not.toContain('Write');
  });

  it('저장소 조사 팀원은 웹 없이 읽기만 하는 haiku', () => {
    const surveyor = RoleSettingsDto.defaults().get('surveyor');
    expect(surveyor).toMatchObject({ tier: 'haiku', effort: 'low', readsProject: true });
    expect([...surveyor.tools].sort()).toEqual(['Glob', 'Grep', 'Read']);
  });

  it('라우터는 프로젝트 설정(CLAUDE.md)을 읽지 않고, 나머지 팀원은 읽는다', () => {
    const roles = RoleSettingsDto.defaults();
    expect(roles.get('router').readsProject).toBe(false);
    for (const role of ['intake', 'tester', 'implementer', 'reviewer', 'answerer'] as const) expect(roles.get(role).readsProject).toBe(true);
  });

  it('답변 팀원은 공식 문서를 찾아 읽을 수 있고, 여러 페이지를 볼 만큼 턴과 노력을 갖는다', () => {
    const answerer = RoleSettingsDto.defaults().get('answerer');
    expect(answerer.tools).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
    // 명령 결과를 묻는 질문("테스트 돌려봐", "지금 브랜치 뭐야")은 사용자에게 시키지 않고 직접 돌린다.
    expect(answerer.tools).toContain('Bash');
    expect(answerer.tools).not.toContain('Edit');
    expect(answerer.effort).toBe('medium');
    expect(answerer.maxTurns).toBeGreaterThanOrEqual(25);
  });

  it('모든 역할의 설정을 역할 이름과 함께 나열한다 (환경 변수로 고정한 모델이 반영된다)', () => {
    const entries = RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_TESTER: 'opus:high' }).entries();
    expect(entries.map((e) => e.role)).toEqual(expect.arrayContaining(['intake', 'tester', 'implementer', 'reviewer', 'operator']));
    expect(entries.find((e) => e.role === 'tester')).toMatchObject({ tier: 'opus', effort: 'high' });
  });

  it('기획 팀원은 시장을 찾아볼 수 있지만 파일은 쓰지 못한다', () => {
    const planner = RoleSettingsDto.defaults().get('planner');
    expect(planner.tools).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
    expect(planner.tools).not.toContain('Write');
    expect(planner.tools).not.toContain('Edit');
  });

  it('부서장은 가장 높은 모델을 쓰고, 회사 부서 팀원은 아무도 파일을 쓰지 못한다', () => {
    const roles = RoleSettingsDto.defaults();
    expect(roles.get('chief').tier).toBe('opus');
    for (const role of ['chief', 'bm', 'marketer', 'growth', 'uxdesigner', 'brand', 'securitychecker', 'releaser', 'planner'] as const) {
      expect(roles.get(role).tools).not.toContain('Write');
      expect(roles.get(role).tools).not.toContain('Edit');
    }
  });

  it('형식이 틀린 환경 변수는 거부한다', () => {
    expect(() => RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_TESTER: 'gpt:fast' })).toThrow(DomainError);
  });
});

describe('RoleSettingsDto — 가벼운 답변', () => {
  it('light 답변 팀원은 haiku 등급이고 턴이 적고 웹·명령 도구가 없다', () => {
    const light = RoleSettingsDto.defaults().lightAnswerer();
    expect(light.tier).toBe('haiku');
    expect(light.effort).toBe('low');
    expect(light.maxTurns).toBe(12);
    expect(light.tools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('환경 변수로 답변 팀원 모델을 고정했으면 light도 그 모델을 따른다', () => {
    const pinned = RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_ANSWERER: 'opus' });
    expect(pinned.lightAnswerer().tier).toBe('opus');
  });
});

describe('RoleSettingsDto — 분석의 설계·계획', () => {
  it('기본은 sonnet이고 effort를 high로 올린다', () => {
    expect(RoleSettingsDto.defaults().forBlueprint('sonnet')).toMatchObject({ tier: 'sonnet', effort: 'high' });
  });

  it('큰 변경이면 opus로 올릴 수 있다', () => {
    expect(RoleSettingsDto.defaults().forBlueprint('opus').tier).toBe('opus');
  });

  it('환경 변수로 설계 팀원을 고정했으면 그 모델과 effort를 따른다', () => {
    const pinned = RoleSettingsDto.defaults().withEnv({ RAUHA_ROLE_DESIGNER: 'haiku:low' });
    expect(pinned.forBlueprint('opus')).toMatchObject({ tier: 'haiku', effort: 'low' });
  });
});

describe('팀 설정(withOverrides)', () => {
  const plain = RoleSettingsDto.defaults();

  it('설정이 비어 있으면 모든 팀원의 동작이 기본값 그대로다', () => {
    const same = plain.withOverrides({});
    expect(same.entries()).toEqual(plain.entries());
    expect(same.forAssignment('implementer', 'sonnet')).toEqual(plain.forAssignment('implementer', 'sonnet'));
  });

  it('모델 등급·노력·도구·추가 지시를 팀원 하나만 바꾼다', () => {
    const roles = plain.withOverrides({ reviewer: { tier: 'opus', effort: 'high', tools: ['Read', 'Grep'], extraInstruction: ' 보안부터 봐 ' } });
    expect(roles.get('reviewer')).toMatchObject({ tier: 'opus', effort: 'high', tools: ['Read', 'Grep'], extraInstruction: '보안부터 봐' });
    expect(roles.get('tester')).toEqual(plain.get('tester'));
  });

  it('고른 모델 등급은 상태 머신의 승격 배정보다 앞선다', () => {
    const roles = plain.withOverrides({ implementer: { tier: 'opus' } });
    expect(roles.forAssignment('implementer', 'haiku').tier).toBe('opus');
  });

  it('환경 변수로 고정한 모델이 설정보다 앞선다(실험용)', () => {
    const roles = plain.withOverrides({ implementer: { tier: 'opus' } }).withEnv({ RAUHA_ROLE_IMPLEMENTER: 'haiku' });
    expect(roles.get('implementer').tier).toBe('haiku');
  });

  it('끈 팀원을 부르면 켜라는 안내와 함께 막는다', () => {
    const roles = plain.withOverrides({ marketer: { enabled: false } });
    expect(roles.isEnabled('marketer')).toBe(false);
    expect(() => roles.get('marketer')).toThrow(/꺼 둔 팀원/);
    expect(() => roles.forAssignment('marketer', 'sonnet')).toThrow(DomainError);
    expect(roles.get('brand')).toEqual(plain.get('brand'));
  });

  it('작업 흐름에 꼭 필요한 팀원은 끌 수 없다', () => {
    for (const role of REQUIRED_ROLES) expect(() => plain.withOverrides({ [role]: { enabled: false } })).toThrow(/꼭 필요/);
  });

  it('아는 도구만 쓸 수 있고 추가 지시는 2000자까지다', () => {
    expect(() => plain.withOverrides({ writer: { tools: ['Read', 'Rm'] } })).toThrow(/알 수 없는 도구/);
    expect(() => plain.withOverrides({ writer: { extraInstruction: 'a'.repeat(2001) } })).toThrow(/2000자/);
  });

  it('가벼운 답변도 답변 팀원의 추가 지시를 따른다', () => {
    expect(plain.withOverrides({ answerer: { extraInstruction: '존댓말' } }).lightAnswerer().extraInstruction).toBe('존댓말');
  });
});

describe('RoleOverridesDto', () => {
  it('틀린 칸·모르는 역할은 버려 기본값으로 둔다', () => {
    const dto = RoleOverridesDto.from({ roles: { reviewer: { tier: 'gpt', effort: 'max', tools: ['Read', 3], extraInstruction: '  ' }, nobody: { tier: 'opus' }, writer: 'x', marketer: { enabled: false } } });
    expect(dto.overrides).toEqual({ reviewer: { effort: 'max', tools: ['Read'] }, marketer: { enabled: false } });
    expect(RoleOverridesDto.from('엉망').overrides).toEqual({});
  });

  it('저장한 모양을 다시 읽어도 같다', () => {
    const o = { reviewer: { tier: 'opus' as const, tools: ['Read'] } };
    expect(RoleOverridesDto.from(JSON.parse(JSON.stringify(RoleOverridesDto.from({ roles: o }).toJSON()))).overrides).toEqual(o);
  });
});
