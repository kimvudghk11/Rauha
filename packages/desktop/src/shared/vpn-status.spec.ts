import { describe, expect, it } from 'vitest';
import { VpnStatus } from './vpn-status.js';

describe('VPN 연결 상태', () => {
  it('처음은 끊김이다', () => {
    expect(VpnStatus.off().view()).toEqual({ phase: 'off', ip: null, detail: '', since: null });
  });

  it('연결을 시작하면 연결 중이다', () => {
    expect(VpnStatus.off().starting(1000).view()).toMatchObject({ phase: 'connecting', since: 1000 });
  });

  it('OpenVPN 이 CONNECTED,SUCCESS 를 알릴 때만 연결됨이고 받은 IP 를 기억한다', () => {
    const s = VpnStatus.off().starting(1).heard('>STATE:1700000000,CONNECTED,SUCCESS,10.0.8.6,52.79.1.2,443,,', 5);
    expect(s.view()).toEqual({ phase: 'connected', ip: '10.0.8.6', detail: '', since: 5 });
  });

  it('state 명령의 답(앞에 >STATE: 가 없는 줄)도 읽는다', () => {
    expect(VpnStatus.off().starting(1).heard('1700000000,CONNECTED,SUCCESS,10.0.8.6,52.79.1.2,443,,', 5).view().phase).toBe('connected');
  });

  it('CONNECTED 지만 ERROR 면 연결됨이 아니다(경로를 못 붙인 경우)', () => {
    const s = VpnStatus.off().starting(1).heard('>STATE:1,CONNECTED,ERROR,10.0.8.6,52.79.1.2,443,,', 5);
    expect(s.view().phase).toBe('failed');
    expect(s.view().detail).toMatch(/route/i);
  });

  it('중간 단계는 쉬운 말로 보여 준다', () => {
    expect(VpnStatus.off().starting(1).heard('>STATE:1,AUTH,,,,,,', 2).view()).toMatchObject({ phase: 'connecting', detail: 'Checking certificates' });
    expect(VpnStatus.off().starting(1).heard('>STATE:1,ASSIGN_IP,,10.0.8.6,,,,', 2).view()).toMatchObject({ phase: 'connecting', detail: 'Getting an address' });
  });

  it('연결된 뒤 RECONNECTING 이면 다시 잇는 중이다', () => {
    const s = VpnStatus.off().starting(1).heard('>STATE:1,CONNECTED,SUCCESS,10.0.8.6,,,,', 2).heard('>STATE:3,RECONNECTING,ping-restart,,,,,', 3);
    expect(s.view()).toMatchObject({ phase: 'connecting', detail: 'Reconnecting (ping-restart)', ip: null });
  });

  it('인증 실패·TLS 실패·이름 못 찾음은 이유를 붙여 실패로 둔다', () => {
    const base = VpnStatus.off().starting(1);
    expect(base.heard('>LOG:1,F,TLS Error: TLS handshake failed', 2).view()).toMatchObject({ phase: 'failed', detail: expect.stringMatching(/certificate|handshake/i) });
    expect(base.heard('>FATAL:Cannot resolve host address: cvpn-endpoint-x.amazonaws.com', 2).view()).toMatchObject({ phase: 'failed', detail: expect.stringMatching(/find the VPN server/i) });
    expect(base.heard('>STATE:1,EXITING,auth-failure,,,,,', 2).view()).toMatchObject({ phase: 'failed', detail: expect.stringMatching(/rejected/i) });
  });

  it('route-nopull 로 서버 경로를 버릴 때 나오는 Options error(PUSH-OPTIONS)는 실패가 아니다', () => {
    const s = VpnStatus.off().starting(1);
    expect(s.heard(">LOG:1,N,Options error: option 'route' cannot be used in this context ([PUSH-OPTIONS])", 2)).toBe(s);
    expect(s.heard(">LOG:1,N,Options error: option 'dhcp-option' cannot be used in this context ([PUSH-OPTIONS])", 2)).toBe(s);
  });

  it('F(치명) 로그는 이유를 몰라도 실패다', () => {
    expect(VpnStatus.off().starting(1).heard('>LOG:1,F,Exiting due to fatal error', 2).view()).toMatchObject({ phase: 'failed', detail: 'OpenVPN stopped: Exiting due to fatal error' });
  });

  it('연결된 뒤의 경고 로그는 상태를 바꾸지 않는다', () => {
    const s = VpnStatus.off().starting(1).heard('>STATE:1,CONNECTED,SUCCESS,10.0.0.1,,,,', 2);
    expect(s.heard('>LOG:3,N,TLS Error: something', 3)).toBe(s);
  });

  it('실패한 뒤 들어오는 EXITING 은 실패 이유를 덮지 않는다', () => {
    const s = VpnStatus.off().starting(1).heard('>FATAL:Cannot resolve host address: x', 2).heard('>STATE:3,EXITING,exit-with-notification,,,,,', 3);
    expect(s.view().detail).toMatch(/find the VPN server/i);
  });

  it('직접 끊은 EXITING(SIGTERM)은 끊김이다', () => {
    const s = VpnStatus.off().starting(1).heard('>STATE:1,CONNECTED,SUCCESS,10.0.8.6,,,,', 2).heard('>STATE:3,EXITING,SIGTERM,,,,,', 3);
    expect(s.view().phase).toBe('off');
  });

  it('프로세스가 끝났는데 연결 중이었다면 실패다', () => {
    expect(VpnStatus.off().starting(1).ended('OpenVPN stopped', 9).view()).toMatchObject({ phase: 'failed', detail: 'OpenVPN stopped' });
  });

  it('연결됐다가 프로세스가 끝나면 끊김이다', () => {
    expect(VpnStatus.off().starting(1).heard('>STATE:1,CONNECTED,SUCCESS,10.0.8.6,,,,', 2).ended('bye', 9).view().phase).toBe('off');
  });

  it('관계없는 줄은 상태를 바꾸지 않는다', () => {
    const s = VpnStatus.off().starting(1);
    expect(s.heard('>INFO:OpenVPN Management Interface Version 5', 2)).toBe(s);
    expect(s.heard('>BYTECOUNT:1,2', 2)).toBe(s);
  });
});
