import type { PluginApi, PluginListView, PluginReply } from '../shared/plugin-api.js';
import { el, isEnterKey } from './dom.js';
import { exampleRow } from './example-chips.js';

/** 고를 수 있는 플러그인 목록에서 한 번에 보일 개수(나머지는 찾기로) */
const AVAILABLE_SHOWN = 30;

/**
 * 설정 → 플러그인·스킬. Claude Code 의 /plugin 과 같은 일을 한다: 추천(엄선), 설치된 것 켜기·끄기·지우기,
 * 마켓플레이스에서 찾아 설치, 마켓플레이스 더하기·빼기, 사용자 스킬 보기·지우기. 실제 일은 Claude Code 명령이 한다.
 */
export function buildPlugins(api: PluginApi, toChat?: (text: string) => void) {
  const root = el('div', 'plugins');
  const intro = el('div', 'hint pad', 'Plugins and skills work the same way as in Claude Code and are installed into this account\'s Claude Code folder. Teammates that do the actual work (answers, code, tests, debugging, design, docs, review) load the ones you turn on. Apply from the next request.');
  const status = el('div', 'err pad');
  const busy = el('div', 'dim pad');
  const picks = el('div', 'tlist');
  const installed = el('div', 'tlist');
  const search = el('input');
  search.placeholder = 'Find a plugin in your marketplaces';
  const available = el('div', 'tlist');
  const markets = el('div', 'tlist');
  const marketInput = el('input');
  marketInput.placeholder = 'owner/repo or https://… marketplace';
  const addMarket = el('button', 'btn', 'Add marketplace');
  const marketRow = el('div', 'srow');
  marketRow.append(marketInput, addMarket);
  const skills = el('div', 'tlist');
  const refresh = el('button', 'btn', 'Check again');
  root.append(
    intro, status, busy,
    el('div', 'ph', 'Recommended'), picks,
    el('div', 'ph', 'Installed'), installed,
    el('div', 'ph', 'Browse'), search, available,
    el('div', 'ph', 'Marketplaces'), markets, marketRow,
    el('div', 'ph', 'Your skills'), skills,
    refresh,
  );

  let view: PluginListView | null = null;

  const run = (label: string, work: () => Promise<PluginReply>): void => {
    busy.replaceChildren(el('span', 'spinner'), ` ${label}…`);
    void work().then(
      (reply) => {
        busy.textContent = '';
        status.textContent = reply.ok ? '' : reply.error;
        paint(reply.view);
      },
      (e: unknown) => {
        busy.textContent = '';
        status.textContent = e instanceof Error ? e.message : String(e);
      },
    );
  };

  const button = (text: string, cls: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  function paintAvailable(): void {
    if (view === null) return;
    const q = search.value.trim().toLowerCase();
    const list = view.available.filter((a) => q === '' || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)).slice(0, AVAILABLE_SHOWN);
    available.replaceChildren(
      ...(list.length === 0
        ? [el('div', 'dim pad', 'No plugins match.')]
        : list.map((a) => {
            const row = el('div', 'srow');
            const label = el('span', 'lbl');
            label.append(el('b', undefined, a.name), el('span', 'dim', ` ${a.marketplace} — ${a.description}`));
            row.append(label, button('Install', 'btn', () => run(`Installing ${a.name}`, () => api.install({ id: a.id }))));
            return row;
          })),
    );
  }

  function paint(next: PluginListView): void {
    view = next;
    if (next.problem !== null) status.textContent = next.problem;
    picks.replaceChildren(
      ...next.picks.map((p) => {
        const wrap = el('div');
        const row = el('div', 'srow');
        const label = el('span', 'lbl');
        label.append(el('b', undefined, p.label), el('span', 'dim', ` ${p.id}`));
        const install = button(p.installed ? 'Installed' : 'Install', 'btn primary', () => run(`Installing ${p.label}`, () => api.install({ id: p.id, marketplace: p.marketplace })));
        install.disabled = p.installed;
        row.append(label, install);
        wrap.append(row, el('div', 'hint pad', p.summary), ...(p.note !== null ? [el('div', 'hint pad', p.note)] : []), exampleRow(p.examples, toChat));
        return wrap;
      }),
    );
    installed.replaceChildren(
      ...(next.installed.length === 0
        ? [el('div', 'dim pad', 'No plugins installed yet.')]
        : next.installed.map((p) => {
            const row = el('div', 'srow');
            const label = el('span', 'lbl');
            label.append(el('b', undefined, p.id), el('span', 'dim', ` ${p.version ?? ''}${p.description !== null ? ` — ${p.description}` : ''}`));
            const toggle = el('input');
            toggle.type = 'checkbox';
            toggle.checked = p.enabled;
            toggle.title = p.enabled ? 'On' : 'Off';
            toggle.addEventListener('change', () => run(toggle.checked ? 'Turning on' : 'Turning off', () => (toggle.checked ? api.enable(p.id) : api.disable(p.id))));
            row.append(label, toggle, button('Uninstall', 'btn', () => run(`Uninstalling ${p.id}`, () => api.uninstall(p.id))));
            return row;
          })),
    );
    paintAvailable();
    markets.replaceChildren(
      el('div', 'dim pad', 'anthropic-plugin-directory — Anthropic\'s official directory (built in)'),
      ...next.marketplaces.map((m) => {
        const row = el('div', 'srow');
        const label = el('span', 'lbl');
        label.append(el('b', undefined, m.name), el('span', 'dim', ` ${m.source}`));
        row.append(label, button('Remove', 'btn', () => run(`Removing ${m.name}`, () => api.removeMarketplace(m.name))));
        return row;
      }),
    );
    skills.replaceChildren(
      ...(next.skills.length === 0
        ? [el('div', 'dim pad', 'No skills of your own yet. Skills come from plugins above, or from folders in this account\'s Claude Code skills folder.')]
        : next.skills.map((s) => {
            const row = el('div', 'srow');
            const label = el('span', 'lbl');
            label.append(el('b', undefined, s.name), el('span', 'dim', ` ${s.description}`));
            row.append(label, button('Move to trash', 'btn', () => run(`Removing ${s.name}`, () => api.removeSkill(s.name))));
            return row;
          })),
    );
  }

  search.addEventListener('input', paintAvailable);
  const add = (): void => {
    const source = marketInput.value;
    run('Adding marketplace', () => api.addMarketplace(source).then((r) => (r.ok && (marketInput.value = ''), r)));
  };
  addMarket.addEventListener('click', add);
  marketInput.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) add();
  });
  refresh.addEventListener('click', () => {
    busy.replaceChildren(el('span', 'spinner'), ' Checking…');
    void api.refresh().then((v) => ((busy.textContent = ''), paint(v)));
  });

  busy.replaceChildren(el('span', 'spinner'), ' Reading plugins…');
  void api.list().then(
    (v) => ((busy.textContent = ''), paint(v)),
    (e: unknown) => ((busy.textContent = ''), (status.textContent = e instanceof Error ? e.message : String(e))),
  );
  return { root };
}
