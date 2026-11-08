import { RoleSettingsDto } from '@rauha/core';
import { MEMBER_ROLES, REQUIRED_ROLES } from '@rauha/core/jobs';
import { describe, expect, it } from 'vitest';
import { TeamSettings, TeamSettingsError, type MemberDefaults } from './team-settings.js';

const core = RoleSettingsDto.defaults();
const defaultsOf = (role: (typeof MEMBER_ROLES)[number]): MemberDefaults => {
  const s = core.get(role);
  return { tier: s.tier, effort: s.effort, tools: s.tools };
};

describe('TeamSettings', () => {
  it('아무것도 안 바꾼 설정은 코어에 넘길 것이 없다(동작 변화 없음)', () => {
    expect(TeamSettings.initial().overrides()).toEqual({});
    expect(core.withOverrides(TeamSettings.initial().overrides()).entries()).toEqual(core.entries());
  });

  it('바꾼 것만 코어에 넘기고 이름·캐릭터는 화면용으로 따로 둔다', () => {
    const s = TeamSettings.initial().change('reviewer', { tier: 'opus', tools: ['Read', 'Grep'], extraInstruction: ' 보안부터 ', name: ' 깐깐이 ', character: 'brand' });
    expect(s.overrides()).toEqual({ reviewer: { tier: 'opus', tools: ['Read', 'Grep'], extraInstruction: '보안부터' } });
    expect(s.looks()).toEqual({ names: { reviewer: '깐깐이' }, characters: { reviewer: 'brand' } });
    expect(core.withOverrides(s.overrides()).get('reviewer')).toMatchObject({ tier: 'opus', extraInstruction: '보안부터' });
  });

  it('끄기는 꼭 필요한 팀원에게는 막고 나머지에는 된다', () => {
    for (const role of REQUIRED_ROLES) expect(() => TeamSettings.initial().change(role, { enabled: false })).toThrow(TeamSettingsError);
    const off = TeamSettings.initial().change('marketer', { enabled: false });
    expect(off.isEnabled('marketer')).toBe(false);
    expect(off.change('marketer', { enabled: true }).toJSON()).toEqual({ members: {} });
  });

  it('칸에 null을 주면 그 칸만 기본값으로 돌아간다', () => {
    const s = TeamSettings.initial().change('writer', { tier: 'opus', effort: 'high' }).change('writer', { tier: null });
    expect(s.of('writer')).toEqual({ effort: 'high' });
  });

  it('규칙을 어기는 값은 이유를 알리고 바꾸지 않는다', () => {
    const s = TeamSettings.initial();
    expect(() => s.change('writer', { tools: ['Read', 'Rm'] })).toThrow(/알 수 없는 도구/);
    expect(() => s.change('writer', { name: 'a'.repeat(13) })).toThrow(/12자/);
    expect(() => s.change('writer', { extraInstruction: 'a'.repeat(2001) })).toThrow(/2000자/);
    expect(() => s.change('writer', { character: 'nobody' as never })).toThrow(/캐릭터/);
    expect(() => s.change('writer', { tier: 'gpt' as never })).toThrow(/모델 등급/);
  });

  it('기본값과 같은 칸은 저장에서 지운다(모든 역할이 기본값 그대로면 빈 설정)', () => {
    let s = TeamSettings.initial();
    for (const role of MEMBER_ROLES) {
      const d = defaultsOf(role);
      s = s.change(role, { tier: d.tier, effort: d.effort, tools: [...d.tools], character: role });
    }
    expect(s.pruned(defaultsOf).toJSON()).toEqual({ members: {} });
    expect(s.change('tester', { tier: 'opus' }).pruned(defaultsOf).toJSON()).toEqual({ members: { tester: { tier: 'opus' } } });
  });

  it('하나만, 또는 전부 기본값으로 되돌린다', () => {
    const s = TeamSettings.initial().change('writer', { name: '글쓴이' }).change('brand', { tier: 'opus' });
    expect(s.reset('writer').toJSON()).toEqual({ members: { brand: { tier: 'opus' } } });
    expect(s.resetAll().toJSON()).toEqual({ members: {} });
  });

  it('깨진 파일은 기본으로 열고 틀린 칸만 버린다', () => {
    expect(TeamSettings.from('엉망').toJSON()).toEqual({ members: {} });
    const s = TeamSettings.from({ members: { tester: { enabled: false, tier: 'opus' }, marketer: { enabled: false, tier: 'gpt', tools: ['Read', 'Rm', 3], name: '  ', character: 'nobody' }, nobody: { tier: 'opus' } } });
    expect(s.toJSON()).toEqual({ members: { tester: { tier: 'opus' }, marketer: { enabled: false, tools: ['Read'] } } });
  });

  it('저장했다 읽어도 같다', () => {
    const s = TeamSettings.initial().change('brand', { name: '이름', tier: 'haiku', extraInstruction: '짧게' });
    expect(TeamSettings.from(JSON.parse(JSON.stringify(s.toJSON()))).toJSON()).toEqual(s.toJSON());
  });
});
