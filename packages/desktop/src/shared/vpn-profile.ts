/** .ovpn 을 받아 줄 수 없을 때. message 는 화면에 그대로 보여도 된다(파일 내용은 담지 않는다). */
export class VpnProfileError extends Error {}

export type VpnAuth = 'certificate' | 'password';

/** 화면·저장 목록에 보여도 되는 것. 키·인증서는 없다. */
export interface VpnSummary {
  readonly name: string;
  readonly server: string;
  readonly port: number;
  readonly proto: 'udp' | 'tcp';
  readonly auth: VpnAuth;
  /** VPN 으로 보내는 대역(CIDR). 비어 있으면 서버가 정한 대로 */
  readonly routes: readonly string[];
  /** 모든 접속이 VPN 으로 가는지(경로가 없거나 redirect-gateway) */
  readonly allTraffic: boolean;
  /** AWS Client VPN 엔드포인트인지 */
  readonly aws: boolean;
}

const MAX_BYTES = 200_000;
/** 프로그램을 실행하게 하는 지시. 받은 파일이 내 PC 에서 무언가를 돌리게 두지 않는다 */
const RUNS_PROGRAMS = new Set(['up', 'down', 'route-up', 'route-pre-down', 'ipchange', 'client-connect', 'client-disconnect', 'learn-address', 'tls-verify', 'auth-user-pass-verify', 'plugin']);
/** 바깥 파일을 가리키면 파일 하나로 옮길 수 없다 */
const FILE_REFS = new Set(['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'pkcs12', 'extra-certs']);

function maskBits(mask: string): number | null {
  const parts = mask.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const bits = parts.reduce((acc, n) => acc * 256 + n, 0);
  const ones = bits.toString(2).replace(/0+$/, '');
  return /^1*$/.test(ones) ? ones.length : null;
}

function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  const name = last.replace(/\.(ovpn|conf)$/i, '').trim();
  return name === '' ? 'VPN' : name.slice(0, 60);
}

/**
 * OpenVPN 클라이언트 설정(.ovpn). 원문(키 포함)은 안에만 두고 configText() 로 엔진에 넘길 때만 꺼낸다.
 * JSON·문자열로 바꾸면 요약만 나온다(로그·화면으로 키가 새지 않게).
 */
export class VpnProfile {
  private constructor(
    private readonly text: string,
    private readonly info: VpnSummary,
  ) {}

  static parse(raw: string, fileName: string): VpnProfile {
    if (raw.length > MAX_BYTES) throw new VpnProfileError('This file is too large to be a VPN profile (.ovpn).');
    // 인라인 블록(<ca>…</ca>) 밖의 지시 줄만 본다.
    // AWS 에서 받은 파일을 손으로 고치다 "</key>route-nopull" 처럼 줄바꿈이 빠지는 일이 흔하다 → 닫는 태그 뒤를 다음 줄로 떼어 낸다(엔진에 넘기는 원문도 고친 것)
    const out: string[] = [];
    const lines: string[][] = [];
    let block: string | null = null;
    const blocks = new Set<string>();
    const queue = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < queue.length; i++) {
      const rawLine = queue[i]!;
      const line = rawLine.trim();
      if (block !== null) {
        const close = `</${block}>`;
        if (line.toLowerCase().startsWith(close)) {
          block = null;
          out.push(close);
          const rest = line.slice(close.length).trim();
          if (rest !== '') queue.splice(i + 1, 0, rest);
          continue;
        }
        out.push(rawLine);
        continue;
      }
      out.push(rawLine);
      const open = /^<([a-z0-9-]+)>$/i.exec(line);
      if (open !== null) {
        block = open[1]!.toLowerCase();
        blocks.add(block);
        continue;
      }
      if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
      lines.push(line.split(/\s+/));
    }
    if (block !== null) throw new VpnProfileError(`The <${block}> section is not closed (missing </${block}>).`);
    const text = out.join('\n');
    const first = (name: string): string[] | undefined => lines.find((l) => l[0]?.toLowerCase() === name);
    const has = (name: string): boolean => first(name) !== undefined;

    const remote = first('remote');
    if (remote === undefined || remote[1] === undefined) throw new VpnProfileError('This is not a VPN profile: it has no "remote" server line.');
    if (has('auth-federate')) throw new VpnProfileError('This profile signs in with SSO (auth-federate). Only the official AWS VPN Client can connect it; rauha connects certificate profiles.');
    for (const l of lines) {
      const d = l[0]!.toLowerCase();
      if (RUNS_PROGRAMS.has(d)) throw new VpnProfileError(`This profile runs programs on your computer ("${d}"), so rauha will not use it.`);
      if (d === 'script-security' && Number(l[1] ?? '1') >= 2) throw new VpnProfileError('This profile runs programs on your computer (script-security 2), so rauha will not use it.');
      if (FILE_REFS.has(d) && l[1] !== undefined && l[1] !== '[inline]') throw new VpnProfileError(`"${d}" points to another file. Use a profile with the certificates inside the file (AWS "Download client configuration" with <cert> and <key> added).`);
    }
    if (/BEGIN ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/.test(text)) throw new VpnProfileError('The private key in this profile has a password. rauha cannot connect password-protected keys yet.');
    const password = has('auth-user-pass');
    if (!password && !(blocks.has('cert') && blocks.has('key')) && !blocks.has('pkcs12')) {
      throw new VpnProfileError('This profile has no client certificate (<cert> and <key>). For AWS Client VPN with mutual authentication, paste your client certificate and key into the file.');
    }

    const server = remote[1];
    const port = Number(remote[2] ?? first('port')?.[1] ?? 1194);
    const protoRaw = (remote[3] ?? first('proto')?.[1] ?? 'udp').toLowerCase();
    const routes = lines
      .filter((l) => l[0]?.toLowerCase() === 'route' && l[1] !== undefined)
      .map((l) => {
        const bits = maskBits(l[2] ?? '255.255.255.255');
        return bits === null ? l[1]! : `${l[1]}/${bits}`;
      });
    return new VpnProfile(text, {
      name: baseName(fileName),
      server,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 1194,
      proto: protoRaw.startsWith('tcp') ? 'tcp' : 'udp',
      auth: password ? 'password' : 'certificate',
      routes,
      allTraffic: has('redirect-gateway') || (routes.length === 0 && !has('route-nopull')),
      aws: /\.clientvpn\.[a-z0-9-]+\.amazonaws\.com$/i.test(server),
    });
  }

  summary(): VpnSummary {
    return this.info;
  }

  /** 엔진(OpenVPN)에 넘길 원문. 화면·로그·모델로 보내지 않는다 */
  configText(): string {
    return this.text;
  }

  /** 이름만 바꾼 새 프로필 */
  renamed(name: string): VpnProfile {
    const clean = name.trim().slice(0, 60);
    if (clean === '') throw new VpnProfileError('Give the VPN a name.');
    return new VpnProfile(this.text, { ...this.info, name: clean });
  }

  toJSON(): VpnSummary {
    return this.info;
  }

  toString(): string {
    return `VpnProfile(${this.info.name})`;
  }
}
