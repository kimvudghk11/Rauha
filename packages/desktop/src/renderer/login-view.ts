import type { AuthApi } from '../shared/ipc.js';
import { loginText, type LoginView } from '../shared/claude-login.js';
import { accountCard, unknownBecause, type AccountCheck } from '../shared/account-state.js';
import { el } from './dom.js';

/** main이 푸시하는 로그인 상태는 한 번만 받아서 화면의 로그인 칸들에 나눠 준다(칸이 사라지면 알아서 뺀다). */
const listeners = new Set<(view: LoginView) => void>();
let subscribed = false;
function subscribe(api: AuthApi, fn: (view: LoginView) => void): void {
  listeners.add(fn);
  if (subscribed) return;
  subscribed = true;
  api.onState((view) => {
    for (const l of [...listeners]) l(view);
  });
}

export interface LoginControlOptions {
  /** 로그인이 성공했을 때(화면의 다른 곳을 새로 읽는 데 쓴다) */
  readonly onSuccess?: () => void;
  /** 로그인 여부 줄("로그인되어 있어요")을 보일지. 오류 카드에서는 끈다. */
  readonly showStatus?: boolean;
}

/**
 * 계정 카드 부품. 설정 맨 위 계정 카드, 첫 실행 3단계, 오류 카드가 같이 쓴다.
 * showStatus가 켜져 있으면 "누구로 로그인됨 / 로그인 안 됨 / 확인 못 함(이유)" 한 칸과 버튼을 그리고,
 * 로그인 버튼은 로그인이 필요할 때만 두드러진다(아니면 작은 "다른 계정으로 로그인"). 꺼져 있으면(오류 카드) 로그인이 필요한 상황이라 버튼만 두드러진다.
 * 토큰은 다루지 않는다. 로그인 여부는 main이 `auth status`로 읽어 준 값만 보여 준다.
 */
export function createLoginControl(api: AuthApi, options: LoginControlOptions = {}): { root: HTMLElement; refresh(): Promise<void> } {
  const showStatus = options.showStatus !== false;
  const root = el('div', 'login');
  const title = el('b', 'acct-title');
  const detail = el('span', 'dim acct-detail');
  const card = el('div', 'acct');
  card.append(title, detail);
  const go = el('button', 'btn primary', 'Log in to Claude');
  const recheck = el('button', 'btn', 'Check again');
  const cancel = el('button', 'btn', 'Cancel');
  const text = el('span', 'login-text');
  const row = el('div', 'login-row');
  row.append(go, recheck, cancel, text);
  if (showStatus) root.appendChild(card);
  root.appendChild(row);

  let view: LoginView = { state: 'idle', message: null };
  let check: AccountCheck | null = null;
  const paint = (): void => {
    const running = view.state === 'running';
    const shown = accountCard(check);
    const prominent = showStatus ? shown.loginProminent : true;
    go.disabled = running;
    go.className = prominent ? 'btn primary' : 'btn';
    go.textContent = view.state === 'failed' || view.state === 'cancelled' ? 'Log in again' : showStatus ? shown.loginLabel : 'Log in to Claude';
    // 확인이 끝나기 전에는 로그인을 권하지 않는다(읽는 중에 큰 버튼이 번쩍이지 않게)
    go.hidden = showStatus && check === null && !running;
    recheck.hidden = !showStatus || !shown.canRecheck || running;
    cancel.hidden = !running;
    card.dataset['tone'] = shown.tone;
    title.textContent = shown.title;
    detail.textContent = shown.detail;
    text.textContent = loginText(view);
    text.className = view.state === 'failed' ? 'login-text err' : 'login-text';
  };

  async function refresh(): Promise<void> {
    check = await api.check().catch((error: unknown) => ({ state: unknownBecause({ kind: 'spawn', message: error instanceof Error ? error.message : String(error) }), configDir: null }));
    paint();
  }

  let attached = false;
  const onState = (next: LoginView): void => {
    // 화면에 붙었다가 빠진 칸은 더 받지 않는다(아직 붙기 전인 칸은 건너뛰지 않는다)
    if (root.isConnected) attached = true;
    else if (attached) return void listeners.delete(onState);
    view = next;
    paint();
    if (next.state !== 'running') void refresh();
    if (next.state === 'success') options.onSuccess?.();
  };
  subscribe(api, onState);
  go.addEventListener('click', () => {
    go.disabled = true;
    void api.login().then((v) => {
      view = v;
      paint();
    });
  });
  recheck.addEventListener('click', () => {
    check = null;
    paint();
    void refresh();
  });
  cancel.addEventListener('click', () => api.cancel());

  // 다른 곳(터미널 등)에서 로그인하고 돌아왔을 때 바로 맞춰지게, 창에 초점이 올 때 다시 읽는다(칸이 사라지면 뗀다)
  if (showStatus) {
    const onFocus = (): void => (root.isConnected ? void refresh() : window.removeEventListener('focus', onFocus));
    window.addEventListener('focus', onFocus);
  }

  paint();
  void refresh();
  return { root, refresh };
}

/** 오류 카드에 붙이는 로그인 칸(로그인 여부 줄 없이 버튼과 진행 글만) */
export function loginCard(): HTMLElement {
  return createLoginControl(window.rauha.auth, { showStatus: false }).root;
}
