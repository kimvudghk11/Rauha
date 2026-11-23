import { AWS_CLI_INSTALL_URL, type AwsApi, type AwsProfilesView, type AwsResult, type AwsWho } from '../shared/aws-api.js';
import type { VpnApi, VpnListView, VpnProfileView } from '../shared/vpn-api.js';
import { el } from './dom.js';
import { askDialog } from './git-common.js';
import { button, chipOf } from './todo-parts.js';

export interface AwsViewDeps {
  readonly vpn: VpnApi;
  readonly aws: AwsApi;
  readonly now?: () => number;
}

const PHASE: Readonly<Record<string, readonly [string, string]>> = {
  off: ['Off', ''],
  connecting: ['Connecting', 'yellow'],
  connected: ['Connected', 'green'],
  failed: ['Failed', 'red'],
};

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** 화면 한 번에 하나만 구독한다(preload 창구가 하나라서) */
const sinks = new WeakMap<VpnApi, { current: ((l: VpnListView) => void) | null }>();
function vpnSink(api: VpnApi): { current: ((l: VpnListView) => void) | null } {
  let s = sinks.get(api);
  if (s === undefined) {
    const made: { current: ((l: VpnListView) => void) | null } = { current: null };
    api.onChanged((l) => made.current?.(l));
    sinks.set(api, made);
    s = made;
  }
  return s;
}

/**
 * AWS 탭: 위는 VPN(.ovpn 넣기 → 연결·끊기·상태), 아래는 AWS 계정(프로필별 누구인지 확인·SSO 로그인).
 * 화면은 그리기만 한다. .ovpn 해석·암호화·OpenVPN 조종은 main, 규칙은 shared.
 */
