/**
 * Claude 말고 다른 AI(Kiro · ChatGPT Codex)를 그 회사의 공식 CLI 로 부른다.
 * rauha 는 토큰을 읽지 않는다: 로그인은 CLI 가 하고, rauha 는 명령을 실행하고 답을 받기만 한다.
 * 한 번 묻기는 파일을 고치지 못하게(Kiro: 도구 미리 허락 없음, Codex: 읽기 전용 샌드박스) 보낸다.
 */
export type AiProviderId = 'kiro' | 'codex';

export interface AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  /** 사람이 알아볼 회사·요금 안내 */
  readonly note: string;
  /** 설치 안내(없을 때) */
  readonly install: string;
}

export const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'kiro', label: 'Kiro', note: 'Amazon Kiro · free plan has a monthly request limit', install: 'Install the Kiro CLI from kiro.dev, then sign in here.' },
  { id: 'codex', label: 'ChatGPT (Codex)', note: 'OpenAI Codex CLI · signs in with your ChatGPT account', install: 'Install with: npm install -g @openai/codex, then sign in here.' },
];

export function providerOf(id: unknown): AiProvider | null {
  return AI_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** 질문 앞에 둘 것: - 로 시작하면 옵션으로 읽히지 않게 -- 를 붙인다 */
const promptTail = (prompt: string): string[] => (prompt.startsWith('-') ? ['--', prompt] : [prompt]);

/** 한 번 묻기 인자(셸을 거치지 않고 그대로 넘긴다) */
export function askArgs(id: AiProviderId, prompt: string, lastMessageFile: string): string[] {
  if (id === 'kiro') return ['chat', '--no-interactive', ...promptTail(prompt)];
  return ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-last-message', lastMessageFile, ...promptTail(prompt)];
}

export const LOGIN_ARGS: Readonly<Record<AiProviderId, readonly string[]>> = { kiro: ['login'], codex: ['login'] };
export const LOGOUT_ARGS: Readonly<Record<AiProviderId, readonly string[]>> = { kiro: ['logout'], codex: ['logout'] };
export const STATUS_ARGS: Readonly<Record<AiProviderId, readonly string[]>> = { kiro: ['whoami'], codex: ['login', 'status'] };

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

/** CLI 출력에서 답만: 색 코드, Kiro 의 크레딧·시간 줄, 앞의 "> " 를 뗀다 */
export function cleanAnswer(id: AiProviderId, raw: string): string {
  const text = raw.replace(ANSI, '').replace(/\r/g, '');
  if (id === 'codex') return text.trim();
  const lines = text.split('\n').filter((l) => !/^\s*▸\s*(Credits|Time)\b/.test(l));
  const start = lines.findIndex((l) => l.trim() !== '');
  if (start >= 0) lines[start] = (lines[start] ?? '').replace(/^\s*>\s?/, '');
  return lines.join('\n').trim();
}

/** 무료 한도에 걸렸으면 쉬운 말, 아니면 null */
export function limitMessage(id: AiProviderId, raw: string): string | null {
  const text = raw.replace(ANSI, '');
  if (id === 'kiro' && /Monthly request limit reached/i.test(text)) {
    const reset = /reset on ([0-9/.-]+)/i.exec(text)?.[1]?.replace(/\.$/, '');
    return `Kiro’s monthly free limit is used up.${reset === undefined ? '' : ` It resets on ${reset}.`} You can switch to another account in Extensions > AI accounts.`;
  }
  if (id === 'codex' && /usage limit|rate limit|quota/i.test(text)) return 'Your ChatGPT plan’s Codex limit is used up for now. Try again later, or switch accounts in Extensions > AI accounts.';
  return null;
}

/** npm 전역 설치가 실패한 까닭. permission 이면 사용자 폴더로 다시 시도한다 */
export type InstallFailure = 'permission' | 'network' | 'other';

export function installFailure(output: string): InstallFailure {
  if (/EACCES|EPERM|permission denied|operation not permitted/i.test(output)) return 'permission';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network|getaddrinfo|proxy/i.test(output)) return 'network';
  return 'other';
}

/** 상태 명령 출력 → 로그인했는지와 누구인지(이메일 등) */
export function loginState(id: AiProviderId, raw: string, code: number): { signedIn: boolean; who: string } {
  const text = raw.replace(ANSI, '');
  if (code !== 0 || /not logged in/i.test(text)) return { signedIn: false, who: '' };
  if (id === 'kiro') {
    const via = /Logged in with ([^\n]+)/i.exec(text)?.[1]?.trim() ?? '';
    const email = /Email:\s*(\S+)/i.exec(text)?.[1] ?? '';
    return { signedIn: /Logged in/i.test(text), who: [email, via].filter((x) => x !== '').join(' · ') };
  }
  return { signedIn: /Logged in/i.test(text), who: /ChatGPT/i.test(text) ? 'ChatGPT account' : /API key/i.test(text) ? 'API key' : '' };
}
