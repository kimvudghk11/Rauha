/** 설정 → 커넥터 화면의 IPC. 화면은 서버 이름과 좁은 요청으로만 main 과 이야기한다. 토큰은 어느 쪽에도 오가지 않는다. */
export const CONNECTOR_IPC = {
  list: 'connectors:list',
  refresh: 'connectors:refresh',
  addPreset: 'connectors:add-preset',
  addCustom: 'connectors:add-custom',
  connect: 'connectors:connect',
  cancel: 'connectors:cancel',
  remove: 'connectors:remove',
  /** main → 화면: 목록·상태가 바뀌었다 */
  changed: 'connectors:changed',
} as const;

/**
 * 화면에 보이는 연결 상태.
 * unknown: 아직 확인 안 함, checking: 확인 중, connected: 팀원이 쓸 수 있음, needs-auth: 로그인 필요,
 * signing-in: 브라우저에서 로그인 기다리는 중, failed: 접속 실패(note 에 이유).
 */
export type ConnectorStatus = 'unknown' | 'checking' | 'connected' | 'needs-auth' | 'signing-in' | 'failed';

export interface ConnectorView {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly preset: string | null;
  readonly status: ConnectorStatus;
  readonly note: string | null;
}

export interface ConnectorPresetView {
  readonly id: string;
  readonly label: string;
  readonly covers: string;
  /** 이미 목록에 있는지 */
  readonly added: boolean;
  /** 버튼 하나로 연결할 수 없는 이유('준비 중'). 연결할 수 있으면 null */
  readonly unavailable: string | null;
}

export interface ConnectorListView {
  readonly presets: readonly ConnectorPresetView[];
  readonly connectors: readonly ConnectorView[];
}

export type ConnectorReply = { readonly ok: true; readonly view: ConnectorListView } | { readonly ok: false; readonly error: string; readonly view: ConnectorListView };

export interface ConnectorApi {
  list(): Promise<ConnectorListView>;
  /** 모든 연결의 상태를 Claude Code 에 다시 묻는다 */
  refresh(): Promise<ConnectorListView>;
  addPreset(id: string): Promise<ConnectorReply>;
  addCustom(input: { label: string; url: string }): Promise<ConnectorReply>;
  /** 로그인이 필요하면 시스템 브라우저를 연다. 끝나면 changed 로 알린다. */
  connect(id: string): Promise<ConnectorReply>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<ConnectorReply>;
  onChange(listener: (view: ConnectorListView) => void): () => void;
}

/** Claude Code 가 알려 준 MCP 서버 상태(mcpServerStatus) → 화면 상태. 목록에 없으면 missing. */
export type SdkServerStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | 'missing';

export function statusFromSdk(status: SdkServerStatus): ConnectorStatus {
  if (status === 'connected') return 'connected';
  if (status === 'needs-auth') return 'needs-auth';
  if (status === 'pending') return 'checking';
  return 'failed';
}

/** 다 기다린 상태인지(pending 이면 더 기다린다) */
export function isSettled(status: SdkServerStatus): boolean {
  return status !== 'pending';
}

/** 화면에 내보낼 오류 글. 주소·토큰처럼 보이는 긴 값은 가린다(로그·화면에 비밀이 새지 않게). */
export function safeError(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, (u) => u.split('?')[0]!)
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{32,}\b/g, '…')
    .slice(0, 300);
}

/** 사용자 정의 커넥터 입력(화면 → main). 검사는 도메인이 다시 한다. */
export function customInputOf(input: unknown): { label: string; url: string } | null {
  if (typeof input !== 'object' || input === null) return null;
  const { label, url } = input as { label?: unknown; url?: unknown };
  if (typeof label !== 'string' || typeof url !== 'string' || label.length > 200 || url.length > 2000) return null;
  return { label, url };
}