export function buildAws(deps: AwsViewDeps) {
  const now = deps.now ?? Date.now;
  const root = el('section', 'awsv');
  const head = el('div', 'rhead');
  head.append(el('b', undefined, 'AWS'), el('span', 'hint', 'Connect the company VPN and check which AWS account each profile signs in to.'));
  const notice = el('div', 'notice');
  notice.hidden = true;
  const say = (text: string): void => {
    notice.textContent = text;
    notice.hidden = text === '';
  };

  // ── VPN ──
  const vpnBox = el('div', 'aw-section');
  const vpnHead = el('div', 'aw-sh');
  const addBtn = button('Add .ovpn', 'btn sm', () => void pick());
  vpnHead.append(el('b', undefined, 'VPN'), el('span', 'hint grow', 'AWS Client VPN and other OpenVPN profiles (certificate sign-in).'), addBtn);
  const engineHost = el('div');
  const vpnList = el('div', 'aw-list');
  const drop = el('div', 'aw-drop', 'Drop a .ovpn file here');
  const vpnFoot = el('div', 'hint aw-foot', 'The profile, including its private key, is locked with your computer’s encryption (Windows DPAPI / macOS Keychain). It is never sent to Claude, logs or reports. Quitting rauha disconnects the VPN.');
  vpnBox.append(vpnHead, engineHost, vpnList, drop, vpnFoot);

  let list: VpnListView | null = null;
  const busy = new Set<string>();
  let tick: ReturnType<typeof setInterval> | null = null;

  async function pick(): Promise<void> {
    const r = await deps.vpn.pick();
    if (!r.ok) say(r.error);
    else {
      say('');
      if (r.data !== null) await refreshVpn();
    }
  }

  async function act(id: string, run: () => Promise<{ ok: boolean; error?: string }>): Promise<void> {
    busy.add(id);
    paintVpn();
    try {
      const r = await run();
      say(r.ok ? '' : (r.error ?? 'Failed.'));
    } finally {
      busy.delete(id);
      await refreshVpn();
    }
  }

  function card(p: VpnProfileView): HTMLElement {
    // 'off' 는 공통 .item.off(흐리게)와 겹치므로 aw- 접두어를 붙인다
    const c = el('div', `item aw-vpn aw-${p.status.phase}`);
    const top = el('div', 'aw-row');
    const [label, tone] = PHASE[p.status.phase] ?? ['Off', ''];
    const dot = el('span', `aw-dot aw-${p.status.phase}`);
    const name = el('b', 'aw-name', p.summary.name);
    name.title = p.summary.server;
    const chips = el('span', 'aw-chips');
    chips.append(chipOf(label, tone));
    if (p.summary.aws) chips.append(chipOf('AWS Client VPN', 'blue'));
    chips.append(chipOf(p.summary.allTraffic ? 'All traffic' : `Only ${p.summary.routes.join(', ')}`));
    if (!p.saved) chips.append(chipOf('Not saved', 'yellow'));
    const actions = el('span', 'aw-actions');
    const working = busy.has(p.id);
    const active = p.status.phase === 'connecting' || p.status.phase === 'connected';
    const main = active
      ? button(p.status.phase === 'connecting' ? 'Cancel' : 'Disconnect', 'btn sm', () => void act(p.id, () => deps.vpn.disconnect(p.id)))
      : button('Connect', 'btn sm primary', () => void act(p.id, () => deps.vpn.connect(p.id)));
    main.disabled = working || (!active && list?.engine.installed !== true);
    const rename = button('Rename', 'btn sm ghost', () => {
      void askDialog({ title: 'Rename VPN', input: { label: 'Name', value: p.summary.name }, okLabel: 'Rename' }).then((a) => {
        if (a.ok) void act(p.id, () => deps.vpn.rename({ id: p.id, name: a.value }));
      });
    });
    const remove = button('Remove', 'btn sm ghost', () => {
      void askDialog({ title: `Remove "${p.summary.name}"?`, body: 'The saved profile and its key are deleted from this computer. Your original .ovpn file is not touched.', okLabel: 'Remove', danger: true }).then((a) => {
        if (a.ok) void act(p.id, () => deps.vpn.remove(p.id));
      });
    });
    rename.disabled = working;
    remove.disabled = working;
    actions.append(main, rename, remove);
    top.append(dot, name, chips, actions);
    const sub = el('div', 'hint aw-sub');
    const parts: string[] = [];
    if (p.status.phase === 'connected') {
      if (p.status.ip !== null) parts.push(`VPN address ${p.status.ip}`);
      if (p.status.since !== null) parts.push(`for ${ago(now() - p.status.since)}`);
    } else if (p.status.detail !== '') parts.push(p.status.detail);
    parts.push(`${p.summary.server}:${p.summary.port}/${p.summary.proto}`);
    sub.textContent = parts.join(' · ');
    if (p.status.phase === 'failed') sub.classList.add('aw-err');
    c.append(top, sub);
    return c;
  }

  function paintVpn(): void {
    engineHost.replaceChildren();
    if (list === null) {
      vpnList.replaceChildren(el('div', 'hint', 'Loading…'));
      return;
    }
    if (!list.engine.installed) {
      const box = el('div', 'item aw-engine');
      const b = button('Install OpenVPN', 'btn sm primary', () => {
        b.disabled = true;
        b.textContent = 'Installing…';
        void deps.vpn.install().then((r) => {
          say(r.ok ? '' : r.error);
          void refreshVpn();
        });
      });
      b.disabled = !list.engine.canInstall;
      box.append(el('span', 'grow', `OpenVPN is needed to connect. ${list.engine.installHint}`), b);
      engineHost.append(box);
    }
    if (list.profiles.length === 0) {
      const empty = el('div', 'empty-state');
      empty.append(el('b', undefined, 'No VPN yet'), el('span', 'hint', 'Add the .ovpn file you got for the company VPN (AWS console → Client VPN endpoints → Download client configuration, with your certificate and key inside).'));
      vpnList.replaceChildren(empty);
    } else vpnList.replaceChildren(...list.profiles.map(card));
    // 연결된 시간이 흐르게, 연결돼 있을 때만 초마다 다시 그린다
    const live = list.profiles.some((p) => p.status.phase !== 'off');
    if (live && tick === null) tick = setInterval(() => (root.isConnected ? paintVpn() : stopTick()), 1000);
    if (!live) stopTick();
  }
  function stopTick(): void {
    if (tick !== null) clearInterval(tick);
    tick = null;
  }

  async function refreshVpn(): Promise<void> {
    list = await deps.vpn.list();
    paintVpn();
  }

  // 끌어 놓기: 파일 내용을 읽어 main 으로 보낸다(경로가 아니라 내용 — 화면은 파일 시스템에 손대지 않는다)
  const over = (e: DragEvent): void => {
    if (e.dataTransfer?.types.includes('Files') !== true) return;
    e.preventDefault();
    drop.classList.add('on');
  };
  vpnBox.addEventListener('dragover', over);
  vpnBox.addEventListener('dragenter', over);
  vpnBox.addEventListener('dragleave', (e) => {
    if (e.target === vpnBox || e.target === drop) drop.classList.remove('on');
  });
  vpnBox.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('on');
    const files = [...(e.dataTransfer?.files ?? [])];
    void (async () => {
      for (const f of files) {
        if (f.size > 200_000) {
          say(`${f.name}: too large to be a VPN profile.`);
          continue;
        }
        const r = await deps.vpn.addText({ name: f.name, text: await f.text() });
        say(r.ok ? '' : `${f.name}: ${r.error}`);
      }
      await refreshVpn();
    })();
  });
  drop.addEventListener('click', () => void pick());

  // ── AWS 계정 ──
  const accBox = el('div', 'aw-section');
  const accHead = el('div', 'aw-sh');
  const setupBtn = button('Set up SSO profile', 'btn sm', () => void deps.aws.configureSso().then((r) => say(r.ok ? 'Follow the steps in the terminal window, then press Refresh.' : r.error)));
  const refreshBtn = button('Refresh', 'btn sm ghost', () => void refreshAccounts());
  accHead.append(el('b', undefined, 'Accounts'), el('span', 'hint grow', 'Profiles from ~/.aws. rauha never reads keys or tokens; it asks the AWS CLI who you are.'), setupBtn, refreshBtn);
  const accList = el('div', 'aw-list');
  accBox.append(accHead, accList);
  let profiles: AwsProfilesView | null = null;
  const whoBy = new Map<string, AwsResult<AwsWho> | 'checking'>();

  function accRow(p: AwsProfilesView['profiles'][number]): HTMLElement {
    const row = el('div', 'item aw-acc');
    const top = el('div', 'aw-row');
    const chips = el('span', 'aw-chips');
    if (p.region !== null) chips.append(chipOf(p.region));
    if (p.sso) chips.append(chipOf('SSO', 'blue'));
    if (p.keys) chips.append(chipOf('Access keys', 'purple'));
    const actions = el('span', 'aw-actions');
    const state = whoBy.get(p.name);
    const check = button(state === 'checking' ? 'Checking…' : 'Who am I', 'btn sm', () => void checkWho(p.name));
    check.disabled = state === 'checking' || profiles?.cli === null;
    actions.append(check);
    if (p.sso) {
      const login = button('Sign in', 'btn sm primary', () => void deps.aws.ssoLogin(p.name).then((r) => say(r.ok ? `Finish signing in to ${p.name} in the browser, then press Who am I.` : r.error)));
      login.disabled = profiles?.cli === null;
      actions.append(login);
    }
    top.append(el('b', 'aw-name', p.name), chips, actions);
    row.append(top);
    if (state !== undefined && state !== 'checking') {
      const sub = el('div', `hint aw-sub${state.ok ? '' : ' aw-err'}`);
      sub.textContent = state.ok ? `Account ${state.data.account} · ${state.data.who}` : state.needsLogin === true ? `${state.error} Press Sign in.` : state.error;
      row.append(sub);
    }
    return row;
  }

  async function checkWho(name: string): Promise<void> {
    whoBy.set(name, 'checking');
    paintAccounts();
    whoBy.set(name, await deps.aws.who(name));
    paintAccounts();
  }

  function paintAccounts(): void {
    if (profiles === null) {
      accList.replaceChildren(el('div', 'hint', 'Loading…'));
      return;
    }
    const rows: HTMLElement[] = [];
    if (profiles.cli === null) {
      const box = el('div', 'item aw-engine');
      const link = el('a', 'btn sm', 'How to install');
      link.href = AWS_CLI_INSTALL_URL;
      link.target = '_blank';
      box.append(el('span', 'grow', 'The AWS CLI is not installed, so rauha cannot check accounts or sign in.'), link);
      rows.push(box);
    }
    if (profiles.profiles.length === 0) {
      const empty = el('div', 'empty-state');
      empty.append(el('b', undefined, 'No AWS profiles'), el('span', 'hint', 'Press "Set up SSO profile" to add your company account (aws configure sso).'));
      rows.push(empty);
    } else rows.push(...profiles.profiles.map(accRow));
    accList.replaceChildren(...rows);
  }

  async function refreshAccounts(): Promise<void> {
    profiles = await deps.aws.profiles();
    paintAccounts();
  }

  root.append(head, notice, vpnBox, accBox);
  vpnSink(deps.vpn).current = (l) => {
    list = l;
    paintVpn();
  };
  paintVpn();
  paintAccounts();
  const refresh = async (): Promise<void> => {
    vpnSink(deps.vpn).current = (l) => {
      list = l;
      paintVpn();
    };
    await Promise.all([refreshVpn(), refreshAccounts()]);
  };
  void refresh();
  return { root, refresh };
}
