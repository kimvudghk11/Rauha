import type { AuthApi } from '../shared/ipc.js';
import { loggedInText, loginText, type LoginView } from '../shared/claude-login.js';
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
 * "Claude 로그인" 버튼과 진행·성공·실패·취소 한 줄. 설정의 계정 구역, 첫 실행 3단계, 오류 카드가 같이 쓴다.
 * 토큰은 다루지 않는다. 로그인 여부는 main이 \`auth status\`로 읽어 준 값만 보여 준다.
 */
export function createLoginControl(api: AuthApi, options: LoginControlOptions = {}): { root: HTMLElement; refresh(): Promise<void> } {
  const root = el('div', 'login');
  const status = el('span', 'dim');
  const text = el('span', 'login-text');
  const go = el('button', 'btn primary', 'Claude 로그인');
  const cancel = el('button', 'btn sec', '취소');
  const row = el('div', 'login-row');
  row.append(go, cancel, text);
  if (options.showStatus !== false) root.appendChild(status);
  root.appendChild(row);

  let view: LoginView = { state: 'idle', message: null };
  const paint = (): void => {
    const running = view.state === 'running';
    go.disabled = running;
    go.textContent = view.state === 'failed' || view.state === 'cancelled' ? '다시 로그인' : 'Claude 로그인';
    cancel.hidden = !running;
    text.textContent = loginText(view);
    text.className = view.state === 'failed' ? 'login-text err' : 'login-text';
  };

  async function refresh(): Promise<void> {
    const loggedIn = await api.status().catch(() => null);
    status.textContent = loggedInText(loggedIn);
    if (loggedIn === true && view.state === 'idle') go.textContent = '다시 로그인';
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
  cancel.addEventListener('click', () => api.cancel());

  paint();
  void refresh();
  return { root, refresh };
}

/** 오류 카드에 붙이는 로그인 칸(로그인 여부 줄 없이 버튼과 진행 글만) */
export function loginCard(): HTMLElement {
  return createLoginControl(window.rauha.auth, { showStatus: false }).root;
}
