import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VpnListView, VpnProfileView, VpnResult } from '../../shared/vpn-api.js';
import { VpnProfile, VpnProfileError } from '../../shared/vpn-profile.js';
import { VpnStatus } from '../../shared/vpn-status.js';
import type { SecretBox } from '../db/server-passwords.js';
import { VpnLaunchError, type VpnLauncher } from './launchers.js';
import type { ManagementHandlers, ManagementLink } from './management.js';

/** 파일에 남는 것: 이름과 암호문뿐(평문 설정·키는 파일로 남기지 않는다) */
interface StoredProfile {
  readonly id: string;
  readonly fileName: string;
  readonly name: string;
  readonly sealed: string;
}

interface Entry {
  readonly id: string;
  readonly fileName: string;
  profile: VpnProfile;
  saved: boolean;
  status: VpnStatus;
  link: ManagementLink | null;
  configPath: string | null;
  /** 이 연결 시도의 번호(끊고 다시 연결할 때 늦게 온 옛 이벤트를 버린다) */
  attempt: number;
}

export interface VpnServiceDeps {
  readonly storePath: string;
  /** 연결하는 동안만 복호화한 설정을 두는 폴더(사용자만 읽음) */
  readonly runDir: string;
  readonly box: SecretBox;
  readonly launcher: VpnLauncher;
  readonly freePort: () => Promise<number>;
  readonly attach: (port: number, handlers: ManagementHandlers) => Promise<ManagementLink>;
  readonly newId: () => string;
  readonly now: () => number;
  readonly emit: (list: VpnListView) => void;
}

const MAX_FILE = 200_000;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const errText = (e: unknown): string => (e instanceof VpnProfileError || e instanceof VpnLaunchError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);

/**
 * VPN 프로필 보관과 연결. .ovpn 원문은 safeStorage 로 잠가 저장하고, 연결할 때만 runDir 에 풀었다가 연결되면 바로 지운다.
 * 한 번에 하나만 연결한다(두 VPN 의 경로가 겹치면 둘 다 망가진다): 다른 것을 연결하면 켜져 있던 것을 먼저 끊는다.
 */
export class VpnService {
  private readonly entries: Entry[] = [];
  /** 앱을 끌 때 OpenVPN 이 끝나기를 기다리는 것들 */
  private readonly closers = new Map<string, () => void>();

  private constructor(private readonly deps: VpnServiceDeps) {}

  static create(deps: VpnServiceDeps): VpnService {
    const s = new VpnService(deps);
    s.load();
    return s;
  }

  private load(): void {
    let stored: StoredProfile[] = [];
    try {
      stored = existsSync(this.deps.storePath) ? (JSON.parse(readFileSync(this.deps.storePath, 'utf8')) as StoredProfile[]) : [];
    } catch {
      stored = [];
    }
    for (const s of Array.isArray(stored) ? stored : []) {
      try {
        const profile = VpnProfile.parse(this.deps.box.open(s.sealed), s.fileName).renamed(s.name);
        this.entries.push({ id: s.id, fileName: s.fileName, profile, saved: true, status: VpnStatus.off(), link: null, configPath: null, attempt: 0 });
      } catch {
        // 다른 PC·계정에서 옮겨 온 암호문은 풀 수 없다 → 건너뛴다(다시 넣으면 된다)
      }
    }
  }

