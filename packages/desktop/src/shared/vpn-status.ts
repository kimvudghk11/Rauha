export type VpnPhase = 'off' | 'connecting' | 'connected' | 'failed';

export interface VpnStatusView {
  readonly phase: VpnPhase;
  /** VPN 에서 받은 내 주소(연결됨일 때만) */
  readonly ip: string | null;
  /** 지금 단계·실패 이유를 쉬운 말로 */
  readonly detail: string;
  /** 지금 단계가 시작된 때(ms) */
  readonly since: number | null;
}

const STEP: Readonly<Record<string, string>> = {
  CONNECTING: 'Starting',
  RESOLVE: 'Looking up the VPN server',
  TCP_CONNECT: 'Reaching the VPN server',
  WAIT: 'Waiting for the VPN server',
  AUTH: 'Checking certificates',
  AUTH_PENDING: 'Waiting for sign-in',
  GET_CONFIG: 'Getting settings',
  ASSIGN_IP: 'Getting an address',
  ADD_ROUTES: 'Adding routes',
};

/** OpenVPN 로그·치명 오류 줄 → 사람이 읽을 이유. 모르면 null */
function failureOf(text: string): string | null {
  if (/AUTH_FAILED|auth-failure/i.test(text)) return 'The VPN server rejected this profile (certificate revoked or not allowed).';
  if (/Cannot resolve host|RESOLVE: Cannot resolve|getaddrinfo/i.test(text)) return 'Could not find the VPN server. Check the internet connection.';
  if (/TLS Error|TLS handshake failed|VERIFY ERROR|certificate verify failed/i.test(text)) return 'The certificate handshake failed (wrong or expired certificate, or the server is unreachable).';
  if (/All TAP-Windows adapters|There are no TAP-Windows|wintun|ovpn-dco.*(not|fail)|Cannot open TUN|open_tun/i.test(text)) return 'OpenVPN could not open its network adapter. Reinstall OpenVPN or restart the computer.';
  if (/Options error|Unrecognized option/i.test(text)) return `OpenVPN did not accept the profile: ${text.replace(/^.*Options error:\s*/i, '').slice(0, 160)}`;
  return null;
}

/**
 * VPN 한 개의 연결 상태. OpenVPN management 인터페이스가 알려 준 것만 믿는다(추측으로 "연결됨"을 만들지 않는다).
 * 값 객체: 바뀔 때마다 새 것을 돌려준다.
 */
export class VpnStatus {
  private constructor(
    private readonly phase: VpnPhase,
    private readonly ip: string | null,
    private readonly detail: string,
    private readonly since: number | null,
  ) {}

  static off(): VpnStatus {
    return new VpnStatus('off', null, '', null);
  }

  static failed(detail: string, at: number): VpnStatus {
    return new VpnStatus('failed', null, detail, at);
  }

  starting(at: number): VpnStatus {
    return new VpnStatus('connecting', null, STEP['CONNECTING']!, at);
  }

  isActive(): boolean {
    return this.phase === 'connecting' || this.phase === 'connected';
  }

  /** management 인터페이스에서 온 한 줄 */
  heard(line: string, at: number): VpnStatus {
    const fatal = /^>FATAL:(.*)$/.exec(line);
    if (fatal !== null) return new VpnStatus('failed', null, failureOf(fatal[1]!) ?? `OpenVPN stopped: ${fatal[1]!.slice(0, 160)}`, at);
    const log = /^>LOG:\d+,([A-Z]*),(.*)$/.exec(line);
    if (log !== null) {
      if (this.phase === 'connected') return this;
      const [, flag, text] = log as unknown as [string, string, string];
      // F(치명)만 실패로 본다. N(치명 아님)은 인증서·서버 거절처럼 다시 해도 안 되는 것만:
      // route-nopull 로 서버가 보낸 경로를 버릴 때의 "Options error … [PUSH-OPTIONS]" 는 정상이다(이걸 실패로 읽어 연결을 끊었었다)
      if (flag === 'F') return new VpnStatus('failed', null, failureOf(text) ?? `OpenVPN stopped: ${text.slice(0, 160)}`, at);
      if (/\[PUSH-OPTIONS\]/.test(text) || /Options error/i.test(text)) return this;
      const why = failureOf(text);
      return why === null ? this : new VpnStatus('failed', null, why, at);
    }
    const st = /^(?:>STATE:)?\d+,([A-Z_]+),([^,]*),([^,]*)/.exec(line);
    if (st === null) return this;
    const [, state, reason, ip] = st as unknown as [string, string, string, string];
    if (state === 'CONNECTED') {
      if (reason === 'SUCCESS') return new VpnStatus('connected', ip === '' ? null : ip, '', at);
      return new VpnStatus('failed', null, 'Connected, but OpenVPN could not add the routes. Check that no other VPN is running.', at);
    }
    if (state === 'RECONNECTING') return new VpnStatus('connecting', null, reason === '' ? 'Reconnecting' : `Reconnecting (${reason})`, at);
    if (state === 'EXITING') {
      if (this.phase === 'failed') return this;
      const why = failureOf(reason);
      if (why !== null) return new VpnStatus('failed', null, why, at);
      return /SIGTERM|SIGINT|signal/i.test(reason) || this.phase === 'connected' ? VpnStatus.off() : new VpnStatus('failed', null, `OpenVPN stopped (${reason || 'unknown reason'}).`, at);
    }
    const step = STEP[state];
    if (step === undefined || this.phase === 'failed') return this;
    return new VpnStatus('connecting', null, step, at);
  }

  /** OpenVPN 프로세스가 끝났다 */
  ended(why: string, at: number): VpnStatus {
    if (this.phase === 'connecting') return new VpnStatus('failed', null, why, at);
    if (this.phase === 'failed') return this;
    return VpnStatus.off();
  }

  view(): VpnStatusView {
    return { phase: this.phase, ip: this.ip, detail: this.detail, since: this.since };
  }
}
