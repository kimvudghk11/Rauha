import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { AWS_IPC } from '../../shared/aws-api.js';
import { VPN_IPC, type VpnListView } from '../../shared/vpn-api.js';
import { safeStorageBox, type SafeStorageLike } from '../db/server-passwords.js';
import { AwsService } from './aws-service.js';
import { platformLauncher } from './launchers.js';
import { attachManagement, freePort } from './management.js';
import { VpnService } from './vpn-service.js';

export interface AwsIpcDeps {
  readonly dataDir: string;
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly safeStorage: SafeStorageLike;
  /** .ovpn 고르기 창. 취소하면 null */
  readonly pickOvpn: () => Promise<string | null>;
  readonly send: (channel: string, payload: VpnListView) => void;
  /** 앱 끄기 직전(before-quit). preventDefault 로 끄기를 잠깐 미룰 수 있다 */
  readonly beforeQuit: (handler: (event: { preventDefault(): void }) => void) => void;
  /** 미뤘던 끄기를 다시 한다 */
  readonly quit: () => void;
}

/** AWS 탭의 main 쪽: VPN(.ovpn → OpenVPN)과 AWS 프로필 */
export function registerAwsIpc(ipc: Pick<IpcMain, 'handle'>, deps: AwsIpcDeps): { vpn: VpnService; aws: AwsService } {
  const vpn = VpnService.create({
    storePath: join(deps.dataDir, 'vpn-profiles.json'),
    runDir: join(deps.dataDir, 'vpn-run'),
    box: safeStorageBox(deps.safeStorage),
    launcher: platformLauncher(deps.platform, deps.env),
    freePort,
    attach: (port, handlers) => attachManagement(port, handlers),
    newId: () => randomUUID(),
    now: () => Date.now(),
    emit: (list) => deps.send(VPN_IPC.changed, list),
  });
  void vpn.sweep();
  // 켜진 VPN 이 있으면 끄기를 잠깐 미루고, OpenVPN 이 실제로 끝난 뒤(최대 3초) 다시 끈다
  deps.beforeQuit((event) => {
    if (!vpn.hasActive()) return;
    event.preventDefault();
    void vpn.stopAllAndWait().finally(() => deps.quit());
  });
  ipc.handle(VPN_IPC.list, () => vpn.list());
  ipc.handle(VPN_IPC.pick, async () => {
    const path = await deps.pickOvpn();
    return path === null ? { ok: true, data: null } : vpn.addFile(path);
  });
  ipc.handle(VPN_IPC.addText, (_e, req: unknown) => vpn.addText(req));
  ipc.handle(VPN_IPC.remove, (_e, id: unknown) => vpn.remove(id));
  ipc.handle(VPN_IPC.rename, (_e, req: unknown) => vpn.rename(req));
  ipc.handle(VPN_IPC.connect, (_e, id: unknown) => vpn.connect(id));
  ipc.handle(VPN_IPC.disconnect, (_e, id: unknown) => vpn.disconnect(id));
  ipc.handle(VPN_IPC.install, () => vpn.install());

  const aws = AwsService.create({ platform: deps.platform, env: deps.env, home: deps.home });
  ipc.handle(AWS_IPC.profiles, () => aws.profiles());
  ipc.handle(AWS_IPC.who, (_e, profile: unknown) => aws.who(profile));
  ipc.handle(AWS_IPC.ssoLogin, (_e, profile: unknown) => aws.ssoLogin(profile));
  ipc.handle(AWS_IPC.configureSso, () => aws.configureSso());
  return { vpn, aws };
}
