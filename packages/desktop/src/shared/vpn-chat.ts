import type { VpnListView } from './vpn-api.js';

export type VpnChatIntent = 'on' | 'off' | 'status';

export type VpnChatAct = { readonly kind: 'connect'; readonly id: string } | { readonly kind: 'disconnect'; readonly id: string } | { readonly kind: 'open-tab' } | null;

/** 일을 시키는 말(고쳐·만들어·왜·코드 …)이 섞이면 VPN 조작이 아니라 팀에게 가는 일이다 */
const WORK = /고쳐|만들|구현|짜줘|작성|코드|에러|오류|왜|어떻게|뭐야|설명|terraform|cdk|엔드포인트|\.ts|\.js|함수|테스트/i;

/**
 * 채팅 입력이 "VPN 켜줘/꺼줘/상태" 같은 짧은 조작 말이면 그 뜻, 아니면 null.
 * 이런 말은 모델을 부르지 않고 rauha 가 바로 한다(토큰 0). 헷갈리면 null — 팀에게 넘긴다.
 */
export function vpnChatIntent(text: string): VpnChatIntent | null {
  const t = text.trim().toLowerCase();
  if (t.length > 20 || !/vpn|브이피엔/.test(t) || WORK.test(t)) return null;
  if (/상태|켜져\s*있|연결\s*됐|연결\s*돼|붙어\s*있|\?$/.test(t)) return 'status';
  if (/꺼|끄|끊|off|해제/.test(t)) return 'off';
  if (/켜|연결|붙여|붙어|접속|on\b/.test(t)) return 'on';
  return null;
}

/** 할 일과 채팅에 남길 말 */
export function vpnChatReply(intent: VpnChatIntent, list: VpnListView): { readonly act: VpnChatAct; readonly say: string } {
  const profiles = list.profiles;
  const active = profiles.find((p) => p.status.phase === 'connected' || p.status.phase === 'connecting');
  if (intent === 'status') {
    if (profiles.length === 0) return { act: null, say: '넣어 둔 VPN 이 없어요. AWS 탭에서 .ovpn 을 넣으면 여기서 "VPN 켜줘"로 연결할 수 있어요.' };
    if (active === undefined) return { act: null, say: `VPN 은 꺼져 있어요 (${profiles.map((p) => `"${p.summary.name}"`).join(', ')}).` };
    return { act: null, say: active.status.phase === 'connecting' ? `"${active.summary.name}" VPN 을 연결하는 중이에요.` : `"${active.summary.name}" VPN 연결됨${active.status.ip !== null ? ` (주소 ${active.status.ip})` : ''}.` };
  }
  if (intent === 'off') {
    if (active === undefined) return { act: null, say: '켜진 VPN 이 없어요.' };
    return { act: { kind: 'disconnect', id: active.id }, say: `"${active.summary.name}" VPN 을 끊을게요.` };
  }
  if (active !== undefined) return { act: null, say: `"${active.summary.name}" VPN 은 이미 ${active.status.phase === 'connected' ? '연결돼' : '연결하는 중이에'} 있어요.` };
  if (profiles.length === 0) return { act: { kind: 'open-tab' }, say: '넣어 둔 VPN 이 없어요. AWS 탭에서 회사 .ovpn 파일을 넣어 주세요.' };
  if (!list.engine.installed) return { act: { kind: 'open-tab' }, say: 'OpenVPN 이 아직 없어요. AWS 탭에서 Install OpenVPN 을 눌러 주세요.' };
  if (profiles.length > 1) return { act: { kind: 'open-tab' }, say: `VPN 이 ${profiles.length}개라 AWS 탭에서 골라 주세요.` };
  const only = profiles[0]!;
  return { act: { kind: 'connect', id: only.id }, say: `"${only.summary.name}" VPN 을 연결할게요.` };
}
