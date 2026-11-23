import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { delimiter, join } from 'node:path';

/** OpenVPN 을 찾고, 설치를 돕고, 설정 파일 하나로 띄운다. 띄운 뒤의 상태·끊기는 management 인터페이스로 한다. */
export interface VpnLauncher {
  find(): string | null;
  readonly canInstall: boolean;
  readonly installHint: string;
  install(): Promise<void>;
  /** openvpn 을 --management-hold 로 띄운다. 실패하면 화면에 보여도 되는 말로 던진다 */
  launch(req: LaunchRequest): Promise<void>;
}

export interface LaunchRequest {
  readonly configPath: string;
  readonly workDir: string;
  readonly managementPort: number;
}

export class VpnLaunchError extends Error {}

/** openvpn 에 넘길 공통 옵션. 상태를 놓치지 않게 management 가 붙을 때까지 기다리게 한다 */
export function openvpnArgs(req: LaunchRequest): string[] {
  return ['--config', req.configPath, '--management', '127.0.0.1', String(req.managementPort), '--management-hold', '--auth-nocache', '--verb', '3'];
}

const quoteWin = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function run(file: string, args: readonly string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    execFile(file, [...args], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1;
      done({ code, out: `${stdout ?? ''}\n${stderr ?? ''}` });
    });
  });
}

/**
 * OpenVPN Interactive Service(`\\.\pipe\openvpn\service`)에 시작 요청을 보낸다. OpenVPN GUI 가 쓰는 길과 같다.
 * 서비스가 네트워크 어댑터·경로처럼 관리자 권한이 드는 일을 대신 해 주므로, 연결할 때마다 관리자 확인 창이 뜨지 않는다.
 * 요청: UTF-16LE "작업 폴더\0옵션\0표준입력\0". 답: "0x코드\n이름\n내용".
 */
export function serviceRequest(workDir: string, args: readonly string[]): Buffer {
  return Buffer.from(`${workDir}\0${args.map(quoteWin).join(' ')}\0\0`, 'utf16le');
}

/** 서비스 답을 읽는다. 0 이면 성공(null), 아니면 화면에 보일 이유 */
export function serviceReply(raw: Buffer): string | null {
  const text = raw.toString('utf16le').replace(/\0+$/, '');
  const [codeLine = '', , ...rest] = text.split('\n');
  const code = Number.parseInt(codeLine, 16);
  if (code === 0) return null;
  const msg = rest.join(' ').trim();
  if (/admin|not authorized|privilege/i.test(msg)) return `OpenVPN refused to start this profile for your Windows account (${msg}). Add your account to the "OpenVPN Administrators" group, or run rauha once as administrator.`;
  return `OpenVPN could not start: ${msg === '' ? text.trim() : msg}`;
}

