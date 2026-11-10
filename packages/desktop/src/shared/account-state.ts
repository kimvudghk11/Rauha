/** 계정 구역의 규칙(순수 함수). `auth status`의 답을 "누구로 로그인됨 / 로그인 안 됨 / 확인 못 함" 셋으로 나눈다. 토큰은 다루지 않는다. */

export type AccountState =
  | { readonly kind: 'signed-in'; readonly who: string; readonly detail: string | null }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'unknown'; readonly reason: string };

/** 상태와, 그 상태를 읽은 계정 설정 폴더(홈은 ~로 줄인 글, 모르면 null) */
export interface AccountCheck {
  readonly state: AccountState;
  readonly configDir: string | null;
}

/** 로그인 상태를 읽지 못한 까닭 */
export type StatusFailure =
  | { readonly kind: 'no-executable' }
  | { readonly kind: 'config'; readonly message: string }
  | { readonly kind: 'timeout'; readonly seconds: number }
  | { readonly kind: 'spawn'; readonly message: string }
  | { readonly kind: 'exit'; readonly code: number; readonly stderr: string }
  | { readonly kind: 'unreadable' };

const REASON_MAX = 160;
const clip = (text: string): string => (text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text);

const METHOD_NAMES: Readonly<Record<string, string>> = { 'claude.ai': 'Claude subscription', api_key: 'API key' };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** `claude auth status`의 JSON 출력 → 상태. loggedIn이 boolean으로 분명할 때만 로그인 여부를 말하고, 아니면 확인 못 함이다. */
export function accountFromStatus(stdout: string): AccountState {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null) return unknownBecause({ kind: 'unreadable' });
    data = parsed as Record<string, unknown>;
  } catch {
    return unknownBecause({ kind: 'unreadable' });
  }
  if (data['loggedIn'] === false) return { kind: 'signed-out' };
  if (data['loggedIn'] !== true) return unknownBecause({ kind: 'unreadable' });
  const method = text(data['authMethod']);
  const who = text(data['email']) ?? (method !== null ? (METHOD_NAMES[method] ?? method) : 'Claude account');
  const detail = [text(data['orgName']), text(data['subscriptionType'])].filter((v): v is string => v !== null).join(' · ');
  return { kind: 'signed-in', who, detail: detail === '' ? null : detail };
}

/** 읽지 못한 까닭 → "확인 못 함" 상태(이유는 한 줄) */
export function unknownBecause(failure: StatusFailure): { readonly kind: 'unknown'; readonly reason: string } {
  return { kind: 'unknown', reason: clip(reasonOf(failure)) };
}

function reasonOf(failure: StatusFailure): string {
  switch (failure.kind) {
    case 'no-executable':
      return 'Could not find the Claude executable bundled with the app.';
    case 'config':
      return `Could not read the account settings: ${failure.message}`;
    case 'timeout':
      return `Claude did not answer within ${failure.seconds}s.`;
    case 'spawn':
      return `Could not start the Claude executable: ${failure.message}`;
    case 'exit': {
      const last = failure.stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '').pop();
      return last === undefined ? `Claude exited with an error (code ${failure.code}).` : `Claude exited with an error (code ${failure.code}): ${last}`;
    }
    case 'unreadable':
      return 'Could not read the reply from Claude.';
  }
}

/** 홈 폴더를 ~로 줄이고 역슬래시를 슬래시로 보인다. 홈 밖이거나 홈을 모르면 그대로(슬래시만 통일). */
export function shortPath(path: string, home: string | null): string {
  const slash = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const full = slash(path);
  if (home === null || home === '') return full;
  const h = slash(home);
  if (full === h) return '~';
  return full.startsWith(`${h}/`) ? `~${full.slice(h.length)}` : full;
}

/** 계정 카드가 그릴 내용 */
export interface AccountCardView {
  readonly tone: 'ok' | 'off' | 'warn';
  readonly title: string;
  readonly detail: string;
  readonly loginLabel: string;
  /** 로그인 버튼을 크게(필요할 때만) */
  readonly loginProminent: boolean;
  /** "다시 확인" 버튼을 보일지 */
  readonly canRecheck: boolean;
}

/** 읽은 결과(아직 읽는 중이면 null) → 카드. 로그인 버튼은 "로그인 안 됨"일 때만 두드러진다. */
export function accountCard(check: AccountCheck | null): AccountCardView {
  if (check === null) return { tone: 'warn', title: 'Checking login status…', detail: '', loginLabel: 'Log in with another account', loginProminent: false, canRecheck: false };
  const folder = check.configDir === null ? '' : `Account folder ${check.configDir}`;
  const join = (...parts: Array<string | null>): string => parts.filter((p): p is string => p !== null && p !== '').join(' · ');
  const { state } = check;
  switch (state.kind) {
    case 'signed-in':
      return { tone: 'ok', title: `Logged in · ${state.who}`, detail: join(state.detail, folder), loginLabel: 'Log in with another account', loginProminent: false, canRecheck: false };
    case 'signed-out':
      return {
        tone: 'off',
        title: 'Not logged in',
        detail: join(folder, 'Separate from your terminal Claude Code login. Log in here once.'),
        loginLabel: 'Log in to Claude',
        loginProminent: true,
        canRecheck: false,
      };
    case 'unknown':
      return { tone: 'warn', title: 'Could not check login status', detail: state.reason, loginLabel: 'Log in with another account', loginProminent: false, canRecheck: true };
  }
}
