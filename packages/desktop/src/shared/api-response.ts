import { ApiError, type ApiRequestProps } from './api-request.js';
import { hideSecrets, maskHeaders } from './api-redact.js';

export const RESPONSE_LIMITS = {
  /** 이만큼까지만 받는다(넘으면 자르고 알린다) */
  read: 5 * 1024 * 1024,
  /** 화면에 싣는 본문 글자 수 */
  show: 1_000_000,
  /** 기록에 남기는 본문 글자 수 */
  history: 32_000,
  /** 기록 개수 */
  entries: 100,
} as const;

export type StatusClass = 'info' | 'ok' | 'redirect' | 'client' | 'server';

export interface ResponseSummaryProps {
  readonly status: number;
  readonly statusText: string;
  readonly ms: number;
  /** 받은 본문 바이트(상한까지) */
  readonly size: number;
  readonly headers: readonly (readonly [string, string])[];
  /** 본문 앞부분(글자) */
  readonly body: string;
  /** 크기 상한이나 글자 수 상한 때문에 잘렸다 */
  readonly truncated: boolean;
  readonly contentType: string;
  /** 따라간 주소들(리다이렉트) */
  readonly redirects: readonly string[];
  /** 글자가 아닌 본문(이미지 등): body는 비어 있다 */
  readonly binary: boolean;
}

/** 응답 요약. 상태·시간·크기·헤더·본문 앞부분. */
export class ResponseSummary {
  private constructor(readonly props: ResponseSummaryProps) {}

  static create(p: ResponseSummaryProps): ResponseSummary {
    const clipped = p.body.length > RESPONSE_LIMITS.show;
    return new ResponseSummary({ ...p, body: clipped ? p.body.slice(0, RESPONSE_LIMITS.show) : p.body, truncated: p.truncated || clipped });
  }

  statusClass(): StatusClass {
    const s = this.props.status;
    if (s >= 500) return 'server';
    if (s >= 400) return 'client';
    if (s >= 300) return 'redirect';
    if (s >= 200) return 'ok';
    return 'info';
  }

  isJson(): boolean {
    return /json/i.test(this.props.contentType) || /^\s*[[{]/.test(this.props.body);
  }

  /** JSON이면 들여쓰기한 글. 아니거나 깨졌으면 그대로 */
  prettyBody(): string {
    if (!this.isJson() || this.props.truncated) return this.props.body;
    try {
      return JSON.stringify(JSON.parse(this.props.body), null, 2);
    } catch {
      return this.props.body;
    }
  }

  /** 화면 복사용: 민감한 헤더(Set-Cookie·Authorization 등)와 아는 비밀 값을 가린 요약 */
  masked(secrets: readonly string[]): ResponseSummary {
    return new ResponseSummary({ ...this.props, headers: maskHeaders(this.props.headers), body: hideSecrets(this.props.body, secrets) });
  }

  /** 기록에 남길 모양: 가리고, 본문을 기록 상한으로 줄인다 */
  forHistory(secrets: readonly string[]): ResponseSummary {
    const m = this.masked(secrets);
    const body = m.props.body.length > RESPONSE_LIMITS.history ? m.props.body.slice(0, RESPONSE_LIMITS.history) : m.props.body;
    return new ResponseSummary({ ...m.props, body, truncated: m.props.truncated || body.length < m.props.body.length });
  }

  /** "12.3 KB" 같은 크기 글 */
  static sizeText(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

/** 기록 한 줄: 보낸 요청(변수 이름 그대로)과 결과 */
export interface HistoryEntry {
  readonly id: string;
  /** ISO 시각 */
  readonly at: string;
  readonly request: ApiRequestProps;
  readonly status: number | null;
  readonly ms: number;
  readonly size: number;
  /** 실패 이유(응답이 없을 때) */
  readonly error: string | null;
  readonly response: ResponseSummaryProps | null;
}

/** 최근 보낸 요청들. 새 것이 앞이고 100개를 넘으면 오래된 것부터 버린다. */
export class ApiHistory {
  private constructor(readonly entries: readonly HistoryEntry[]) {}

  static empty(): ApiHistory {
    return new ApiHistory([]);
  }

  static of(entries: readonly HistoryEntry[]): ApiHistory {
    return new ApiHistory(entries.slice(0, RESPONSE_LIMITS.entries));
  }

  add(entry: HistoryEntry): ApiHistory {
    return ApiHistory.of([entry, ...this.entries.filter((e) => e.id !== entry.id)]);
  }

  remove(id: string): ApiHistory {
    if (!this.entries.some((e) => e.id === id)) throw new ApiError('That history entry no longer exists.');
    return new ApiHistory(this.entries.filter((e) => e.id !== id));
  }

  clear(): ApiHistory {
    return ApiHistory.empty();
  }
}