  private persist(): void {
    const keep: StoredProfile[] = [];
    for (const e of this.entries) {
      if (!e.saved) continue;
      keep.push({ id: e.id, fileName: e.fileName, name: e.profile.summary().name, sealed: this.deps.box.seal(e.profile.configText()) });
    }
    mkdirSync(join(this.deps.storePath, '..'), { recursive: true });
    writeFileSync(this.deps.storePath, JSON.stringify(keep, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  private canSeal(): boolean {
    try {
      return this.deps.box.available();
    } catch {
      return false;
    }
  }

  private view(e: Entry): VpnProfileView {
    return { id: e.id, summary: e.profile.summary(), saved: e.saved, status: e.status.view() };
  }

  list(): VpnListView {
    const where = this.deps.launcher.find();
    return {
      engine: { installed: where !== null, where, canInstall: this.deps.launcher.canInstall, installHint: this.deps.launcher.installHint },
      profiles: this.entries.map((e) => this.view(e)),
    };
  }

  private changed(): void {
    this.deps.emit(this.list());
  }

  private find(id: unknown): Entry | null {
    return typeof id === 'string' ? (this.entries.find((e) => e.id === id) ?? null) : null;
  }

  async addFile(path: string): Promise<VpnResult<VpnProfileView>> {
    try {
      const text = await readFile(path, 'utf8');
      return this.add(text, path);
    } catch (e) {
      return fail(e instanceof VpnProfileError ? e.message : 'Could not read that file.');
    }
  }

  addText(req: unknown): VpnResult<VpnProfileView> {
    const r = req as { name?: unknown; text?: unknown } | null;
    if (typeof r?.text !== 'string' || typeof r.name !== 'string') return fail('Drop a .ovpn file.');
    if (r.text.length > MAX_FILE) return fail('This file is too large to be a VPN profile (.ovpn).');
    return this.add(r.text, r.name);
  }

  private add(text: string, fileName: string): VpnResult<VpnProfileView> {
    try {
      const profile = VpnProfile.parse(text, fileName);
      const same = this.entries.find((e) => e.profile.configText() === profile.configText());
      if (same !== undefined) return { ok: true, data: this.view(same) };
      // 같은 이름이 있으면 뒤에 번호를 붙인다
      const names = new Set(this.entries.map((e) => e.profile.summary().name));
      let name = profile.summary().name;
      for (let n = 2; names.has(name); n++) name = `${profile.summary().name} (${n})`;
      const entry: Entry = { id: this.deps.newId(), fileName: fileName.split(/[\\/]/).pop() ?? fileName, profile: profile.renamed(name), saved: this.canSeal(), status: VpnStatus.off(), link: null, configPath: null, attempt: 0 };
      this.entries.push(entry);
      this.persist();
      this.changed();
      return { ok: true, data: this.view(entry) };
    } catch (e) {
      return fail(errText(e));
    }
  }

  async remove(id: unknown): Promise<VpnResult<null>> {
    const e = this.find(id);
    if (e === null) return fail('That VPN is gone.');
    await this.stop(e);
    this.entries.splice(this.entries.indexOf(e), 1);
    this.persist();
    this.changed();
    return { ok: true, data: null };
  }

  rename(req: unknown): VpnResult<null> {
    const r = req as { id?: unknown; name?: unknown } | null;
    const e = this.find(r?.id);
    if (e === null || typeof r?.name !== 'string') return fail('That VPN is gone.');
    try {
      e.profile = e.profile.renamed(r.name);
    } catch (err) {
      return fail(errText(err));
    }
    this.persist();
    this.changed();
    return { ok: true, data: null };
  }

  async install(): Promise<VpnResult<null>> {
    try {
      if (this.deps.launcher.find() === null) await this.deps.launcher.install();
      this.changed();
      return this.deps.launcher.find() === null ? fail('OpenVPN still was not found after installing. Restart rauha and try again.') : { ok: true, data: null };
    } catch (e) {
      return fail(errText(e));
    }
  }

  async connect(id: unknown): Promise<VpnResult<null>> {
    const e = this.find(id);
    if (e === null) return fail('That VPN is gone.');
    if (e.status.isActive()) return { ok: true, data: null };
    if (this.deps.launcher.find() === null) return fail('OpenVPN is not installed yet. Press Install OpenVPN first.');
    for (const other of this.entries) if (other !== e && other.status.isActive()) await this.stop(other);

    const attempt = ++e.attempt;
    e.status = e.status.starting(this.deps.now());
    this.changed();
    const current = (): boolean => e.attempt === attempt;
    try {
      mkdirSync(this.deps.runDir, { recursive: true, mode: 0o700 });
      const configPath = join(this.deps.runDir, `${e.id}.ovpn`);
      await writeFile(configPath, e.profile.configText(), { encoding: 'utf8', mode: 0o600 });
      e.configPath = configPath;
      const port = await this.deps.freePort();
      await this.deps.launcher.launch({ configPath, workDir: this.deps.runDir, managementPort: port });
      const link = await this.deps.attach(port, {
        onLine: (line) => {
          if (!current()) return;
          const next = e.status.heard(line, this.deps.now());
          if (next === e.status) return;
          e.status = next;
          const phase = next.view().phase;
          // 연결되면 풀어 둔 설정(키)을 바로 지운다. 실패하면 엔진을 끈다(같은 실패로 계속 다시 시도하지 않게)
          if (phase === 'connected') void this.shred(e);
          if (phase === 'failed') e.link?.send('signal SIGTERM');
          this.changed();
        },
        onClose: () => {
          this.closers.get(e.id)?.();
          this.closers.delete(e.id);
          if (!current()) return;
          e.link = null;
          e.status = e.status.ended('OpenVPN stopped before connecting.', this.deps.now());
          void this.shred(e);
          this.changed();
        },
      });
      if (!current()) {
        link.send('signal SIGTERM');
        return { ok: true, data: null };
      }
      e.link = link;
      link.send('state on');
      link.send('log on');
      link.send('hold release');
      return { ok: true, data: null };
    } catch (err) {
      if (current()) {
        e.status = VpnStatus.failed(errText(err), this.deps.now());
        void this.shred(e);
        this.changed();
      }
      return fail(errText(err));
    }
  }

  async disconnect(id: unknown): Promise<VpnResult<null>> {
    const e = this.find(id);
    if (e === null) return fail('That VPN is gone.');
    await this.stop(e);
    this.changed();
    return { ok: true, data: null };
  }

  private async stop(e: Entry): Promise<void> {
    e.attempt++;
    const link = e.link;
    e.link = null;
    e.status = VpnStatus.off();
    if (link !== null) {
      // OpenVPN 이 경로를 걷어 내고 끝날 때까지(최대 3초) 기다린 뒤 연결을 닫는다
      const closed = new Promise<void>((resolve) => this.closers.set(e.id, resolve));
      link.send('signal SIGTERM');
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([closed, new Promise((r) => (timer = setTimeout(r, 3000)))]);
      clearTimeout(timer);
      this.closers.delete(e.id);
      link.close();
    }
    await this.shred(e);
  }

  private async shred(e: Entry): Promise<void> {
    const p = e.configPath;
    if (p === null) return;
    e.configPath = null;
    await rm(p, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }

  /** 켜져 있거나 켜는 중인 VPN 이 있는지(앱을 끄기 전에 기다려야 하는지) */
  hasActive(): boolean {
    return this.entries.some((e) => e.link !== null || e.status.isActive());
  }

  /**
   * 앱을 끌 때: 끊기 신호를 보내고 OpenVPN 이 실제로 끝날 때(management 연결이 닫힐 때)까지 기다린다.
   * 신호만 쓰고 바로 끝내면 소켓에 남은 글이 버려져 VPN 이 몰래 남았다(실제로 겪음). 너무 오래 걸리면 waitMs 뒤 그냥 끝낸다.
   */
  async stopAllAndWait(waitMs = 3000): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const e of this.entries) {
      const link = e.link;
      if (link === null) continue;
      closing.push(new Promise<void>((resolve) => this.closers.set(e.id, resolve)));
      e.attempt++;
      e.link = null;
      e.status = VpnStatus.off();
      link.send('signal SIGTERM');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(closing), new Promise((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
    this.closers.clear();
    this.stopAll();
  }

  /** 앱을 끌 때(기다릴 수 없을 때): 켜 둔 VPN 에 끊기 신호를 보낸다 */
  stopAll(): void {
    for (const e of this.entries) {
      e.link?.send('signal SIGTERM');
      e.link = null;
      e.status = VpnStatus.off();
    }
    // 앱이 꺼지는 중이라 기다리지 않고, 남은 설정 파일만 동기로 지운다(못 지우면 다음 실행의 sweep 이 지운다)
    for (const e of this.entries) {
      if (e.configPath === null) continue;
      try {
        rmSync(e.configPath, { force: true });
      } catch {
        /* sweep */
      }
      e.configPath = null;
    }
  }

  /** 지난 실행이 남긴 풀린 설정을 지운다 */
  async sweep(): Promise<void> {
    await rm(this.deps.runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
  }

  /** 연결된 VPN 의 이름과 대역(팀원에게 알려 줄 때) */
  active(): { readonly name: string; readonly routes: readonly string[] } | null {
    const e = this.entries.find((x) => x.status.view().phase === 'connected');
    return e === undefined ? null : { name: e.profile.summary().name, routes: e.profile.summary().allTraffic ? [] : e.profile.summary().routes };
  }

  profileCount(): number {
    return this.entries.length;
  }

  activeName(): string | null {
    const e = this.entries.find((x) => x.status.view().phase === 'connected');
    return e === undefined ? null : e.profile.summary().name;
  }
}
