import type { AccountCheck } from '../shared/account-state.js';
import { AI_PROVIDERS, providerOf, type AiProviderId } from '../shared/external-ai.js';
import type { AiStatusView, ExternalAiApi } from '../shared/external-ai-ipc.js';
import { AI_LOGO_SVG, aiLogoUrl } from './ai-logos.js';
import { el } from './dom.js';

export type ChatTarget = 'team' | AiProviderId;

export interface AiBarDeps {
  readonly auth: { check(): Promise<AccountCheck>; login(): Promise<unknown> };
  readonly externalAi: ExternalAiApi;
}

/** 칩의 공식 로고 그림 */
const logo = (t: ChatTarget): HTMLElement => {
  const img = el('img', `ai-logo ${t}`);
  img.src = aiLogoUrl(AI_LOGO_SVG[t]);
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  return img;
};
const LABEL = (t: ChatTarget): string => (t === 'team' ? 'Claude team' : (providerOf(t)?.label ?? t));
const KEY = 'rauha.chat.ai';

/**
 * 채팅 맨 위: 누구에게 물을지(Claude 팀 · Kiro · ChatGPT) 칩과, 고른 AI 의 계정·로그인 단추.
 * 로그인은 각 회사 앱(CLI)이 하고 rauha 는 토큰을 읽지 않는다. 로그인 창이 열리면 돌아왔을 때 다시 확인한다.
 */
export function buildAiBar(deps: AiBarDeps, onPick: (t: ChatTarget) => void) {
  const root = el('div', 'ai-bar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Who answers');
  let target: ChatTarget = 'team';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'team' || providerOf(saved) !== null) target = saved as ChatTarget;
  } catch {
    /* 기억 못 해도 기본(팀) */
  }
  let claude: AccountCheck | null = null;
  let others: readonly AiStatusView[] = [];
  let note = '';
  let busy = false;

  const state = (t: ChatTarget): { tone: 'ok' | 'warn' | 'off' | 'wait'; text: string; who: string } => {
    if (t === 'team') {
      if (claude === null) return { tone: 'wait', text: 'Checking…', who: '' };
      return claude.state.kind === 'signed-in' ? { tone: 'ok', text: 'Signed in', who: claude.state.who } : claude.state.kind === 'signed-out' ? { tone: 'warn', text: 'Signed out', who: '' } : { tone: 'off', text: 'Unknown', who: '' };
    }
    const s = others.find((x) => x.id === t);
    if (s === undefined) return { tone: 'wait', text: 'Checking…', who: '' };
    if (!s.installed) return { tone: 'off', text: 'Not installed', who: '' };
    return s.signedIn ? { tone: 'ok', text: 'Signed in', who: s.who } : { tone: 'warn', text: 'Signed out', who: '' };
  };

  async function load(): Promise<void> {
    const [c, o] = await Promise.all([deps.auth.check().catch(() => null), deps.externalAi.status().catch(() => [] as readonly AiStatusView[])]);
    claude = c;
    others = o;
    paint();
  }

  const run = async (work: () => Promise<{ ok: boolean; error?: string } | unknown>, done: string): Promise<void> => {
    if (busy) return;
    busy = true;
    note = '';
    paint();
    try {
      const r = (await work()) as { ok?: boolean; error?: string } | undefined;
      note = r !== undefined && r.ok === false ? (r.error ?? 'Something went wrong.') : done;
    } catch (e) {
      note = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      await load();
    }
  };

  function paint(): void {
    const chips = el('div', 'ai-chips');
    for (const t of ['team', ...AI_PROVIDERS.map((p) => p.id)] as ChatTarget[]) {
      const s = state(t);
      const b = el('button', `ai-chip${t === target ? ' on' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(t === target));
      b.title = `${LABEL(t)} · ${s.text}${s.who === '' ? '' : ` · ${s.who}`}`;
      b.append(logo(t), el('span', undefined, LABEL(t)), el('span', `ai-dot ${s.tone}`));
      b.addEventListener('click', () => {
        target = t;
        note = '';
        try {
          localStorage.setItem(KEY, t);
        } catch {
          /* 무시 */
        }
        onPick(t);
        paint();
      });
      chips.append(b);
    }
    // 고른 AI 의 계정과 로그인 단추
    const acct = el('div', 'ai-acct');
    const s = state(target);
    acct.append(el('span', `ai-pill ${s.tone}`, s.text));
    if (s.who !== '') acct.append(el('span', 'hint ai-who', s.who));
    const btn = (text: string, primary: boolean, fn: () => void): void => {
      const b = el('button', `btn sm${primary ? ' primary' : ''}`, busy ? '…' : text);
      b.type = 'button';
      b.disabled = busy;
      b.addEventListener('click', fn);
      acct.append(b);
    };
    if (target === 'team') {
      if (s.tone === 'warn') btn('Sign in', true, () => void run(() => deps.auth.login(), 'A browser opened to sign in to Claude.'));
    } else {
      const id = target;
      const p = providerOf(id);
      if (s.text === 'Not installed') acct.append(el('span', 'hint', p?.install ?? ''));
      else if (s.tone === 'warn') btn('Sign in', true, () => void run(() => deps.externalAi.login(id), 'A sign-in window opened. Finish there, then come back here.'));
      else if (s.tone === 'ok') {
        btn('Switch account', false, () => void run(() => deps.externalAi.login(id, true), 'Signed out of the current account. A sign-in window opened for the other one.'));
        btn('Sign out', false, () => void run(() => deps.externalAi.logout(id), `Signed out of ${p?.label ?? id}.`));
      }
    }
    if (note !== '') acct.append(el('span', 'hint ai-note', note));
    root.replaceChildren(chips, acct);
  }

  // 로그인 창(브라우저·터미널)에서 돌아오면 다시 확인한다
  window.addEventListener('focus', () => {
    if (root.isConnected) void load();
  });
  paint();
  void load();
  queueMicrotask(() => onPick(target));
  return { root, target: () => target };
}
