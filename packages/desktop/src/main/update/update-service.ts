import { RELEASES_URL, type AppVersion } from '../../shared/app-update.js';
import { findUpdate, UpdateRecord, type UpdateView } from '../../shared/update-record.js';

export const FETCH_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface UpdateStore {
  load(): Promise<unknown>;
  save(json: unknown): Promise<void>;
}

export interface UpdateDeps {
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

  constructor(private readonly deps: UpdateDeps) {}

  async init(): Promise<void> {
    this.record = UpdateRecord.from(await this.deps.store.load().catch(() => null));
  }

  view(): UpdateView {
    return this.record.toView(this.deps.current, { checking: this.checking, failed: this.failed });
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
      this.record = this.record.recordChecked(findUpdate(await res.json(), this.deps.platform, this.deps.arch), this.deps.now().toISOString());
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

  /** 검증을 통과한 설치 파일 주소만 브라우저로 연다. 열 주소가 없으면 false. */
  async download(): Promise<boolean> {
    const url = this.record.downloadUrl();
    if (url === null) return false;
    await this.deps.openExternal(url);
    return true;
  }
}
