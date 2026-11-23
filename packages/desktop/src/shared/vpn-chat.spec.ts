import { describe, expect, it } from 'vitest';
import { vpnChatIntent, vpnChatReply } from './vpn-chat.js';
import type { VpnListView } from './vpn-api.js';

describe('채팅의 VPN 말(모델 없이 바로)', () => {
  it.each([
    ['VPN 켜줘', 'on'],
    ['vpn 연결해줘', 'on'],
    ['브이피엔 켜', 'on'],
    ['회사 vpn 붙여줘', 'on'],
    ['VPN 꺼줘', 'off'],
    ['vpn 끊어', 'off'],
    ['VPN 상태', 'status'],
    ['vpn 켜져 있어?', 'status'],
    ['VPN 연결됐어?', 'status'],
  ] as const)('"%s" → %s', (text, want) => {
    expect(vpnChatIntent(text)).toBe(want);
  });

  it.each(['VPN 연결 코드 고쳐줘', 'vpn-service.ts 에서 connect 가 왜 실패해?', 'VPN 이 뭐야', '켜줘', 'AWS Client VPN 엔드포인트 만드는 terraform 짜줘'])('일·질문은 가로채지 않는다: "%s"', (text) => {
    expect(vpnChatIntent(text)).toBeNull();
  });
});

const view = (profiles: { name: string; phase: 'off' | 'connecting' | 'connected' | 'failed'; ip?: string }[], installed = true): VpnListView => ({
  engine: { installed, where: installed ? 'x' : null, canInstall: true, installHint: '' },
  profiles: profiles.map((p, i) => ({ id: `id${i}`, saved: true, summary: { name: p.name, server: 's', port: 443, proto: 'udp', auth: 'certificate', routes: ['172.31.0.0/16'], allTraffic: false, aws: true }, status: { phase: p.phase, ip: p.ip ?? null, detail: '', since: null } })),
});

describe('VPN 말에 대한 할 일과 답', () => {
  it('넣어 둔 VPN 이 하나면 그걸 연결한다', () => {
    expect(vpnChatReply('on', view([{ name: '회사', phase: 'off' }]))).toEqual({ act: { kind: 'connect', id: 'id0' }, say: '"회사" VPN 을 연결할게요.' });
  });

  it('이미 연결돼 있으면 아무것도 하지 않고 알려 준다', () => {
    expect(vpnChatReply('on', view([{ name: '회사', phase: 'connected', ip: '10.0.0.5' }])).act).toBeNull();
  });

  it('여러 개면 AWS 탭을 열어 고르게 한다', () => {
    expect(vpnChatReply('on', view([{ name: 'a', phase: 'off' }, { name: 'b', phase: 'off' }])).act).toEqual({ kind: 'open-tab' });
  });

  it('하나도 없으면 AWS 탭에서 넣으라고 한다', () => {
    expect(vpnChatReply('on', view([]))).toEqual({ act: { kind: 'open-tab' }, say: expect.stringMatching(/\.ovpn/) });
  });

  it('OpenVPN 이 없으면 AWS 탭에서 설치하라고 한다', () => {
    expect(vpnChatReply('on', view([{ name: '회사', phase: 'off' }], false)).act).toEqual({ kind: 'open-tab' });
  });

  it('끄기는 켜진 것을 끊는다', () => {
    expect(vpnChatReply('off', view([{ name: '회사', phase: 'connected' }])).act).toEqual({ kind: 'disconnect', id: 'id0' });
    expect(vpnChatReply('off', view([{ name: '회사', phase: 'off' }])).act).toBeNull();
  });

  it('상태는 이름·주소를 알려 준다', () => {
    expect(vpnChatReply('status', view([{ name: '회사', phase: 'connected', ip: '10.0.0.5' }])).say).toBe('"회사" VPN 연결됨 (주소 10.0.0.5).');
    expect(vpnChatReply('status', view([{ name: '회사', phase: 'off' }])).say).toMatch(/꺼져/);
  });
});
