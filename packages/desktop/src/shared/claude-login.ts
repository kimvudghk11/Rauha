/** 앱 안 Claude 로그인의 규칙(순수 함수). 토큰은 읽지 않고, `auth status`의 loggedIn 여부와 출력의 https 주소만 다룬다. */

export type LoginState = 'idle' | 'running' | 'success' | 'failed' | 'cancelled';

/** 화면에 보낼 로그인 진행 상태. message는 실패 이유 한 줄(없으면 null). */
export interface LoginView {
  readonly state: LoginState;
  readonly message: string | null;
}

/** `claude auth status`가 JSON으로 내는 loggedIn. 읽을 수 없으면 null(모름). */
export function parseLoginStatus(stdout: string): boolean | null {
  try {
    const value = (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

const URL_AT = /https:\/\/[^\s\u0000-\u001f\u007f"'<>`]+/;
const TRAILING = /[.,;:!?)\]}]+$/;

/** 로그인 출력에서 브라우저로 열 주소 하나를 뽑는다. https만 허용하고 문장부호는 뗀다. 없으면 null. */
export function loginUrlFrom(output: string): string | null {
  const found = URL_AT.exec(output)?.[0];
  if (found === undefined) return null;
  const url = found.replace(TRAILING, '');
  return url.length > 'https://'.length ? url : null;
}

const NEEDS_LOGIN = /로그인(이 필요|되어 있지|이 만료|해 주세요)|Not logged in|Please run \/login|rauha login/i;

/** 멈춘 이유 글이 "로그인이 필요해서"인지(그러면 오류 카드에 로그인 버튼을 붙인다). */
export const needsLogin = (text: string): boolean => NEEDS_LOGIN.test(text);

export type LoginFailure =
  | { readonly kind: 'no-executable' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'not-confirmed' }
  | { readonly kind: 'exit'; readonly code: number; readonly output: string };

const REASON_MAX = 120;

/** 실패 이유 한 줄. */
export function failureReason(failure: LoginFailure): string {
  switch (failure.kind) {
    case 'no-executable':
      return 'Could not find the Claude executable bundled with the app.';
    case 'timeout':
      return 'Login timed out. Press the button to try again.';
    case 'not-confirmed':
      return 'The login window closed, but the login could not be confirmed.';
    case 'exit': {
      const last = failure.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '').pop();
      if (last === undefined) return `Login did not finish (code ${failure.code}).`;
      return last.length > REASON_MAX ? `${last.slice(0, REASON_MAX - 1)}…` : last;
    }
  }
}

/** 상태 → 화면 글 한 줄(idle은 빈 글). */
export function loginText(view: LoginView): string {
  switch (view.state) {
    case 'idle':
      return '';
    case 'running':
      return 'Log in in your browser. This updates here when you finish.';
    case 'success':
      return 'Logged in.';
    case 'failed':
      return `Login failed: ${view.message ?? 'unknown reason.'}`;
    case 'cancelled':
      return 'Login cancelled.';
  }
}
