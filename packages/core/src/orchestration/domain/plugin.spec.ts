import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { MarketplaceSource, PluginId, PluginPick, PluginReach, SkillName } from './plugin.js';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
};

describe('PluginId', () => {
  it('플러그인은 이름@마켓플레이스로 가리킨다', () => {
    const id = PluginId.of('superpowers@anthropic-plugin-directory');
    expect(id.name).toBe('superpowers');
    expect(id.marketplace).toBe('anthropic-plugin-directory');
    expect(id.value).toBe('superpowers@anthropic-plugin-directory');
  });

  it('명령줄 옵션처럼 보이거나 이상한 글자가 든 이름은 거절한다', () => {
    expect(code(() => PluginId.of('--force@x'))).toBe('INVALID_PLUGIN');
    expect(code(() => PluginId.of('a b@c'))).toBe('INVALID_PLUGIN');
    expect(code(() => PluginId.of('superpowers'))).toBe('INVALID_PLUGIN');
    expect(code(() => PluginId.of('x@y;rm -rf'))).toBe('INVALID_PLUGIN');
  });
});

describe('MarketplaceSource', () => {
  it('GitHub owner/repo 와 https 주소만 받는다', () => {
    expect(MarketplaceSource.of('obra/superpowers-marketplace').value).toBe('obra/superpowers-marketplace');
    expect(MarketplaceSource.of(' https://github.com/DietrichGebert/ponytail.git ').value).toBe('https://github.com/DietrichGebert/ponytail.git');
    expect(code(() => MarketplaceSource.of('file:///etc'))).toBe('INVALID_MARKETPLACE');
    expect(code(() => MarketplaceSource.of('-c core.sshCommand=x'))).toBe('INVALID_MARKETPLACE');
    expect(code(() => MarketplaceSource.of('https://user:pw@github.com/a/b'))).toBe('INVALID_MARKETPLACE');
    expect(code(() => MarketplaceSource.of('C:\\plugins'))).toBe('INVALID_MARKETPLACE');
  });
});

describe('SkillName', () => {
  it('스킬 폴더 이름만 받는다(경로를 벗어나지 않게)', () => {
    expect(SkillName.of('hello-skill').value).toBe('hello-skill');
    expect(code(() => SkillName.of('../x'))).toBe('INVALID_SKILL');
    expect(code(() => SkillName.of('a/b'))).toBe('INVALID_SKILL');
    expect(code(() => SkillName.of('.hidden'))).toBe('INVALID_SKILL');
  });
});

describe('PluginPick 추천 목록', () => {
  const picks = PluginPick.all();

  it('추천은 짧고 엄선한다(8개 이하)', () => {
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(8);
  });

  it('superpowers 와 ponytail 이 들어 있다', () => {
    expect(picks.map((p) => p.id.value)).toContain('superpowers@anthropic-plugin-directory');
    const ponytail = picks.find((p) => p.id.value === 'ponytail@ponytail');
    expect(ponytail?.marketplace?.value).toBe('DietrichGebert/ponytail');
  });

  it('나머지는 Anthropic 공식 디렉터리에서 온다', () => {
    for (const pick of picks.filter((p) => p.marketplace !== null)) expect(pick.id.value).toBe('ponytail@ponytail');
    for (const pick of picks.filter((p) => p.marketplace === null)) expect(pick.id.marketplace).toBe('anthropic-plugin-directory');
  });

  it('모든 추천에 업무 설명 한 줄과 한국어 예시 요청 1~2개가 있다', () => {
    for (const pick of picks) {
      expect(pick.summary.length).toBeGreaterThan(10);
      expect(pick.examples.length).toBeGreaterThanOrEqual(1);
      expect(pick.examples.length).toBeLessThanOrEqual(2);
      for (const example of pick.examples) expect(example).toMatch(/[가-힣]/);
    }
  });
});

describe('PluginReach', () => {
  it('일하는 팀원은 설치한 플러그인·스킬을 쓰고, 분류·접수 같은 짧은 판정 호출은 쓰지 않는다(한도 절약)', () => {
    for (const role of ['answerer', 'implementer', 'tester', 'debugger', 'designer', 'writer', 'reviewer'] as const) expect(PluginReach.loads(role)).toBe(true);
    for (const role of ['router', 'intake', 'splitter', 'chief', 'publisher'] as const) expect(PluginReach.loads(role)).toBe(false);
  });
});
