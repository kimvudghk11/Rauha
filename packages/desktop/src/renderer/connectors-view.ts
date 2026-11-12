import type { ConnectorApi, ConnectorListView, ConnectorReply, ConnectorStatus, ConnectorView } from '../shared/connector-api.js';
import { el, isEnterKey } from './dom.js';
import { exampleRow } from './example-chips.js';

const STATUS_TEXT: Readonly<Record<ConnectorStatus, string>> = {
  unknown: 'Not checked',
  checking: 'Checking…',
  connected: 'Connected',
  'needs-auth': 'Sign-in needed',
  'signing-in': 'Waiting for browser sign-in…',
  failed: 'Could not connect',
};

/** 상태 글(화면용) */
export function connectorStatusText(row: Pick<ConnectorView, 'status' | 'note'>): string {
  return row.note === null ? STATUS_TEXT[row.status] : `${STATUS_TEXT[row.status]} — ${row.note}`;
}

/**
 * 설정 → 커넥터: 노션·컨플루언스 프리셋을 버튼 하나로 연결/해제하고, 원격 MCP 주소를 더한다.
 * 로그인은 시스템 브라우저에서 하고, 토큰은 Claude Code 가 이 계정 설정 폴더에 둔다(화면에는 오지 않는다).
 */
export function buildConnectors(api: ConnectorApi, toChat?: (text: string) => void) {
  const root = el('div', 'connectors');
  const intro = el('div', 'hint pad', 'Connect work tools so teammates can read them in chat ("summarize the Confluence onboarding page", "write this up in Notion"). Reading needs no permission; every write asks you first. Sign-in opens in your browser and the tokens stay with Claude Code in this account\'s config folder — rauha never sees them.');
  const status = el('div', 'err pad');
  const presets = el('div', 'tlist');
  const mine = el('div', 'tlist');
  const name = el('input');
  name.placeholder = 'Name (e.g. Linear)';
  const url = el('input');
  url.placeholder = 'https://… remote MCP address';
  const add = el('button', 'btn', 'Add');
  const refresh = el('button', 'btn', 'Check again');
  const custom = el('div', 'srow');
  custom.append(name, url, add);
  root.append(intro, status, presets, el('div', 'ph', 'Your connectors'), mine, el('div', 'hint pad', 'Other service (remote MCP over https, OAuth sign-in)'), custom, refresh);

  let view: ConnectorListView | null = null;

  const take = (reply: ConnectorReply): void => {
    status.textContent = reply.ok ? '' : reply.error;
    paint(reply.view);
  };

  function rowFor(c: ConnectorView): HTMLElement {
    const row = el('div', 'srow');
    const label = el('span', 'lbl');
    label.append(el('b', undefined, c.label), el('span', 'dim', ` ${c.url}`));
    const state = el('span', c.status === 'connected' ? 'dim' : c.status === 'failed' ? 'err' : 'dim', connectorStatusText(c));
    row.append(label, state);
    if (c.status === 'signing-in') {
      const cancel = el('button', 'btn', 'Cancel');
      cancel.addEventListener('click', () => void api.cancel(c.id));
      row.appendChild(cancel);
    } else if (c.status !== 'connected' && c.status !== 'checking') {
      const connect = el('button', 'btn primary', c.status === 'needs-auth' ? 'Sign in' : 'Connect');
      connect.addEventListener('click', () => void api.connect(c.id).then(take));
      row.appendChild(connect);
    }
    const remove = el('button', 'btn', 'Disconnect');
    remove.addEventListener('click', () => void api.remove(c.id).then(take));
    row.appendChild(remove);
    return row;
  }

  function paint(next: ConnectorListView): void {
    view = next;
    presets.replaceChildren(
      ...next.presets.map((p) => {
        const wrap = el('div');
        const row = el('div', 'srow');
        const label = el('span', 'lbl');
        label.append(el('b', undefined, p.label), el('span', 'dim', ` ${p.covers}`));
        row.appendChild(label);
        if (p.unavailable !== null) {
          row.appendChild(el('span', 'dim', 'Coming soon'));
          row.title = p.unavailable;
          wrap.append(row, el('div', 'hint pad', p.summary), el('div', 'hint pad', p.unavailable), exampleRow(p.examples, toChat));
          return wrap;
        }
        const button = el('button', 'btn primary', p.added ? 'Added' : 'Connect');
        button.disabled = p.added;
        button.addEventListener('click', () => void api.addPreset(p.id).then(take));
        row.appendChild(button);
        wrap.append(row, el('div', 'hint pad', p.summary), exampleRow(p.examples, toChat));
        return wrap;
      }),
    );
    mine.replaceChildren(...(next.connectors.length === 0 ? [el('div', 'dim pad', 'Nothing connected yet.')] : next.connectors.map(rowFor)));
  }

  const addCustom = (): void => {
    void api.addCustom({ label: name.value, url: url.value }).then((reply) => {
      take(reply);
      if (reply.ok) {
        name.value = '';
        url.value = '';
      }
    });
  };
  add.addEventListener('click', addCustom);
  url.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) addCustom();
  });
  refresh.addEventListener('click', () => void api.refresh().then(paint));

  const stop = api.onChange((next) => (root.isConnected || view === null ? paint(next) : stop()));
  void api.list().then(paint, (e: unknown) => (status.textContent = e instanceof Error ? e.message : String(e)));
  return { root };
}
