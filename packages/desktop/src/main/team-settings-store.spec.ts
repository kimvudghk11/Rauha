import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEMBER_ROLES } from '@rauha/core/jobs';
import { describe, expect, it } from 'vitest';
import { TeamSettings } from '../shared/team-settings.js';
import { applyTeamOp, memberInfos, TeamSettingsStore } from './team-settings-store.js';

describe('memberInfos', () => {
  it('팀원 23명의 기본값(코어의 역할 설정)과 끌 수 있는지를 담는다', () => {
    const infos = memberInfos();
    expect(infos.map((i) => i.role)).toEqual([...MEMBER_ROLES]);
    expect(infos).toHaveLength(23);
    expect(infos.find((i) => i.role === 'reviewer')).toMatchObject({ title: '리뷰어', required: true, defaults: { tier: 'sonnet', effort: 'medium' } });
    expect(infos.find((i) => i.role === 'reviewer')!.defaults.tools).not.toContain('Write');
    expect(infos.find((i) => i.role === 'marketer')!.required).toBe(false);
  });
});

describe('applyTeamOp', () => {
  const initial = TeamSettings.initial();

  it('팀원 한 칸을 바꾸고 엔진에 넘길 모양을 만든다', () => {
    const res = applyTeamOp(initial, { kind: 'change', role: 'reviewer', patch: { tier: 'opus', extraInstruction: '보안부터' } });
    expect(res.ok && res.settings.overrides()).toEqual({ reviewer: { tier: 'opus', extraInstruction: '보안부터' } });
    expect(res.ok && res.view.settings.members.reviewer?.tier).toBe('opus');
  });

  it('기본값과 같게 바꾸면 바꾼 것이 남지 않는다', () => {
    const res = applyTeamOp(initial, { kind: 'change', role: 'reviewer', patch: { tier: 'sonnet' } });
    expect(res.ok && res.settings.toJSON()).toEqual({ members: {} });
  });

  it('필수 팀원 끄기, 없는 팀원, 알 수 없는 요청은 이유를 돌려준다', () => {
    expect(applyTeamOp(initial, { kind: 'change', role: 'tester', patch: { enabled: false } })).toMatchObject({ ok: false });
    expect(applyTeamOp(initial, { kind: 'change', role: 'nobody', patch: {} })).toMatchObject({ ok: false });
    expect(applyTeamOp(initial, { kind: 'dance' })).toMatchObject({ ok: false });
    expect(applyTeamOp(initial, 7)).toMatchObject({ ok: false });
  });

  it('하나·전부 기본값으로 되돌린다', () => {
    const changed = TeamSettings.initial().change('brand', { name: '이름' }).change('writer', { tier: 'opus' });
    const one = applyTeamOp(changed, { kind: 'reset', role: 'brand' });
    expect(one.ok && one.settings.toJSON()).toEqual({ members: { writer: { tier: 'opus' } } });
    const all = applyTeamOp(changed, { kind: 'resetAll' });
    expect(all.ok && all.settings.toJSON()).toEqual({ members: {} });
  });
});

describe('TeamSettingsStore', () => {
  it('저장했다 읽고, 없거나 깨진 파일은 바꾼 것 없음으로 연다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rauha-team-'));
    try {
      const store = new TeamSettingsStore(join(dir, 't.json'));
      expect((await store.load()).toJSON()).toEqual({ members: {} });
      await store.save(TeamSettings.initial().change('brand', { tier: 'opus', name: '이름' }));
      expect((await store.load()).of('brand')).toEqual({ tier: 'opus', name: '이름' });
      await writeFile(join(dir, 't.json'), '{깨짐', 'utf8');
      expect((await store.load()).toJSON()).toEqual({ members: {} });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
