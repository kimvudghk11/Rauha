import { describe, expect, it } from 'vitest';
import { VpnProfile, VpnProfileError } from './vpn-profile.js';

const CERT = `client
dev tun
proto udp
remote cvpn-endpoint-0abc.prod.clientvpn.ap-northeast-2.amazonaws.com 443
remote-random-hostname
resolv-retry infinite
nobind
remote-cert-tls server
cipher AES-256-GCM
verb 3
<ca>
-----BEGIN CERTIFICATE-----
AAAA
-----END CERTIFICATE-----
</ca>
<cert>
-----BEGIN CERTIFICATE-----
BBBB
-----END CERTIFICATE-----
</cert>
<key>
-----BEGIN PRIVATE KEY-----
SECRETKEY
-----END PRIVATE KEY-----
</key>
route 172.31.0.0 255.255.0.0
reneg-sec 0
`;

describe('.ovpn 프로필 해석', () => {
  it('인증서가 든 AWS Client VPN 파일은 서버·프로토콜·경로를 읽는다', () => {
    const p = VpnProfile.parse(CERT, 'split-tunnel-client-config.ovpn');
    expect(p.summary()).toEqual({
      name: 'split-tunnel-client-config',
      server: 'cvpn-endpoint-0abc.prod.clientvpn.ap-northeast-2.amazonaws.com',
      port: 443,
      proto: 'udp',
      auth: 'certificate',
      routes: ['172.31.0.0/16'],
      allTraffic: false,
      aws: true,
    });
  });

  it('경로가 없으면 모든 접속이 VPN 으로 간다고 본다', () => {
    const p = VpnProfile.parse(CERT.replace('route 172.31.0.0 255.255.0.0\n', ''), 'full.ovpn');
    expect(p.summary().routes).toEqual([]);
    expect(p.summary().allTraffic).toBe(true);
  });

  it('redirect-gateway 가 있으면 모든 접속이 VPN 으로 간다', () => {
    expect(VpnProfile.parse(`${CERT}redirect-gateway def1\n`, 'a.ovpn').summary().allTraffic).toBe(true);
  });

  it('요약·화면 글에는 개인 키가 들어가지 않는다', () => {
    const p = VpnProfile.parse(CERT, 'a.ovpn');
    expect(JSON.stringify(p.summary())).not.toContain('SECRETKEY');
    expect(String(p)).not.toContain('SECRETKEY');
    expect(JSON.stringify(p)).not.toContain('SECRETKEY');
  });

  it('원문은 엔진에 넘길 때만 꺼낸다', () => {
    expect(VpnProfile.parse(CERT, 'a.ovpn').configText()).toContain('SECRETKEY');
  });

  it('SSO(auth-federate) 파일은 공식 AWS VPN Client 가 필요하다고 거절한다', () => {
    expect(() => VpnProfile.parse(`${CERT}auth-federate\n`, 'sso.ovpn')).toThrow(/AWS VPN Client/);
  });

  it('remote 가 없으면 VPN 설정 파일이 아니라고 거절한다', () => {
    expect(() => VpnProfile.parse('hello world', 'x.ovpn')).toThrow(VpnProfileError);
  });

  it('비밀번호가 걸린 개인 키는 아직 못 쓴다고 알린다', () => {
    const enc = CERT.replace('BEGIN PRIVATE KEY', 'BEGIN ENCRYPTED PRIVATE KEY').replace('END PRIVATE KEY', 'END ENCRYPTED PRIVATE KEY');
    expect(() => VpnProfile.parse(enc, 'x.ovpn')).toThrow(/password/i);
  });

  it('바깥 파일을 가리키는 cert·key 줄은 거절한다(파일 하나로 옮길 수 있어야 한다)', () => {
    const outside = CERT.replace(/<cert>[\s\S]*<\/cert>\n/, 'cert C:\\keys\\client.crt\n');
    expect(() => VpnProfile.parse(outside, 'x.ovpn')).toThrow(/inside the file/);
  });

  it('위험한 지시(스크립트 실행)가 든 파일은 거절한다', () => {
    expect(() => VpnProfile.parse(`${CERT}script-security 2\nup /tmp/evil.sh\n`, 'x.ovpn')).toThrow(/runs programs/);
  });

  it('auth-user-pass 는 사용자 이름·비밀번호 방식으로 본다', () => {
    expect(VpnProfile.parse(`${CERT}auth-user-pass\n`, 'x.ovpn').summary().auth).toBe('password');
  });

  it('너무 큰 파일은 거절한다', () => {
    expect(() => VpnProfile.parse(`${CERT}${'#'.repeat(300_000)}`, 'x.ovpn')).toThrow(VpnProfileError);
  });

  it('파일 이름에서 확장자와 경로를 떼어 이름을 만든다', () => {
    expect(VpnProfile.parse(CERT, 'C:\\Users\\me\\Desktop\\회사 VPN.ovpn').summary().name).toBe('회사 VPN');
  });

  it('닫는 태그 뒤에 붙어 버린 지시("</key>route-nopull")를 다음 줄로 떼어 읽고, 엔진에 넘길 원문도 고친다', () => {
    const glued = CERT.replace('</key>\n', '</key>route-nopull\n');
    const p = VpnProfile.parse(glued, 'a.ovpn');
    expect(p.summary().routes).toEqual(['172.31.0.0/16']);
    expect(p.summary().allTraffic).toBe(false);
    expect(p.configText()).toContain('</key>\nroute-nopull\n');
  });

  it('닫히지 않은 블록은 거절한다', () => {
    expect(() => VpnProfile.parse(CERT.replace('</key>\n', ''), 'a.ovpn')).toThrow(/not closed/);
  });

  it('CRLF 줄바꿈 파일도 읽는다', () => {
    expect(VpnProfile.parse(CERT.replace(/\n/g, '\r\n'), 'a.ovpn').summary().routes).toEqual(['172.31.0.0/16']);
  });
});
