import { describe, expect, it } from 'vitest';
import type { SkillView } from '../../shared/plugin-api.js';
import { PluginService, type PluginCli, type SkillFolder } from './plugin-service.js';

/** 가짜 Claude Code: 받은 명령을 적고, 설치 상태를 흉내 낸다. */
function fakeCli() {
  const calls: string[][] = [];
  const installed = new Map<string, boolean>();
  const marketplaces: { name: string; repo: string }[] = [];
  const ok = (extra = {}) => ({ stdout: `${JSON.stringify({ outcome: 'ok', ...extra })}\n`, stderr: '' });
  const cli: PluginCli = {
    run: async (args) => {
      calls.push([...args]);
      const [a, b, c] = args;
      if (a === 'plugin' && b === 'list') {
        return {
          stdout: JSON.stringify({
            installed: [...installed].map(([id, enabled]) => ({ id, version: '1.0.0', scope: 'user', enabled, installPath: `C:/cfg/plugins/cache/${id}` })),
            available: [{ pluginId: 'feature-dev@anthropic-plugin-directory', name: 'feature-dev', marketplaceName: 'anthropic-plugin-directory', description: 'Feature workflow' }],
          }),
          stderr: '',
        };
      }
      if (b === 'marketplace' && c === 'list') return { stdout: JSON.stringify(marketplaces.map((m) => ({ name: m.name, source: 'github', repo: m.repo }))), stderr: '' };
      if (b === 'marketplace' && c === 'add') {
        const repo = args[3]!;
        marketplaces.push({ name: repo.split('/')[1]!, repo });
        return ok();
      }
      if (b === 'install') {
        if (c === 'nope@anthropic-plugin-directory') return { stdout: JSON.stringify({ outcome: 'failed', message: 'Plugin "nope" not found' }), stderr: '' };
        installed.set(c!, true);
        return ok();
      }
      if (b === 'uninstall') installed.delete(c!);
      if (b === 'disable') installed.set(c!, false);
      if (b === 'enable') installed.set(c!, true);
      return ok();
    },
  };
  return { cli, calls, installed };
}

function skillFolder(names: string[] = []): SkillFolder & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    root: async () => 'C:/cfg',
    list: async (): Promise<SkillView[]> => names.filter((n) => !removed.includes(n)).map((name) => ({ name, description: `${name} skill` })),
    remove: async (name) => void removed.push(name.value),
  };
}

describe('PluginService', () => {
  it('추천 목록은 설치 여부와 함께 보이고, 설치된 것·고를 것·마켓플레이스·스킬을 함께 보여 준다', async () => {
    const { cli } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder(['hello-skill']) });
    const view = await svc.list();
    expect(view.picks.find((p) => p.id === 'superpowers@anthropic-plugin-directory')?.installed).toBe(false);
    expect(view.available.map((a) => a.id)).toEqual(['feature-dev@anthropic-plugin-directory']);
    expect(view.skills).toEqual([{ name: 'hello-skill', description: 'hello-skill skill' }]);
  });

  it('공식 디렉터리 플러그인은 바로 설치한다(user 범위, --json)', async () => {
    const { cli, calls } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder() });
    const reply = await svc.install({ id: 'superpowers@anthropic-plugin-directory' });
    expect(reply.ok).toBe(true);
    expect(calls).toContainEqual(['plugin', 'install', 'superpowers@anthropic-plugin-directory', '--scope', 'user', '--json']);
    expect(reply.view.picks.find((p) => p.id === 'superpowers@anthropic-plugin-directory')?.installed).toBe(true);
  });

  it('따로 마켓플레이스가 필요한 플러그인(ponytail)은 마켓플레이스를 먼저 더한다', async () => {
    const { cli, calls } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder() });
    await svc.install({ id: 'ponytail@ponytail', marketplace: 'DietrichGebert/ponytail' });
    const add = calls.findIndex((c) => c[1] === 'marketplace' && c[2] === 'add');
    const install = calls.findIndex((c) => c[1] === 'install');
    expect(calls[add]).toEqual(['plugin', 'marketplace', 'add', 'DietrichGebert/ponytail', '--json']);
    expect(add).toBeLessThan(install);
  });

  it('잘못된 플러그인 id·마켓플레이스는 Claude Code 를 부르기 전에 거절한다', async () => {
    const { cli, calls } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder() });
    expect((await svc.install({ id: '--force@x' })).ok).toBe(false);
    expect((await svc.addMarketplace('file:///etc')).ok).toBe(false);
    expect(calls.filter((c) => c[1] === 'install' || c[2] === 'add')).toEqual([]);
  });

  it('Claude Code 가 실패를 알리면 그 이유를 돌려준다', async () => {
    const { cli } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder() });
    const reply = await svc.install({ id: 'nope@anthropic-plugin-directory' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error).toContain('not found');
  });

  it('끄기·켜기·지우기를 Claude Code 명령으로 한다', async () => {
    const { cli, calls } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder() });
    await svc.install({ id: 'superpowers@anthropic-plugin-directory' });
    await svc.disable('superpowers@anthropic-plugin-directory');
    expect((await svc.list()).installed[0]!.enabled).toBe(false);
    await svc.enable('superpowers@anthropic-plugin-directory');
    await svc.uninstall('superpowers@anthropic-plugin-directory');
    expect(calls.map((c) => c[1])).toEqual(expect.arrayContaining(['disable', 'enable', 'uninstall']));
    expect((await svc.list()).installed).toEqual([]);
  });

  it('팀원 실행에는 켜 둔 플러그인 폴더와(스킬이 있으면) 사용자 스킬 폴더를 붙인다', async () => {
    const { cli } = fakeCli();
    const svc = new PluginService({ cli, skills: skillFolder(['hello-skill']) });
    await svc.install({ id: 'superpowers@anthropic-plugin-directory' });
    await svc.install({ id: 'feature-dev@anthropic-plugin-directory' });
    await svc.disable('feature-dev@anthropic-plugin-directory');
    expect(svc.loads()).toEqual([{ path: 'C:/cfg/plugins/cache/superpowers@anthropic-plugin-directory' }, { path: 'C:/cfg' }]);
  });

  it('사용자 스킬을 지운다(폴더 이름만 받는다)', async () => {
    const { cli } = fakeCli();
    const skills = skillFolder(['hello-skill']);
    const svc = new PluginService({ cli, skills });
    expect((await svc.removeSkill('../x')).ok).toBe(false);
    expect((await svc.removeSkill('hello-skill')).ok).toBe(true);
    expect(skills.removed).toEqual(['hello-skill']);
  });
});
