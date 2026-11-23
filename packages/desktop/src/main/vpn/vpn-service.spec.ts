import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VpnListView } from '../../shared/vpn-api.js';
import type { SecretBox } from '../db/server-passwords.js';
import { VpnLaunchError, type LaunchRequest, type VpnLauncher } from './launchers.js';
import type { ManagementHandlers } from './management.js';
import { VpnService } from './vpn-service.js';

const OVPN = `client
dev tun
proto udp
remote cvpn-endpoint-0abc.prod.clientvpn.ap-northeast-2.amazonaws.com 443
<ca>
CA
</ca>
<cert>
CERT
</cert>
<key>
TOPSECRETKEY
</key>
route-nopull
route 172.31.0.0 255.255.0.0
`;

const box = (available = true): SecretBox => ({
  available: () => available,
  seal: (p) => Buffer.from(`sealed:${p}`).toString('base64'),
  open: (s) => Buffer.from(s, 'base64').toString().replace(/^sealed:/, ''),
});

function setup(opts: { installed?: boolean; launchFails?: string; boxOk?: boolean; ignoresSignal?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-vpn-spec-'));
  const launched: LaunchRequest[] = [];
  const sent: string[] = [];
  let handlers: ManagementHandlers | null = null;
  const configSeen: string[] = [];
  let installed = opts.installed ?? true;
  const launcher: VpnLauncher = {
    find: () => (installed ? 'C:/OpenVPN/openvpn.exe' : null),
    canInstall: true,
    installHint: 'winget',
    install: async () => {
      installed = true;
    },
    launch: async (req) => {
      if (opts.launchFails !== undefined) throw new VpnLaunchError(opts.launchFails);
      launched.push(req);
      configSeen.push(readFileSync(req.configPath, 'utf8'));
    },
  };
  const emitted: VpnListView[] = [];
  let n = 0;
  const make = () =>
    VpnService.create({
      storePath: join(dir, 'vpn-profiles.json'),
      runDir: join(dir, 'run'),
      box: box(opts.boxOk ?? true),
      launcher,
      freePort: async () => 4555,
      attach: async (_port, h) => {
        handlers = h;
        return {
          send: (c) => {
            sent.push(c);
            // 진짜 OpenVPN 처럼: 끊기 신호를 받으면 조금 뒤 연결이 닫힌다
            if (c === 'signal SIGTERM' && (opts.ignoresSignal ?? false) === false) setTimeout(() => h.onClose(), 5);
          },
          close: () => {},
        };
      },
      newId: () => `id${++n}`,
      now: () => 1000,
      emit: (l) => emitted.push(l),
    });
  return { dir, make, launched, sent, emitted, configSeen, hear: (l: string) => handlers!.onLine(l), close: () => handlers!.onClose() };
}

describe('VPN 서비스', () => {
  it('넣은 .ovpn 은 암호문으로만 저장되고 다시 켜도 남아 있다', () => {
    const t = setup();
    const s = t.make();
    const r = s.addText({ name: '회사.ovpn', text: OVPN });
    expect(r.ok).toBe(true);
    const file = readFileSync(join(t.dir, 'vpn-profiles.json'), 'utf8');
    expect(file).not.toContain('TOPSECRETKEY');
    expect(t.make().list().profiles.map((p) => p.summary.name)).toEqual(['회사']);
  });

  it('화면으로 가는 목록에는 키가 없다', () => {
    const t = setup();
    const s = t.make();
    s.addText({ name: 'a.ovpn', text: OVPN });
    expect(JSON.stringify(s.list())).not.toContain('TOPSECRETKEY');
    expect(JSON.stringify(t.emitted)).not.toContain('TOPSECRETKEY');
  });

  it('운영체제 암호화를 못 쓰면 저장하지 않고 이번 실행 동안만 둔다', () => {
    const t = setup({ boxOk: false });
    const s = t.make();
    s.addText({ name: 'a.ovpn', text: OVPN });
    expect(s.list().profiles[0]!.saved).toBe(false);
    expect(t.make().list().profiles).toEqual([]);
  });

  it('같은 파일을 두 번 넣으면 하나만 남는다', () => {
    const t = setup();
    const s = t.make();
    s.addText({ name: 'a.ovpn', text: OVPN });
    s.addText({ name: 'b.ovpn', text: OVPN });
    expect(s.list().profiles).toHaveLength(1);
  });

  it('SSO 파일은 이유와 함께 거절한다', () => {
    const r = setup().make().addText({ name: 'sso.ovpn', text: `${OVPN}auth-federate\n` });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/AWS VPN Client/) });
  });

  it('연결: 설정을 풀어 OpenVPN 을 띄우고, 상태를 켜고, 대기를 푼다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    expect(await s.connect(id)).toEqual({ ok: true, data: null });
    expect(t.launched[0]!.managementPort).toBe(4555);
    expect(t.configSeen[0]).toContain('TOPSECRETKEY');
    expect(t.sent).toEqual(['state on', 'log on', 'hold release']);
    expect(s.list().profiles[0]!.status.phase).toBe('connecting');
  });

  it('CONNECTED 를 들으면 연결됨이 되고 풀어 둔 설정 파일을 지운다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    t.hear('>STATE:1,CONNECTED,SUCCESS,10.0.0.36,16.1.1.1,443,,');
    expect(s.list().profiles[0]!.status).toMatchObject({ phase: 'connected', ip: '10.0.0.36' });
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(join(t.dir, 'run'))).toEqual([]);
    expect(s.activeName()).toBe('a');
  });

  it('끊기: SIGTERM 을 보내고 끊김이 된다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    t.hear('>STATE:1,CONNECTED,SUCCESS,10.0.0.36,,,,');
    await s.disconnect(id);
    expect(t.sent).toContain('signal SIGTERM');
    expect(s.list().profiles[0]!.status.phase).toBe('off');
  });

  it('다른 VPN 을 연결하면 켜져 있던 것을 먼저 끊는다', async () => {
    const t = setup();
    const s = t.make();
    const a = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    const b = (s.addText({ name: 'b.ovpn', text: OVPN.replace('CERT', 'CERT2') }) as { data: { id: string } }).data.id;
    await s.connect(a);
    t.hear('>STATE:1,CONNECTED,SUCCESS,10.0.0.36,,,,');
    await s.connect(b);
    const phases = s.list().profiles.map((p) => p.status.phase);
    expect(phases).toEqual(['off', 'connecting']);
  });

  it('OpenVPN 이 없으면 연결하지 않고 설치하라고 알린다', async () => {
    const t = setup({ installed: false });
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    expect(await s.connect(id)).toEqual({ ok: false, error: expect.stringMatching(/Install OpenVPN/) });
    expect(await s.install()).toEqual({ ok: true, data: null });
    expect(s.list().engine.installed).toBe(true);
  });

  it('띄우기에 실패하면 이유를 남기고 풀어 둔 설정을 지운다', async () => {
    const t = setup({ launchFails: 'The OpenVPN service is not running.' });
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    expect(await s.connect(id)).toEqual({ ok: false, error: 'The OpenVPN service is not running.' });
    expect(s.list().profiles[0]!.status).toMatchObject({ phase: 'failed', detail: 'The OpenVPN service is not running.' });
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(t.dir, 'run')) ? readdirSync(join(t.dir, 'run')) : []).toEqual([]);
  });

  it('연결 중에 OpenVPN 이 끝나면 실패다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    t.close();
    expect(s.list().profiles[0]!.status.phase).toBe('failed');
  });

  it('TLS 실패를 들으면 실패로 두고 OpenVPN 을 끈다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    t.hear('>LOG:1,N,TLS Error: TLS handshake failed');
    expect(s.list().profiles[0]!.status.phase).toBe('failed');
    expect(t.sent).toContain('signal SIGTERM');
  });

  it('지우면 연결을 끊고 목록과 저장 파일에서 빠진다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    await s.remove(id);
    expect(s.list().profiles).toEqual([]);
    expect(t.make().list().profiles).toEqual([]);
  });

  it('이름을 바꾸면 저장된다', () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    expect(s.rename({ id, name: '회사 개발 VPC' })).toEqual({ ok: true, data: null });
    expect(t.make().list().profiles[0]!.summary.name).toBe('회사 개발 VPC');
  });

  it('앱을 끌 때 켜진 VPN 을 끊는다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    s.stopAll();
    expect(t.sent.at(-1)).toBe('signal SIGTERM');
  });

  it('앱을 끌 때는 OpenVPN 이 실제로 끝날 때까지 기다린 뒤 끝낸다', async () => {
    const t = setup();
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    expect(s.hasActive()).toBe(false);
    await s.connect(id);
    t.hear('>STATE:1,CONNECTED,SUCCESS,10.0.0.36,,,,');
    expect(s.hasActive()).toBe(true);
    const t0 = Date.now();
    await s.stopAllAndWait(2000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(t.sent).toContain('signal SIGTERM');
    expect(s.hasActive()).toBe(false);
  });

  it('OpenVPN 이 끝나지 않아도 정한 시간 뒤에는 끝낸다(앱이 안 꺼지는 일은 없다)', async () => {
    const t = setup({ ignoresSignal: true });
    const s = t.make();
    const id = (s.addText({ name: 'a.ovpn', text: OVPN }) as { data: { id: string } }).data.id;
    await s.connect(id);
    const t0 = Date.now();
    await s.stopAllAndWait(150);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect(s.hasActive()).toBe(false);
  });
});
