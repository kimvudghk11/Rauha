import { MarketplaceName, MarketplaceSource, PluginId, PluginPick, SkillName, type PluginLoad } from '@rauha/core';
import { parseCommandResult, parseMarketplaces, parsePluginList, type InstalledPluginView, type PluginListView, type PluginReply, type SkillView } from '../../shared/plugin-api.js';

/** Claude Code 명령(`claude plugin …`)을 지금 계정의 설정 폴더로 돌린다. */
export interface PluginCli {
  run(args: readonly string[]): Promise<{ stdout: string; stderr: string }>;
}

/** 사용자 스킬 폴더(<설정 폴더>/skills) */
export interface SkillFolder {
  /** 설정 폴더(이 폴더를 플러그인처럼 붙이면 skills/ 아래 스킬이 팀원에게 보인다) */
  root(): Promise<string>;
  list(): Promise<SkillView[]>;
  remove(name: SkillName): Promise<void>;
}

export interface PluginServiceDeps {
  readonly cli: PluginCli;
  readonly skills: SkillFolder;
}

interface Snapshot {
  readonly installed: readonly (InstalledPluginView & { readonly installPath: string })[];
  readonly view: Omit<PluginListView, 'picks'>;
  readonly skillRoot: string | null;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * 설정 → 플러그인·스킬. Claude Code 와 같은 마켓플레이스·설치 방식을 그대로 쓴다(rauha 는 명령을 대신 누를 뿐).
 * 계정 로그인 토큰은 읽지 않는다. 팀원을 띄울 때 켜 둔 플러그인과 사용자 스킬 폴더를 붙인다(loads).
 */
export class PluginService {
  private snapshot: Snapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PluginServiceDeps) {}

  async list(): Promise<PluginListView> {
    return this.view(this.snapshot ?? (await this.read()));
  }

  async refresh(): Promise<PluginListView> {
    return this.view(await this.read());
  }

  /** 팀원 세션에 붙일 폴더: 켜 둔 플러그인 + (스킬이 있으면) 사용자 설정 폴더. 아직 못 읽었으면 없음. */
  loads(): PluginLoad[] {
    const snap = this.snapshot;
    if (snap === null) return [];
    const plugins = snap.installed.filter((p) => p.enabled).map((p) => ({ path: p.installPath }));
    return snap.skillRoot !== null && snap.view.skills.length > 0 ? [...plugins, { path: snap.skillRoot }] : plugins;
  }

  install(input: unknown): Promise<PluginReply> {
    return this.change(async () => {
      const raw = typeof input === 'object' && input !== null ? (input as { id?: unknown; marketplace?: unknown }) : {};
      const id = PluginId.of(typeof raw.id === 'string' ? raw.id : '');
      const source = typeof raw.marketplace === 'string' && raw.marketplace !== '' ? MarketplaceSource.of(raw.marketplace) : null;
      if (source !== null && !(this.snapshot?.view.marketplaces ?? []).some((m) => m.name === id.marketplace)) await this.command(['plugin', 'marketplace', 'add', source.value, '--json']);
      await this.command(['plugin', 'install', id.value, '--scope', 'user', '--json']);
    });
  }

  uninstall(id: unknown): Promise<PluginReply> {
    return this.change(() => this.command(['plugin', 'uninstall', PluginId.of(String(id)).value, '--scope', 'user', '--json']));
  }

  enable(id: unknown): Promise<PluginReply> {
    return this.change(() => this.command(['plugin', 'enable', PluginId.of(String(id)).value, '--scope', 'user', '--json']));
  }

  disable(id: unknown): Promise<PluginReply> {
    return this.change(() => this.command(['plugin', 'disable', PluginId.of(String(id)).value, '--scope', 'user', '--json']));
  }

  addMarketplace(source: unknown): Promise<PluginReply> {
    return this.change(() => this.command(['plugin', 'marketplace', 'add', MarketplaceSource.of(String(source)).value, '--json']));
  }

  removeMarketplace(name: unknown): Promise<PluginReply> {
    return this.change(() => this.command(['plugin', 'marketplace', 'remove', MarketplaceName.of(String(name)).value, '--json']));
  }

  removeSkill(name: unknown): Promise<PluginReply> {
    return this.change(() => this.deps.skills.remove(SkillName.of(String(name))));
  }

  /** 명령은 하나씩(설정 파일을 같이 고치지 않게). 끝나면 목록을 다시 읽는다. */
  private change(work: () => Promise<void>): Promise<PluginReply> {
    const next = this.queue.then(async (): Promise<PluginReply> => {
      try {
        await work();
        return { ok: true, view: this.view(await this.read()) };
      } catch (e) {
        return { ok: false, error: errorText(e), view: this.view(this.snapshot ?? (await this.read())) };
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async command(args: readonly string[]): Promise<void> {
    const { stdout, stderr } = await this.deps.cli.run(args);
    const result = parseCommandResult(stdout, stderr);
    if (!result.ok) throw new Error(result.error);
  }

  private async read(): Promise<Snapshot> {
    try {
      const [plugins, markets, skills, root] = await Promise.all([
        this.deps.cli.run(['plugin', 'list', '--available', '--json']),
        this.deps.cli.run(['plugin', 'marketplace', 'list', '--json']),
        this.deps.skills.list().catch(() => []),
        this.deps.skills.root().catch(() => null),
      ]);
      const list = parsePluginList(plugins.stdout);
      const installedIds = new Set(list.installed.map((p) => p.id));
      const descriptions = new Map(list.available.map((a) => [a.id, a.description]));
      this.snapshot = {
        installed: list.installed,
        skillRoot: root,
        view: {
          installed: list.installed.map(({ installPath: _, ...p }) => ({ ...p, description: descriptions.get(p.id) ?? null })),
          available: list.available.filter((a) => !installedIds.has(a.id)),
          marketplaces: parseMarketplaces(markets.stdout),
          skills,
          problem: null,
        },
      };
    } catch (e) {
      this.snapshot = { installed: [], skillRoot: null, view: { installed: [], available: [], marketplaces: [], skills: [], problem: errorText(e) } };
    }
    return this.snapshot;
  }

  private view(snap: Snapshot): PluginListView {
    const installed = new Set(snap.installed.map((p) => p.id));
    return {
      picks: PluginPick.all().map((p) => ({ id: p.id.value, label: p.label, summary: p.summary, examples: p.examples, note: p.note, marketplace: p.marketplace?.value ?? null, installed: installed.has(p.id.value) })),
      ...snap.view,
    };
  }
}