function which(name: string, env: NodeJS.ProcessEnv, exts: readonly string[]): string | null {
  for (const dir of (env['PATH'] ?? env['Path'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function windowsLauncher(env: NodeJS.ProcessEnv, pipeName = '\\\\.\\pipe\\openvpn\\service'): VpnLauncher {
  const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
  return {
    canInstall: true,
    installHint: 'rauha installs OpenVPN Community with winget (Windows asks for permission once).',
    find: () => {
      const p = join(programFiles, 'OpenVPN', 'bin', 'openvpn.exe');
      return existsSync(p) ? p : which('openvpn', env, ['.exe']);
    },
    install: async () => {
      const winget = which('winget', env, ['.exe']);
      if (winget === null) throw new VpnLaunchError('winget is not available. Install OpenVPN Community from openvpn.net/community-downloads, then press Refresh.');
      const r = await run(winget, ['install', '--id', 'OpenVPNTechnologies.OpenVPN', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'], 10 * 60_000);
      if (r.code !== 0 && !/already installed|이미 설치/i.test(r.out)) throw new VpnLaunchError(`OpenVPN install failed: ${r.out.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? `exit code ${r.code}`}`);
    },
    launch: (req) =>
      new Promise<void>((resolve, reject) => {
        const sock = connect(pipeName);
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = (err: string | null): void => {
          if (settled) return;
          settled = true;
          sock.destroy();
          if (err === null) resolve();
          else reject(new VpnLaunchError(err));
        };
        sock.setTimeout(15_000, () => finish('The OpenVPN service did not answer. Restart the "OpenVPNServiceInteractive" service or the computer.'));
        sock.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOENT' ? 'The OpenVPN service is not running. Reinstall OpenVPN or start the "OpenVPNServiceInteractive" service.' : `Could not reach the OpenVPN service: ${e.message}`));
        sock.on('connect', () => sock.write(serviceRequest(req.workDir, openvpnArgs(req))));
        sock.on('data', (d: Buffer) => {
          chunks.push(d);
          const all = Buffer.concat(chunks);
          // 첫 답(성공이면 Process ID 줄까지) 하나만 보면 된다
          if (all.toString('utf16le').split('\n').length >= 3) finish(serviceReply(all));
        });
        sock.on('end', () => finish(chunks.length === 0 ? 'The OpenVPN service closed the request without an answer.' : serviceReply(Buffer.concat(chunks))));
      }),
  };
}

const MAC_PATHS = ['/opt/homebrew/sbin/openvpn', '/usr/local/sbin/openvpn', '/opt/homebrew/bin/openvpn', '/usr/local/bin/openvpn', '/usr/sbin/openvpn'];

/** 셸 한 줄에 넣을 작은따옴표 감싸기 */
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** 맥: 관리자 권한이 필요해서 macOS 비밀번호 창(osascript)을 거쳐 데몬으로 띄운다. 리눅스: pkexec. */
export function unixLauncher(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): VpnLauncher {
  const find = (): string | null => MAC_PATHS.find((p) => existsSync(p)) ?? which('openvpn', env, ['']);
  const brew = (): string | null => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((p) => existsSync(p)) ?? which('brew', env, ['']);
  return {
    find,
    canInstall: platform === 'darwin',
    installHint: platform === 'darwin' ? 'rauha installs OpenVPN with Homebrew (brew install openvpn).' : 'Install OpenVPN with your package manager (for example: sudo apt install openvpn).',
    install: async () => {
      if (platform !== 'darwin') throw new VpnLaunchError('Install OpenVPN with your package manager (sudo apt install openvpn), then press Refresh.');
      const b = brew();
      if (b === null) throw new VpnLaunchError('Homebrew is not installed. Install it from brew.sh, then press Install again.');
      const r = await run(b, ['install', 'openvpn'], 15 * 60_000);
      if (r.code !== 0) throw new VpnLaunchError(`brew install openvpn failed: ${r.out.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? `exit code ${r.code}`}`);
    },
    launch: async (req) => {
      const exe = find();
      if (exe === null) throw new VpnLaunchError('OpenVPN is not installed.');
      const line = [exe, ...openvpnArgs(req), '--daemon', 'rauha-openvpn', '--cd', req.workDir].map(sq).join(' ');
      const r =
        platform === 'darwin'
          ? await run('osascript', ['-e', `do shell script ${JSON.stringify(line)} with administrator privileges with prompt "rauha needs your password to connect the VPN."`], 5 * 60_000)
          : await run('pkexec', ['sh', '-c', line], 5 * 60_000);
      if (r.code !== 0) throw new VpnLaunchError(/User canceled|-128|dismissed|Not authorized/i.test(r.out) ? 'Cancelled: the VPN needs your computer password to connect.' : `OpenVPN could not start: ${r.out.trim().split('\n').pop() ?? ''}`);
    },
  };
}

export function platformLauncher(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): VpnLauncher {
  return platform === 'win32' ? windowsLauncher(env) : unixLauncher(platform, env);
}
