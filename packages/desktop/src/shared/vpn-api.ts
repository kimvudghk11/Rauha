import type { VpnSummary } from './vpn-profile.js';
import type { VpnStatusView } from './vpn-status.js';

/** AWS 탭의 VPN 채널. 화면은 .ovpn 원문을 받지 않는다(요약과 상태만). */
export const VPN_IPC = {
  list: 'vpn:list',
  pick: 'vpn:pick',
  addText: 'vpn:add-text',
  remove: 'vpn:remove',
  rename: 'vpn:rename',
  connect: 'vpn:connect',
  disconnect: 'vpn:disconnect',
  install: 'vpn:install',
  changed: 'vpn:changed',
} as const;

export interface VpnEngineView {
  readonly installed: boolean;
  /** 찾은 openvpn 경로(없으면 null) */
  readonly where: string | null;
  /** 이 운영체제에서 rauha 가 설치를 대신 할 수 있는지 */
  readonly canInstall: boolean;
  /** 설치 방법 안내(한 줄) */
  readonly installHint: string;
}

export interface VpnProfileView {
  readonly id: string;
  readonly summary: VpnSummary;
  /** 운영체제 암호화로 저장됐는지(아니면 이번 실행 동안만) */
  readonly saved: boolean;
  readonly status: VpnStatusView;
}

export interface VpnListView {
  readonly engine: VpnEngineView;
  readonly profiles: readonly VpnProfileView[];
}

export type VpnResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export interface VpnApi {
  list(): Promise<VpnListView>;
  /** 파일 고르기 창으로 .ovpn 넣기. 취소하면 data 가 null */
  pick(): Promise<VpnResult<VpnProfileView | null>>;
  /** 끌어 놓은 파일 넣기 */
  addText(req: { name: string; text: string }): Promise<VpnResult<VpnProfileView>>;
  remove(id: string): Promise<VpnResult<null>>;
  rename(req: { id: string; name: string }): Promise<VpnResult<null>>;
  connect(id: string): Promise<VpnResult<null>>;
  disconnect(id: string): Promise<VpnResult<null>>;
  install(): Promise<VpnResult<null>>;
  /** 상태가 바뀔 때마다 */
  onChanged(listener: (list: VpnListView) => void): void;
}
