import { checkTarget, explainNetworkError, isMetadataAddress, REDIRECT_LIMIT } from '../../shared/api-guard.js';
import { isSecretHeader } from '../../shared/api-redact.js';
import type { PreparedRequest } from '../../shared/api-request.js';
import { RESPONSE_LIMITS, type ResponseSummaryProps } from '../../shared/api-response.js';
import type { SendFail } from '../../shared/api-ipc.js';

export const SEND_DEFAULTS = { timeoutMs: 30_000 } as const;

export type SendOutcome = { readonly ok: true; readonly response: ResponseSummaryProps } | { readonly ok: false; readonly kind: SendFail; readonly error: string; readonly ms: number };

export interface SendOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  /** 시험에서 가짜 fetch를 넣는다 */
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  /**
   * 호스트 이름을 IP 목록으로 푼다. 주면 보내기 직전(리다이렉트마다)에 풀어서 메타데이터·링크로컬 주소로 가는 이름(DNS 속임)을 막는다.
   * 풀지 못하면(없는 이름 등) 막지 않고 보내기에서 나는 오류를 그대로 쓴다.
   */
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TEXT_TYPE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|ld\+json)|[^;]*\+(json|xml))/i;

const isBinaryType = (contentType: string): boolean => contentType !== '' && !TEXT_TYPE.test(contentType);

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** 본문을 상한(5MB)까지만 읽는다. 넘으면 읽기를 멈추고 잘렸다고 알린다. */
async function readCapped(res: Response, limit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (res.body === null) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > limit) {
      chunks.push(value.subarray(0, limit - total));
      total = limit;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes, truncated };
}

const causeOf = (error: unknown): { code?: string; message: string } => {
  const e = error as { cause?: { code?: string; message?: string }; code?: string; message?: string };
  const code = e.cause?.code ?? e.code;
  return { ...(code !== undefined ? { code } : {}), message: e.cause?.message ?? e.message ?? '' };
};

/**
 * 준비된 요청을 보낸다(main 프로세스라 CORS가 없다). http·https만, 시간 제한(기본 30초)과 취소를 지키고,
 * 리다이렉트는 직접 따라가며(최대 10번) 매번 주소를 다시 검사한다. 다른 사이트로 넘어가면 인증·쿠키 헤더는 떼고 간다.
 * 인증서 오류는 숨기지 않고 이유를 돌려준다(검사를 끄는 옵션은 없다).
 */
export async function sendPrepared(request: PreparedRequest, options: SendOptions): Promise<SendOutcome> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  const timeoutMs = options.timeoutMs ?? SEND_DEFAULTS.timeoutMs;
  const fail = (kind: SendFail, error: string): SendOutcome => ({ ok: false, kind, error, ms: now() - started });

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  if (options.signal.aborted) controller.abort();
  else options.signal.addEventListener('abort', onAbort, { once: true });

  try {
    let { method, url } = request;
    let headers = request.headers.map(([k, v]) => [k, v] as [string, string]);
    let body = request.body;
    const redirects: string[] = [];
    for (let hop = 0; ; hop++) {
      const target = checkTarget(url);
      if (!target.ok) return fail('blocked', hop === 0 ? target.error : `Blocked a redirect: ${target.error}`);
      const hostname = new URL(target.url).hostname;
      if (options.resolve !== undefined && !/^[d.]+$/.test(hostname) && !hostname.startsWith('[')) {
        const addresses = await options.resolve(hostname).catch(() => [] as readonly string[]);
        if (addresses.some(isMetadataAddress)) return fail('blocked', `${hop === 0 ? '' : 'Blocked a redirect: '}${hostname} points to a cloud metadata or link-local address, which is blocked because it can expose credentials.`);
      }
      const init: RequestInit = { method, headers, redirect: 'manual', signal: controller.signal };
      if (body !== null && method !== 'GET' && method !== 'HEAD') init.body = body;
      const res = await fetchFn(target.url, init);
      const location = res.headers.get('location');
      if (REDIRECTS.has(res.status) && location !== null) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= REDIRECT_LIMIT) return fail('network', `Too many redirects (more than ${REDIRECT_LIMIT}).`);
        let next: URL;
        try {
          next = new URL(location, target.url);
        } catch {
          return fail('network', 'The server sent an invalid redirect address.');
        }
        redirects.push(next.toString());
        if (new URL(target.url).origin !== next.origin) headers = headers.filter(([k]) => !isSecretHeader(k));
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          if (method !== 'HEAD') method = 'GET';
          body = null;
          headers = headers.filter(([k]) => !/^content-(type|length)$/i.test(k));
        }
        url = next.toString();
        continue;
      }
      const contentType = res.headers.get('content-type') ?? '';
      const { bytes, truncated } = await readCapped(res, RESPONSE_LIMITS.read);
      const binary = isBinaryType(contentType) || bytes.subarray(0, 1000).includes(0);
      const response: ResponseSummaryProps = {
        status: res.status,
        statusText: res.statusText,
        ms: now() - started,
        size: bytes.length,
        headers: [...[...res.headers.entries()].filter(([k]) => k.toLowerCase() !== 'set-cookie'), ...res.headers.getSetCookie().map((c): [string, string] => ['set-cookie', c])],
        body: binary ? '' : decode(bytes, contentType),
        truncated,
        contentType,
        redirects,
        binary,
      };
      return { ok: true, response };
    }
  } catch (error) {
    if (options.signal.aborted && !timedOut) return fail('cancelled', 'Cancelled.');
    if (timedOut) return fail('timeout', `No response within ${Math.round(timeoutMs / 1000)} seconds.`);
    const c = causeOf(error);
    return fail('network', explainNetworkError(c.code, c.message));
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}
