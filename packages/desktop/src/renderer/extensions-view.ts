import type { ConnectorApi, ConnectorListView, ConnectorReply, ConnectorView } from '../shared/connector-api.js';
import type { PluginApi, PluginListView, PluginReply } from '../shared/plugin-api.js';
import { AI_PROVIDERS } from '../shared/external-ai.js';
import type { AiStatusView, ExternalAiApi } from '../shared/external-ai-ipc.js';
import { connectorStatusText } from './connectors-view.js';
import { el, isEnterKey } from './dom.js';
import { exampleRow } from './example-chips.js';

/** 분류(왼쪽 목록) */
type Section = 'ai' | 'connectors' | 'mcp' | 'plugins' | 'skills' | 'marketplaces';
const SECTIONS: readonly { readonly id: Section; readonly label: string; readonly hint: string; readonly icon: string }[] = [
  { id: 'ai', label: 'AI accounts', hint: 'Other AIs you can ask from Chat (Kiro, ChatGPT). They sign in with their own apps.', icon: 'M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4z M5 20a7 7 0 0 1 14 0 M18 4l2-1 M6 4L4 3' },
  { id: 'connectors', label: 'Connectors', hint: 'Work apps teammates can read and write in chat', icon: 'M7 7h4v4H7z M13 13h4v4h-4z M11 9h2a2 2 0 0 1 2 2v2' },
  { id: 'mcp', label: 'MCP servers', hint: 'Any remote MCP address (https, sign-in in your browser)', icon: 'M4 6h16v5H4z M4 13h16v5H4z M7 8.5h.01 M7 15.5h.01' },
  { id: 'plugins', label: 'Plugins', hint: 'Claude Code plugins: commands, agents, skills, hooks', icon: 'M9 4h6v3a2 2 0 1 0 0 4v0h3v6h-3a2 2 0 1 0-4 0H6v-6h3a2 2 0 1 0 0-4z' },
  { id: 'skills', label: 'Skills', hint: 'Your own skill folders', icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z' },
  { id: 'marketplaces', label: 'Marketplaces', hint: 'Where plugins come from', icon: 'M4 9l2-5h12l2 5 M4 9h16v10H4z M9 19v-5h6v5' },
];

/** 이름으로 아는 서비스의 색(아이콘 바탕) */
const BRAND: Readonly<Record<string, string>> = {
  notion: '#111111', confluence: '#1868DB', jira: '#0052CC', atlassian: '#0052CC', slack: '#4A154B', github: '#24292F', gitlab: '#E24329', linear: '#5E6AD2', figma: '#F24E1E', sentry: '#362D59', datadog: '#632CA6', google: '#4285F4', gmail: '#EA4335', drive: '#1FA463', asana: '#F06A6A', stripe: '#635BFF', vercel: '#000000', supabase: '#3ECF8E', postgres: '#336791', aws: '#FF9900', playwright: '#2EAD33', context7: '#0EA5E9',
};
/** 이름·설명 낱말로 분류(카드의 칩) */
// 앞에서부터 맞는 첫 분류. 개발 흐름 낱말을 디자인·문서보다 먼저 본다("test-driven", "design the architecture" 같은 말에 속지 않게)
const KINDS: readonly (readonly [RegExp, string])[] = [
  [/notion|confluence|\bwiki\b|google docs|google drive/i, 'Docs & wiki'],
  [/jira|linear|asana|\bissues?\b|ticket/i, 'Issues & tasks'],
  [/slack|gmail|\bmail\b|message/i, 'Messages'],
  [/figma|frontend|\bui\b|\bux\b|design system|screens?\b/i, 'Design'],
  [/github|gitlab|\bgit\b|\bcode\b|review|lint|refactor|debug|develop|feature|typescript|python|java/i, 'Development'],
  [/\btests?\b|playwright|\bqa\b|e2e/i, 'Testing'],
  [/skill/i, 'Skills'],
  [/sentry|datadog|monitor|log|incident/i, 'Monitoring'],
  [/postgres|sql|database|supabase|data\b|analytics/i, 'Data'],
  [/aws|vercel|deploy|docker|cloud|infra/i, 'Cloud & deploy'],
  [/doc|readme|writing|blog/i, 'Writing'],
];
const kindOf = (text: string): string => KINDS.find(([re]) => re.test(text))?.[1] ?? 'Tools';
const brandOf = (text: string): string => {
  const key = Object.keys(BRAND).find((k) => text.toLowerCase().includes(k));
  if (key !== undefined) return BRAND[key] as string;
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 42%)`;
};

function svgIcon(path: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

/** 카드 머리의 둥근 네모 아이콘(서비스 색 + 첫 글자) */
function avatar(name: string): HTMLElement {
  const a = el('span', 'ext-avatar', (name.replace(/^[^A-Za-z0-9가-힣]+/, '')[0] ?? '?').toUpperCase());
  a.style.background = brandOf(name);
  a.setAttribute('aria-hidden', 'true');
  return a;
}

export interface ExtensionsDeps {
  readonly connectors: ConnectorApi;
  readonly plugins: PluginApi;
  /** Kiro · ChatGPT(Codex) 로그인 상태와 로그인·로그아웃 */
  readonly externalAi?: ExternalAiApi;
  /** 예시 요청을 채팅 입력칸에 채운다 */
  readonly toChat?: (text: string) => void;
}

/**
 * 확장 탭(Claude 앱의 연결 화면처럼): 왼쪽 분류 · 오른쪽 카드. 카드마다 아이콘·분류 칩·상태·버튼.
 * 버튼을 누르면 그 카드에서 바로 진행(돌아가는 표시)과 결과(✓ 또는 이유)를 보인다.
 */
export function buildExtensions(deps: ExtensionsDeps) {
  const root = el('section', 'ext');
  let section: Section = 'connectors';
  let connectors: ConnectorListView | null = null;
  let plugins: PluginListView | null = null;
  /** 카드별 진행 중·결과: key → 상태 */
  const busy = new Map<string, string>();
  const done = new Map<string, { ok: boolean; text: string }>();

  const head = el('div', 'rhead');
  head.append(el('b', undefined, 'Extensions'), el('span', 'hint grow', 'Connect work apps and add Claude Code plugins. Teammates use what you turn on from the next request.'));
  const toast = el('div', 'ext-toast');
  toast.hidden = true;
  const nav = el('nav', 'ext-nav');
  nav.setAttribute('aria-label', 'Extension kinds');
  const main = el('div', 'ext-main');
  const body = el('div', 'ext-body');
  body.append(nav, main);
  root.append(head, toast, body);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string, ok = true): void => {
    toast.textContent = text;
    toast.className = `ext-toast ${ok ? 'ok' : 'bad'}`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 6000);
  };

  /** 카드의 버튼 한 개 일: 누른 카드만 돌아가고, 끝나면 그 카드에 결과를 남긴다 */
  const act = <R extends { ok: boolean }>(key: string, label: string, success: string, work: () => Promise<R>, after: (r: R) => void): void => {
    if (busy.has(key)) return;
    busy.set(key, label);
    done.delete(key);
    paint();
    void work()
      .then((r) => {
        after(r);
        const err = r.ok ? null : ((r as unknown as { error?: string }).error ?? 'Something went wrong.');
        done.set(key, { ok: r.ok, text: r.ok ? success : err! });
        say(r.ok ? success : err!, r.ok);
      })
      .catch((e: unknown) => {
        const text = e instanceof Error ? e.message : String(e);
        done.set(key, { ok: false, text });
        say(text, false);
      })
      .finally(() => {
        busy.delete(key);
        paint();
      });
  };

  const btn = (text: string, cls: string, key: string | null, onClick: () => void): HTMLButtonElement => {
    const b = el('button', cls);
    b.type = 'button';
    const working = key !== null ? busy.get(key) : undefined;
    if (working !== undefined) {
      b.disabled = true;
      b.append(el('span', 'spinner'), ` ${working}…`);
    } else b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };

  function card(o: { key: string; name: string; sub?: string; kind: string; desc: string; status?: { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' }; actions: HTMLElement[]; extra?: HTMLElement[] }): HTMLElement {
    const c = el('div', `ext-card${busy.has(o.key) ? ' busy' : ''}`);
    const top = el('div', 'ext-card-top');
    const title = el('div', 'ext-card-title');
    title.append(el('b', undefined, o.name), el('span', 'ext-kind', o.kind));
    if (o.sub !== undefined) title.append(el('span', 'dim ext-sub', o.sub));
    top.append(avatar(o.name), title);
    if (o.status !== undefined) top.append(el('span', `ext-pill ${o.status.tone}`, o.status.text));
    c.append(top, el('div', 'ext-desc', o.desc));
    const r = done.get(o.key);
    if (r !== undefined) c.append(el('div', `ext-result ${r.ok ? 'ok' : 'bad'}`, `${r.ok ? '✓' : '✕'} ${r.text}`));
    if (o.extra !== undefined) c.append(...o.extra);
    const bar = el('div', 'ext-actions');
    bar.append(...o.actions);
    c.append(bar);
    return c;
  }

  const takeConnectors = (r: ConnectorReply): void => void (connectors = r.view);
  const takePlugins = (r: PluginReply): void => void (plugins = r.view);

  function connectorStatus(c: ConnectorView): { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' } {
    return { text: connectorStatusText({ status: c.status, note: null }), tone: c.status === 'connected' ? 'ok' : c.status === 'failed' ? 'bad' : c.status === 'needs-auth' || c.status === 'signing-in' ? 'warn' : 'off' };
  }

  function connectorActions(c: ConnectorView): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (c.status === 'signing-in') out.push(btn('Cancel sign-in', 'btn', null, () => void deps.connectors.cancel(c.id)));
    else if (c.status !== 'connected' && c.status !== 'checking') out.push(btn(c.status === 'needs-auth' ? 'Sign in' : 'Connect', 'btn primary', `c:${c.id}`, () => act(`c:${c.id}`, 'Opening sign-in', `${c.label}: finish signing in in your browser.`, () => deps.connectors.connect(c.id), takeConnectors)));
    out.push(btn('Disconnect', 'btn', `x:${c.id}`, () => act(`x:${c.id}`, 'Disconnecting', `Disconnected ${c.label}.`, () => deps.connectors.remove(c.id), takeConnectors)));
    return out;
  }

  function paintConnectors(): HTMLElement[] {
    if (connectors === null) return [el('div', 'hint pad', 'Reading connectors…')];
    const v = connectors;
    const added = new Map(v.connectors.map((c) => [c.id, c]));
    const cards = v.presets.map((p) => {
      const mine = added.get(p.id);
      const key = `p:${p.id}`;
      if (p.unavailable !== null) return card({ key, name: p.label, kind: kindOf(`${p.label} ${p.covers}`), sub: p.covers, desc: `${p.summary} ${p.unavailable}`, status: { text: 'Coming soon', tone: 'off' }, actions: [], extra: [exampleRow(p.examples, deps.toChat)] });
      if (mine !== undefined) return card({ key, name: p.label, kind: kindOf(`${p.label} ${p.covers}`), sub: p.covers, desc: p.summary, status: connectorStatus(mine), actions: connectorActions(mine), extra: [exampleRow(p.examples, deps.toChat)] });
      return card({ key, name: p.label, kind: kindOf(`${p.label} ${p.covers}`), sub: p.covers, desc: p.summary, status: { text: 'Not connected', tone: 'off' }, actions: [btn('Connect', 'btn primary', key, () => act(key, 'Connecting', `Added ${p.label}. Finish signing in in your browser.`, () => deps.connectors.addPreset(p.id), takeConnectors))], extra: [exampleRow(p.examples, deps.toChat)] });
    });
    const grid = el('div', 'ext-grid');
    grid.append(...cards);
    return [grid];
  }

  function paintMcp(): HTMLElement[] {
    if (connectors === null) return [el('div', 'hint pad', 'Reading MCP servers…')];
    const presetIds = new Set(connectors.presets.map((p) => p.id));
    const custom = connectors.connectors.filter((c) => !presetIds.has(c.id));
    const grid = el('div', 'ext-grid');
    grid.append(...custom.map((c) => card({ key: `m:${c.id}`, name: c.label, kind: kindOf(`${c.label} ${c.url}`), sub: c.url, desc: c.note ?? 'Remote MCP server. Teammates can call its tools in chat; every write asks you first.', status: connectorStatus(c), actions: connectorActions(c) })));
    if (custom.length === 0) grid.append(el('div', 'hint pad', 'No custom MCP servers yet. Add one below.'));
    const form = el('div', 'ext-form');
    const name = el('input');
    name.placeholder = 'Name (e.g. Linear)';
    const url = el('input');
    url.placeholder = 'https://mcp.example.com/mcp';
    const add = (): void => act('add-mcp', 'Adding', `Added ${name.value || 'server'}. Finish signing in in your browser.`, () => deps.connectors.addCustom({ label: name.value, url: url.value }), (r) => {
      takeConnectors(r);
      if (r.ok) name.value = url.value = '';
    });
    url.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) add();
    });
    form.append(el('b', undefined, 'Add an MCP server'), el('span', 'hint', 'Remote MCP over https with OAuth sign-in. Tokens stay with Claude Code in this account’s folder; rauha never sees them.'), name, url, btn('Add server', 'btn primary', 'add-mcp', add));
    return [grid, form];
  }

  function paintPlugins(): HTMLElement[] {
    if (plugins === null) return [el('div', 'hint pad', 'Reading plugins from Claude Code…')];
    const v = plugins;
    const out: HTMLElement[] = [];
    if (v.problem !== null) out.push(el('div', 'err pad', v.problem));
    // 추천
    out.push(el('div', 'ext-h', 'Recommended'));
    const rec = el('div', 'ext-grid');
    rec.append(
      ...v.picks.map((p) => {
        const key = `pi:${p.id}`;
        const inst = v.installed.find((i) => i.id === p.id);
        return card({
          key,
          name: p.label,
          kind: kindOf(`${p.label} ${p.summary}`),
          sub: p.id,
          desc: p.note !== null ? `${p.summary} ${p.note}` : p.summary,
          status: p.installed ? { text: inst?.enabled === false ? 'Installed · off' : 'Installed', tone: inst?.enabled === false ? 'off' : 'ok' } : { text: 'Not installed', tone: 'off' },
          actions: p.installed ? [] : [btn('Install', 'btn primary', key, () => act(key, 'Installing', `Installed ${p.label}. Teammates load it from the next request.`, () => deps.plugins.install({ id: p.id, marketplace: p.marketplace }), takePlugins))],
          extra: [exampleRow(p.examples, deps.toChat)],
        });
      }),
    );
    out.push(rec);
    // 설치된 것
    out.push(el('div', 'ext-h', `Installed (${v.installed.length})`));
    const inst = el('div', 'ext-grid');
    if (v.installed.length === 0) inst.append(el('div', 'hint pad', 'No plugins installed yet. Install one above or find one below.'));
    inst.append(
      ...v.installed.map((p) => {
        const key = `pl:${p.id}`;
        const [name, market] = p.id.split('@');
        return card({
          key,
          name: name ?? p.id,
          kind: kindOf(`${p.id} ${p.description ?? ''}`),
          sub: `${market ?? ''}${p.version !== null ? ` · v${p.version}` : ''}`,
          desc: p.description ?? 'Installed from your marketplaces.',
          status: p.enabled ? { text: 'On', tone: 'ok' } : { text: 'Off', tone: 'off' },
          actions: [
            btn(p.enabled ? 'Turn off' : 'Turn on', 'btn', key, () => act(key, p.enabled ? 'Turning off' : 'Turning on', `${name} is ${p.enabled ? 'off' : 'on'}.`, () => (p.enabled ? deps.plugins.disable(p.id) : deps.plugins.enable(p.id)), takePlugins)),
            btn('Uninstall', 'btn', `u:${p.id}`, () => act(`u:${p.id}`, 'Uninstalling', `Uninstalled ${name}.`, () => deps.plugins.uninstall(p.id), takePlugins)),
          ],
        });
      }),
    );
    out.push(inst);
    // 찾기
    out.push(el('div', 'ext-h', `Browse (${v.available.length})`));
    const search = el('input', 'ext-search');
    search.placeholder = 'Search plugins by name or what they do';
    search.value = browseQuery;
    const grid = el('div', 'ext-grid');
    const paintBrowse = (): void => {
      const q = search.value.trim().toLowerCase();
      browseQuery = search.value;
      const list = v.available.filter((a) => q === '' || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)).slice(0, 60);
      grid.replaceChildren(
        ...(list.length === 0
          ? [el('div', 'hint pad', 'No plugins match.')]
          : list.map((a) => {
              const key = `pa:${a.id}`;
              return card({ key, name: a.name, kind: kindOf(`${a.name} ${a.description}`), sub: a.marketplace, desc: a.description || 'No description.', actions: [btn('Install', 'btn primary', key, () => act(key, 'Installing', `Installed ${a.name}. Teammates load it from the next request.`, () => deps.plugins.install({ id: a.id }), takePlugins))] });
            })),
      );
    };
    search.addEventListener('input', paintBrowse);
    paintBrowse();
    out.push(search, grid);
    return out;
  }
  let browseQuery = '';

  function paintSkills(): HTMLElement[] {
    if (plugins === null) return [el('div', 'hint pad', 'Reading skills…')];
    const grid = el('div', 'ext-grid');
    if (plugins.skills.length === 0) grid.append(el('div', 'hint pad', 'No skills of your own yet. Skills come with plugins, or from folders in this account’s Claude Code skills folder.'));
    grid.append(...plugins.skills.map((s) => card({ key: `s:${s.name}`, name: s.name, kind: kindOf(`${s.name} ${s.description}`), desc: s.description || 'No description.', status: { text: 'Ready', tone: 'ok' }, actions: [btn('Move to trash', 'btn', `s:${s.name}`, () => act(`s:${s.name}`, 'Removing', `Moved ${s.name} to the trash.`, () => deps.plugins.removeSkill(s.name), takePlugins))] })));
    return [grid];
  }

  function paintMarketplaces(): HTMLElement[] {
    if (plugins === null) return [el('div', 'hint pad', 'Reading marketplaces…')];
    const grid = el('div', 'ext-grid');
    grid.append(card({ key: 'mk:official', name: 'Anthropic plugin directory', kind: 'Built in', desc: 'Anthropic’s official directory. Always available.', status: { text: 'Built in', tone: 'ok' }, actions: [] }));
    grid.append(...plugins.marketplaces.map((m) => card({ key: `mk:${m.name}`, name: m.name, kind: 'Marketplace', sub: m.source, desc: `Plugins from ${m.source || m.name}.`, actions: [btn('Remove', 'btn', `mk:${m.name}`, () => act(`mk:${m.name}`, 'Removing', `Removed ${m.name}.`, () => deps.plugins.removeMarketplace(m.name), takePlugins))] })));
    const form = el('div', 'ext-form');
    const src = el('input');
    src.placeholder = 'owner/repo or https://… marketplace';
    const add = (): void => act('add-mk', 'Adding', 'Added the marketplace. Its plugins show under Plugins → Browse.', () => deps.plugins.addMarketplace(src.value), (r) => {
      takePlugins(r);
      if (r.ok) src.value = '';
    });
    src.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) add();
    });
    form.append(el('b', undefined, 'Add a marketplace'), src, btn('Add', 'btn primary', 'add-mk', add));
    return [grid, form];
  }

  /** AI accounts: 설치·로그인 상태, 로그인(새 터미널 창)·계정 바꾸기·로그아웃. 로그인은 각 CLI 가 하고 rauha 는 토큰을 읽지 않는다 */
  function paintAi(): HTMLElement[] {
    const ai = deps.externalAi;
    if (ai === undefined) return [el('div', 'dim pad', 'Not available here.')];
    if (aiStatus === null) {
      void loadAi();
      return [el('div', 'dim pad', 'Checking sign-in…')];
    }
    const grid = el('div', 'ext-grid');
    for (const p of AI_PROVIDERS) {
      const s = aiStatus.find((x) => x.id === p.id);
      const key = `ai-${p.id}`;
      const signIn = (label: string): HTMLButtonElement =>
        btn(label, 'btn primary', key, () =>
          act(key, 'Opening', `A terminal opened for ${p.label}. Finish signing in there (a browser may open), then press Check again.`, () => ai.login(p.id), () => undefined),
        );
      const actions: HTMLElement[] = [];
      let status: { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' };
      if (s === undefined || !s.installed) {
        status = { text: 'Not installed', tone: 'off' };
      } else if (!s.signedIn) {
        status = { text: 'Signed out', tone: 'warn' };
        actions.push(signIn('Sign in'));
      } else {
        status = { text: 'Signed in', tone: 'ok' };
        actions.push(
          btn('Sign out', 'btn', `${key}-out`, () => act(`${key}-out`, 'Signing out', `Signed out of ${p.label}.`, () => ai.logout(p.id), () => void loadAi())),
          signIn('Switch account'),
        );
      }
      const desc = s?.installed === false ? p.install : s?.signedIn === true ? `Pick ${p.label} in the Chat tab’s AI menu to ask it. It answers read-only: it cannot change your files.` : 'Sign in once. The sign-in is kept by the app itself, so rauha never sees your password or token.';
      grid.append(card({ key, name: p.label, sub: s?.who === '' || s === undefined ? p.note : s.who, kind: 'AI', desc, status, actions }));
    }
    const again = btn('Check sign-in again', 'btn sm', 'ai-check', () => act('ai-check', 'Checking', 'Checked.', async () => (await loadAi(), { ok: true }), () => undefined));
    return [grid, again];
  }
  let aiStatus: readonly AiStatusView[] | null = null;
  let aiLoading = false;
  async function loadAi(): Promise<void> {
    if (deps.externalAi === undefined || aiLoading) return;
    aiLoading = true;
    try {
      aiStatus = await deps.externalAi.status();
    } finally {
      aiLoading = false;
    }
    paint();
  }

  function counts(id: Section): string {
    if (id === 'ai') return aiStatus === null ? '' : String(aiStatus.filter((s) => s.signedIn).length);
    if (id === 'connectors') return connectors === null ? '' : String(connectors.connectors.filter((c) => connectors!.presets.some((p) => p.id === c.id)).length);
    if (id === 'mcp') return connectors === null ? '' : String(connectors.connectors.filter((c) => !connectors!.presets.some((p) => p.id === c.id)).length);
    if (id === 'plugins') return plugins === null ? '' : String(plugins.installed.length);
    if (id === 'skills') return plugins === null ? '' : String(plugins.skills.length);
    return plugins === null ? '' : String(plugins.marketplaces.length + 1);
  }

  function paint(): void {
    nav.replaceChildren(
      ...SECTIONS.map((s) => {
        const b = el('button', `ext-nav-item${s.id === section ? ' on' : ''}`);
        b.type = 'button';
        b.title = s.hint;
        const ic = el('span', 'ext-nav-icon');
        ic.append(svgIcon(s.icon));
        b.append(ic, el('span', 'grow', s.label), el('span', 'dim', counts(s.id)));
        b.addEventListener('click', () => ((section = s.id), paint()));
        return b;
      }),
    );
    const meta = SECTIONS.find((s) => s.id === section)!;
    const title = el('div', 'ext-title');
    title.append(el('b', undefined, meta.label), el('span', 'hint', meta.hint));
    const refresh = btn('Check again', 'btn sm', 'refresh', () =>
      act('refresh', 'Checking', 'Up to date.', async () => {
        [connectors, plugins] = await Promise.all([deps.connectors.refresh(), deps.plugins.refresh()]);
        return { ok: true };
      }, () => undefined),
    );
    title.append(refresh);
    const content = section === 'ai' ? paintAi() : section === 'connectors' ? paintConnectors() : section === 'mcp' ? paintMcp() : section === 'plugins' ? paintPlugins() : section === 'skills' ? paintSkills() : paintMarketplaces();
    main.replaceChildren(title, ...content);
  }

  paint();
  const stop = deps.connectors.onChange((next) => {
    if (!root.isConnected && connectors !== null) return stop();
    connectors = next;
    paint();
  });
  void deps.connectors.list().then((v) => ((connectors = v), paint()), (e: unknown) => say(e instanceof Error ? e.message : String(e), false));
  void deps.plugins.list().then((v) => ((plugins = v), paint()), (e: unknown) => say(e instanceof Error ? e.message : String(e), false));
  return { root };
}
