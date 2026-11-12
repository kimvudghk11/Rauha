import { describe, expect, it } from 'vitest';
import { parseCommandResult, parseMarketplaces, parsePluginList, skillDescription } from './plugin-api.js';

describe('parsePluginList', () => {
  it('설치된 사용자 범위 플러그인과 고를 수 있는 플러그인을 읽는다', () => {
    const text = JSON.stringify({
      installed: [
        { id: 'superpowers@anthropic-plugin-directory', version: '7.0.2', scope: 'user', enabled: true, installPath: 'C:/cfg/plugins/cache/a/superpowers/7.0.2' },
        { id: 'x@y', scope: 'project', enabled: true, installPath: 'C:/p' },
        { id: 'broken' },
      ],
      available: [{ pluginId: 'feature-dev@anthropic-plugin-directory', name: 'feature-dev', marketplaceName: 'anthropic-plugin-directory', description: 'Feature workflow' }, { name: 'no-id' }],
    });
    const list = parsePluginList(text);
    expect(list.installed).toEqual([{ id: 'superpowers@anthropic-plugin-directory', version: '7.0.2', enabled: true, description: null, installPath: 'C:/cfg/plugins/cache/a/superpowers/7.0.2' }]);
    expect(list.available).toEqual([{ id: 'feature-dev@anthropic-plugin-directory', name: 'feature-dev', marketplace: 'anthropic-plugin-directory', description: 'Feature workflow' }]);
  });

  it('JSON 이 아니면 빈 목록이다', () => {
    expect(parsePluginList('oops')).toEqual({ installed: [], available: [] });
  });
});

describe('parseMarketplaces', () => {
  it('이름과 출처를 읽는다', () => {
    expect(parseMarketplaces(JSON.stringify([{ name: 'ponytail', source: 'github', repo: 'DietrichGebert/ponytail', installLocation: 'C:/x' }]))).toEqual([{ name: 'ponytail', source: 'DietrichGebert/ponytail' }]);
  });
});

describe('parseCommandResult', () => {
  it('outcome ok 면 성공, failed 면 그 메시지로 실패', () => {
    expect(parseCommandResult('{"command":"install","outcome":"ok"}\n', '')).toEqual({ ok: true });
    expect(parseCommandResult('{"command":"install","outcome":"failed","message":"Plugin \\"nope\\" not found"}\n✘ Failed', '')).toEqual({ ok: false, error: 'Plugin "nope" not found' });
  });

  it('결과 줄이 없으면 stderr 끝을 이유로 실패', () => {
    expect(parseCommandResult('', 'line1\nPlease make sure you have the correct access rights')).toEqual({ ok: false, error: 'line1 Please make sure you have the correct access rights' });
  });

  it('오류 글의 긴 경로는 끝만 남긴다', () => {
    const r = parseCommandResult('{"outcome":"failed","message":"clone into C:\\\\Users\\\\kimbo\\\\AppData\\\\Local\\\\Temp\\\\very\\\\long\\\\path\\\\here failed"}', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain('kimbo');
  });
});

describe('skillDescription', () => {
  it('SKILL.md 앞머리의 description 을 읽는다', () => {
    expect(skillDescription('---\nname: hello\ndescription: "Says hello."\n---\nbody')).toBe('Says hello.');
    expect(skillDescription('no front matter')).toBe('');
  });
});
