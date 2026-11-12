/** 설정 → 플러그인·스킬 IPC. 화면은 플러그인 id·마켓플레이스 출처·스킬 이름만 보낸다. 실제 설치는 Claude Code(`claude plugin …`)가 한다. */
export const PLUGIN_IPC = {
  list: 'plugins:list',
  refresh: 'plugins:refresh',
  install: 'plugins:install',
  uninstall: 'plugins:uninstall',
  enable: 'plugins:enable',
  disable: 'plugins:disable',
  addMarketplace: 'plugins:add-marketplace',
  removeMarketplace: 'plugins:remove-marketplace',
  removeSkill: 'plugins:remove-skill',
} as const;

export interface InstalledPluginView {
  readonly id: string;
  readonly version: string | null;
  readonly enabled: boolean;
  readonly description: string | null;
}

export interface AvailablePluginView {
  readonly id: string;
  readonly name: string;
  readonly marketplace: string;
  readonly description: string;
}

export interface MarketplaceView {
  readonly name: string;
  readonly source: string;
}

export interface SkillView {
  readonly name: string;
  readonly description: string;
}

export interface PluginPickView {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly examples: readonly string[];
  readonly note: string | null;
  /** 따로 더할 마켓플레이스(공식 디렉터리면 null) */
  readonly marketplace: string | null;
  readonly installed: boolean;
}

export interface PluginListView {
  readonly picks: readonly PluginPickView[];
  readonly installed: readonly InstalledPluginView[];
  readonly available: readonly AvailablePluginView[];
  readonly marketplaces: readonly MarketplaceView[];
  readonly skills: readonly SkillView[];
  /** 목록을 못 읽었을 때 이유(없으면 null) */
  readonly problem: string | null;
}

export type PluginReply = { readonly ok: true; readonly view: PluginListView } | { readonly ok: false; readonly error: string; readonly view: PluginListView };

export interface PluginApi {
  list(): Promise<PluginListView>;
  /** Claude Code 에 다시 묻는다(마켓플레이스 목록도 새로 받는다) */
  refresh(): Promise<PluginListView>;
  /** 마켓플레이스가 필요하면 먼저 더하고 설치한다 */
  install(input: { id: string; marketplace?: string | null }): Promise<PluginReply>;
  uninstall(id: string): Promise<PluginReply>;
  enable(id: string): Promise<PluginReply>;
  disable(id: string): Promise<PluginReply>;
  addMarketplace(source: string): Promise<PluginReply>;
  removeMarketplace(name: string): Promise<PluginReply>;
  removeSkill(name: string): Promise<PluginReply>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** `claude plugin list --available --json` 의 설치된 것 + 고를 수 있는 것. 이상한 줄은 버린다. */
export function parsePluginList(text: string): { installed: (InstalledPluginView & { readonly installPath: string })[]; available: AvailablePluginView[] } {
  const root = rec(safeJson(text)) ?? {};
  const installed = (Array.isArray(root['installed']) ? root['installed'] : [])
    .map(rec)
    .flatMap((r) => {
      const id = str(r?.['id']);
      const installPath = str(r?.['installPath']);
      if (r === null || id === null || installPath === null) return [];
      // 사용자 범위(user)만 다룬다. 프로젝트·로컬 범위 플러그인은 그 폴더의 Claude Code 가 쓴다.
      if (r['scope'] !== undefined && r['scope'] !== 'user') return [];
      return [{ id, version: str(r['version']), enabled: r['enabled'] === true, description: null, installPath }];
    });
  const available = (Array.isArray(root['available']) ? root['available'] : [])
    .map(rec)
    .flatMap((r) => {
      const id = str(r?.['pluginId']);
      const name = str(r?.['name']);
      const marketplace = str(r?.['marketplaceName']);
      if (id === null || name === null || marketplace === null) return [];
      return [{ id, name, marketplace, description: (str(r?.['description']) ?? '').slice(0, 300) }];
    });
  return { installed, available };
}

/** `claude plugin marketplace list --json` */
export function parseMarketplaces(text: string): MarketplaceView[] {
  const list = safeJson(text);
  return (Array.isArray(list) ? list : []).map(rec).flatMap((r) => {
    const name = str(r?.['name']);
    if (r === null || name === null) return [];
    return [{ name, source: str(r['repo']) ?? str(r['url']) ?? str(r['source']) ?? '' }];
  });
}

/** 설치·지우기·켜기·끄기·마켓플레이스 명령의 결과 줄(--json). 결과 줄이 없으면 실패로 보고 stderr 끝을 이유로 쓴다. */
export function parseCommandResult(stdout: string, stderr: string): { ok: true } | { ok: false; error: string } {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const line of lines) {
    const r = rec(safeJson(line.trim()));
    if (r === null || typeof r['outcome'] !== 'string') continue;
    if (r['outcome'] === 'ok') return { ok: true };
    return { ok: false, error: shortError(str(r['message']) ?? 'Claude Code could not finish this.') };
  }
  const tail = stderr.trim().split(/\r?\n/).slice(-2).join(' ');
  return { ok: false, error: shortError(tail === '' ? 'Claude Code did not answer.' : tail) };
}

/** SKILL.md 앞머리(--- name / description ---)에서 설명. 없으면 빈 글. */
export function skillDescription(markdown: string): string {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const line = head?.[1]?.split(/\r?\n/).find((l) => /^description\s*:/.test(l));
  return (line?.replace(/^description\s*:\s*/, '').replace(/^["']|["']$/g, '').trim() ?? '').slice(0, 300);
}

/** 오류 글: 길이를 줄이고 집 경로 같은 긴 경로는 끝만 남긴다 */
function shortError(text: string): string {
  return text.replace(/[A-Za-z]:\\[^\s'"]+|\/(?:Users|home)\/[^\s'"]+/g, (p) => `…${p.slice(-30)}`).slice(0, 300);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
