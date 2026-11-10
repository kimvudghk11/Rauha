import { AppVersion, isAllowedDownload, pickAsset, pickLatestRelease, shouldShowBanner } from './app-update.js';
import { IDLE_INSTALL, type InstallState } from './update-install.js';
import type { AttemptOutcome } from './update-attempt.js';

/** 화면에 보내는 업데이트 상태(바깥 표시용) */
export interface UpdateView {
  readonly current: string;
  /** 마지막으로 확인에 성공한 시각(ISO). 아직 없으면 null */
  readonly checkedAt: string | null;
  readonly latest: string | null;
  /** 지금 버전보다 높은 버전이 알려져 있는지(나중에로 미뤘어도 true) */
  readonly newer: boolean;
  readonly showBanner: boolean;
  /** 이 컴퓨터에 맞는 설치 파일이 있는지 */
  readonly hasDownload: boolean;
  readonly checking: boolean;
  /** 방금 확인이 실패했는지(조용한 한 줄 안내용) */
  readonly failed: boolean;
  /** 확인이 실패한 이유 한 줄(실패하지 않았으면 null) */
  readonly failReason: string | null;
  /** 앱 안에서 바로 내려받아 설치할 수 있는지(설치본이고 이 컴퓨터용 파일이 있을 때) */
  readonly canInstall: boolean;
  readonly install: InstallState;
  /** 지난 설치 시도의 결과(다시 켜진 뒤 한 번 알린다). 없으면 null */
  readonly attempt: AttemptOutcome | null;
}

export interface CheckFinding {
  readonly latest: AppVersion | null;
  readonly downloadUrl: string | null;
  /** 설치 파일의 SHA-256(릴리스가 알려 준 것). 없으면 null */
  readonly downloadSha256?: string | null;
}

/** 마지막 확인 결과와 "나중에" 기록. 앱 데이터에 저장해 재시작해도 배너가 이어진다. */
export class UpdateRecord {
  private constructor(
    private readonly latest: AppVersion | null,
    private readonly download: string | null,
    private readonly checkedAt: string | null,
    private readonly dismissed: AppVersion | null,
  ) {}

  static empty(): UpdateRecord {
    return new UpdateRecord(null, null, null, null);
  }

  /** 파일에서 읽은 값. 틀린 모양은 빈 상태로 돌린다. */
  static from(input: unknown): UpdateRecord {
    if (typeof input !== 'object' || input === null) return UpdateRecord.empty();
    const o = input as Record<string, unknown>;
    return new UpdateRecord(
      AppVersion.parse(o['latest']),
      typeof o['downloadUrl'] === 'string' ? o['downloadUrl'] : null,
      typeof o['checkedAt'] === 'string' ? o['checkedAt'] : null,
      AppVersion.parse(o['dismissed']),
    );
  }

  toJSON(): Record<string, string | null> {
    return { latest: this.latest?.toString() ?? null, downloadUrl: this.download, checkedAt: this.checkedAt, dismissed: this.dismissed?.toString() ?? null };
  }

  /** 확인에 성공했다. 릴리스를 못 찾았으면(latest null) 이전 결과는 두고 시각만 바꾼다. */
  recordChecked(found: CheckFinding | null, at: string): UpdateRecord {
    if (found === null || found.latest === null) return new UpdateRecord(this.latest, this.download, at, this.dismissed);
    return new UpdateRecord(found.latest, found.downloadUrl, at, this.dismissed);
  }

  /** 지금 알려진 최신 버전을 "나중에"로 미룬다. 더 높은 버전이 나오면 다시 보인다. */
  dismiss(): UpdateRecord {
    return new UpdateRecord(this.latest, this.download, this.checkedAt, this.latest ?? this.dismissed);
  }

  /** 검증을 통과한 내려받기 주소만 돌려준다. */
  downloadUrl(): string | null {
    return isAllowedDownload(this.download) ? this.download : null;
  }

  toView(current: AppVersion, flags: { checking?: boolean; failed?: boolean; failReason?: string | null; canInstall?: boolean; install?: InstallState; attempt?: AttemptOutcome | null } = {}): UpdateView {
    return {
      current: current.toString(),
      checkedAt: this.checkedAt,
      latest: this.latest?.toString() ?? null,
      newer: this.latest !== null && this.latest.isNewerThan(current),
      showBanner: shouldShowBanner(current, this.latest, this.dismissed),
      hasDownload: this.downloadUrl() !== null,
      checking: flags.checking ?? false,
      failed: flags.failed ?? false,
      failReason: flags.failed === true ? flags.failReason ?? null : null,
      // 이미 최신이면 새로 설치할 것이 없다(같은 버전을 다시 설치하고 앱을 또 다시 켜는 일을 막는다)
      canInstall: (flags.canInstall ?? false) && this.downloadUrl() !== null && this.latest !== null && this.latest.isNewerThan(current),
      install: flags.install ?? IDLE_INSTALL,
      attempt: flags.attempt ?? null,
    };
  }
}

/** 릴리스 목록 응답에서 가장 높은 버전과 이 컴퓨터에 맞는 설치 파일을 찾는다. 릴리스가 하나도 없으면 null. */
export function findUpdate(releases: unknown, platform: string, arch: string): CheckFinding | null {
  const latest = pickLatestRelease(releases);
  if (latest === null) return null;
  const asset = pickAsset(latest.assets, platform, arch);
  return { latest: latest.version, downloadUrl: asset?.url ?? null, downloadSha256: asset?.sha256 ?? null };
}

export type CheckFailureKind = 'timeout' | 'network' | 'http' | 'parse';

/** 확인이 실패한 이유 한 줄 */
export function checkFailureText(kind: CheckFailureKind, status?: number): string {
  switch (kind) {
    case 'timeout':
      return '서버가 10초 안에 답하지 않았어요';
    case 'network':
      return '인터넷에 연결되어 있지 않거나 GitHub에 닿지 못했어요';
    case 'http':
      return status === 403 || status === 429 ? 'GitHub가 요청이 너무 많다고 잠시 막았어요. 조금 뒤에 다시 해 주세요' : `GitHub가 오류(${status ?? '?'})를 줬어요`;
    case 'parse':
      return '받은 답을 읽지 못했어요';
  }
}
