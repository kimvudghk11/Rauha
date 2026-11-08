import { RELEASES_URL, type AppVersion } from '../../shared/app-update.js';
import { IDLE_INSTALL, type InstallState } from '../../shared/update-install.js';
import { findUpdate, UpdateRecord, type UpdateView } from '../../shared/update-record.js';

export const FETCH_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface UpdateStore {
  load(): Promise<unknown>;
  save(json: unknown): Promise<void>;
}

/** 설치 파일을 받아 설치하고 앱을 다시 켜는 일(설치본에서만 준다). 성공하면 앱이 곧 꺼진다. */
export interface Installer {
  run(url: string, sha256: string, onProgress: (percent: number | null) => void, onInstalling: () => void): Promise<void>;
}

export interface UpdateDeps {
  readonly installer?: Installer;
  readonly fetch: FetchLike;
  readonly store: UpdateStore;
  readonly current: AppVersion;
  readonly platform: string;
  readonly arch: string;
  readonly now: () => Date;
  /** 설정의 "자동으로 확인"이 켜져 있는지 */
  readonly enabled: () => boolean;
  readonly openExternal: (url: string) => Promise<void>;
  /** 상태가 바뀔 때마다 화면에 알린다 */
  readonly onChange: (view: UpdateView) => void;
}

/** 불러오기 → 엔티티 메서드 → 저장만 한다. 확인 실패(오프라인·403 한도)는 던지지 않고 failed 표시만 한다. */
export class UpdateService {
  private record = UpdateRecord.empty();
  private checking = false;
  private failed = false;
  private install: InstallState = IDLE_INSTALL;
  /** 마지막 확인에서 릴리스가 알려 준 설치 파일 SHA-256(저장하지 않는다) */
  private sha256: string | null = null;

  constructor(private readonly deps: UpdateDeps) {}

  async init(): Promise<void> {
    this.record = UpdateRecord.from(await this.deps.store.load().catch(() => null));
  }

  view(): UpdateView {
    return this.record.toView(this.deps.current, { checking: this.checking, failed: this.failed, canInstall: this.deps.installer !== undefined, install: this.install });
  }

  /** 시작 5초 뒤·6시간마다 부르는 자동 확인. 설정이 꺼져 있으면 아무것도 안 한다. */
  async autoCheck(): Promise<void> {
    if (this.deps.enabled()) await this.check();
  }

  /** "지금 확인". 이미 확인 중이면 그 상태를 그대로 돌려준다. */
  async check(): Promise<UpdateView> {
    if (this.checking) return this.view();
    this.checking = true;
    this.failed = false;
    this.deps.onChange(this.view());
    try {
      const res = await this.deps.fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rauha-desktop' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error('release list unavailable');
      const found = findUpdate(await res.json(), this.deps.platform, this.deps.arch);
      if (found?.latest != null) this.sha256 = found.downloadSha256 ?? null;
      this.record = this.record.recordChecked(found, this.deps.now().toISOString());
      await this.deps.store.save(this.record.toJSON()).catch(() => undefined);
    } catch {
      this.failed = true;
    } finally {
      this.checking = false;
    }
    const view = this.view();
    this.deps.onChange(view);
    return view;
  }

  async dismiss(): Promise<UpdateView> {
    this.record = this.record.dismiss();
    await this.deps.store.save(this.record.toJSON()).catch(() => undefined);
    const view = this.view();
    this.deps.onChange(view);
    return view;
  }

  /**
   * 앱 안에서 내려받아 설치하고 다시 켠다. 검증을 통과한 설치 파일 주소만 쓴다.
   * 실패하면 던지지 않고 failed 표시만 한다(브라우저로 받는 길은 그대로 있다). 이미 진행 중이면 아무것도 안 한다.
   */
  async installNow(): Promise<boolean> {
    const installer = this.deps.installer;
    if (this.record.downloadUrl() === null || installer === undefined) return false;
    if (this.install.phase === 'downloading' || this.install.phase === 'installing') return false;
    // 파일의 SHA-256은 저장하지 않으니, 모르면 먼저 새로 확인한다. 끝내 모르면 검증 없이 설치하지 않는다.
    if (this.sha256 === null) await this.check();
    const url = this.record.downloadUrl();
    const sha256 = this.sha256;
    const set = (next: InstallState): void => {
      this.install = next;
      this.deps.onChange(this.view());
    };
    if (url === null || sha256 === null) {
      set({ phase: 'failed', percent: null });
      return false;
    }
    set({ phase: 'downloading', percent: null });
    try {
      await installer.run(
        url,
        sha256,
        (percent) => set({ phase: 'downloading', percent }),
        () => set({ phase: 'installing', percent: null }),
      );
      return true;
    } catch {
      set({ phase: 'failed', percent: null });
      return false;
    }
  }

  /** 검증을 통과한 설치 파일 주소만 브라우저로 연다. 열 주소가 없으면 false. */
  async download(): Promise<boolean> {
    const url = this.record.downloadUrl();
    if (url === null) return false;
    await this.deps.openExternal(url);
    return true;
  }
}
