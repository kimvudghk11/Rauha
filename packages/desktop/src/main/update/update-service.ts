import { RELEASES_URL, type AppVersion } from '../../shared/app-update.js';
import { failureText, IDLE_INSTALL, InstallFailure, isInstallBusy, type InstallPhase, type InstallState } from '../../shared/update-install.js';
import { judgeAttempt, parseAttempt, type AttemptOutcome } from '../../shared/update-attempt.js';
import { checkFailureText, findUpdate, UpdateRecord, type CheckFailureKind, type UpdateView } from '../../shared/update-record.js';

export const FETCH_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export interface UpdateStore {
  load(): Promise<unknown>;
  save(json: unknown): Promise<void>;
}

export interface InstallRequest {
  readonly url: string;
  readonly sha256: string;
  /** 설치를 시작할 때의 버전과 받으려는 버전(다시 켜진 뒤 결과를 맞춰 보려고 기록한다) */
  readonly from: string;
  readonly to: string;
}

export interface InstallHooks {
  onProgress(progress: { percent: number | null; received: number; total: number | null }): void;
  onStage(stage: 'verifying' | 'preparing'): void;
  /** 설치 프로그램이 시작됐다. 곧 앱이 꺼진다. */
  onInstalling(info: { target: string | null; note: string | null }): void;
  /** 취소하면 신호가 울린다 */
  readonly signal: AbortSignal;
}

/** 설치 파일을 받아 설치하고 앱을 다시 켜는 일(설치본에서만 준다). 성공하면 앱이 곧 꺼진다. 실패하면 InstallFailure를 던진다. */
export interface Installer {
  run(request: InstallRequest, hooks: InstallHooks): Promise<void>;
}

/** 지난 설치 시도의 흔적(시도 기록과 스크립트 결과 글). 읽은 뒤 지운다. */
export interface AttemptStore {
  read(): Promise<{ record: unknown; result: string | null }>;
  clear(): Promise<void>;
}

export interface UpdateDeps {
  readonly installer?: Installer;
  readonly attempts?: AttemptStore;
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
  private failReason: string | null = null;
  private install: InstallState = IDLE_INSTALL;
  private attempt: AttemptOutcome | null = null;
  private abort: AbortController | null = null;
  /** 마지막 확인에서 릴리스가 알려 준 설치 파일 SHA-256(저장하지 않는다) */
  private sha256: string | null = null;

  constructor(private readonly deps: UpdateDeps) {}

  async init(): Promise<void> {
    this.record = UpdateRecord.from(await this.deps.store.load().catch(() => null));
    const stored = await this.deps.attempts?.read().catch(() => null);
    if (stored == null) return;
    this.attempt = judgeAttempt(parseAttempt(stored.record), stored.result, this.deps.current, this.deps.now());
    if (this.attempt !== null) await this.deps.attempts?.clear().catch(() => undefined);
  }

  view(): UpdateView {
    return this.record.toView(this.deps.current, { checking: this.checking, failed: this.failed, failReason: this.failReason, canInstall: this.deps.installer !== undefined, install: this.install, attempt: this.attempt });
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
    this.failReason = null;
    this.deps.onChange(this.view());
    let kind: CheckFailureKind | null = null;
    let status: number | undefined;
    try {
      let res;
      try {
        res = await this.deps.fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rauha-desktop' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      } catch (e) {
        throw new CheckError(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network');
      }
      if (!res.ok) throw new CheckError('http', res.status);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new CheckError('parse');
      }
      const found = findUpdate(body, this.deps.platform, this.deps.arch);
      if (found?.latest != null) this.sha256 = found.downloadSha256 ?? null;
      this.record = this.record.recordChecked(found, this.deps.now().toISOString());
      await this.deps.store.save(this.record.toJSON()).catch(() => undefined);
    } catch (e) {
      this.failed = true;
      kind = e instanceof CheckError ? e.kind : 'network';
      status = e instanceof CheckError ? e.status : undefined;
      this.failReason = checkFailureText(kind, status);
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
   * 실패하면 던지지 않고 failed 표시(이유 한 줄)만 한다(브라우저로 받는 길은 그대로 있다). 이미 진행 중이면 아무것도 안 한다.
   */
  async installNow(): Promise<boolean> {
    const installer = this.deps.installer;
    if (this.record.downloadUrl() === null || installer === undefined) return false;
    if (isInstallBusy(this.install)) return false;
    this.attempt = null;
    const abort = new AbortController();
    this.abort = abort;
    let stage: InstallPhase = 'checking';
    const set = (next: InstallState): void => {
      this.install = next;
      this.deps.onChange(this.view());
    };
    const fail = (error: unknown): boolean => {
      this.abort = null;
      if (error instanceof InstallFailure && error.code === 'cancelled') set(IDLE_INSTALL);
      else set({ phase: 'failed', percent: null, reason: failureText(error), failedAt: stage, target: this.install.target ?? null, targetNote: this.install.targetNote ?? null });
      return false;
    };
    // 파일의 SHA-256은 저장하지 않으니, 모르면 먼저 새로 확인한다. 끝내 모르면 검증 없이 설치하지 않는다.
    if (this.sha256 === null) {
      set({ phase: 'checking', percent: null });
      const view = await this.check();
      if (abort.signal.aborted) return fail(new InstallFailure('cancelled'));
      if (view.failed) return fail(new InstallFailure('network'));
    }
    const url = this.record.downloadUrl();
    const sha256 = this.sha256;
    if (url === null || sha256 === null) return fail(new InstallFailure(url === null ? 'no-download' : 'missing-checksum'));
    const to = this.record.toView(this.deps.current).latest;
    stage = 'downloading';
    set({ phase: 'downloading', percent: null });
    try {
      await installer.run(
        { url, sha256, from: this.deps.current.toString(), to: to ?? this.deps.current.toString() },
        {
          signal: abort.signal,
          onProgress: (p) => set({ phase: 'downloading', percent: p.percent, receivedBytes: p.received, totalBytes: p.total }),
          onStage: (next) => {
            stage = next;
            set({ phase: next, percent: next === 'verifying' ? 100 : null });
          },
          onInstalling: (info) => {
            stage = 'installing';
            set({ phase: 'installing', percent: null, target: info.target, targetNote: info.note });
          },
        },
      );
      return true;
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * 모달의 취소·닫기. 내려받는 중이면 멈추고 받은 파일을 지운다(설치기가 지운다). 실패 화면이나 지난 시도 알림이면 치운다.
   * 확인·검증·설치 단계에서는 아무것도 하지 않는다.
   */
  async cancel(): Promise<UpdateView> {
    if (this.install.phase === 'downloading' || this.install.phase === 'checking') {
      this.abort?.abort();
      // 설치기가 취소를 알아차려 던질 때까지 기다리지 않고, 아직 확인 중이면 바로 쉬는 상태로 돌린다
      if (this.install.phase === 'checking') this.install = IDLE_INSTALL;
    } else if (this.install.phase === 'failed') this.install = IDLE_INSTALL;
    this.attempt = null;
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

class CheckError extends Error {
  constructor(
    readonly kind: CheckFailureKind,
    readonly status?: number,
  ) {
    super(kind);
  }
}
