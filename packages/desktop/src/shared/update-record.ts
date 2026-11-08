import { AppVersion, isAllowedDownload, pickAsset, pickLatestRelease, shouldShowBanner } from './app-update.js';

/** 화면에 보내는 업데이트 상태(바깥 표시용) */
export interface UpdateView {
  readonly current: string;
  /** 마지막으로 확인에 성공한 시각(ISO). 아직 없으면 null */
  readonly checkedAt: string | null;
  readonly latest: string | null;
  readonly showBanner: boolean;
  /** 이 컴퓨터에 맞는 설치 파일이 있는지 */
  readonly hasDownload: boolean;
  readonly checking: boolean;
  /** 방금 확인이 실패했는지(조용한 한 줄 안내용) */
  readonly failed: boolean;
}

export interface CheckFinding {
  readonly latest: AppVersion | null;
  readonly downloadUrl: string | null;
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

  toView(current: AppVersion, flags: { checking?: boolean; failed?: boolean } = {}): UpdateView {
    return {
      current: current.toString(),
      checkedAt: this.checkedAt,
      latest: this.latest?.toString() ?? null,
      showBanner: shouldShowBanner(current, this.latest, this.dismissed),
      hasDownload: this.downloadUrl() !== null,
      checking: flags.checking ?? false,
      failed: flags.failed ?? false,
    };
  }
}

/** 릴리스 목록 응답에서 가장 높은 버전과 이 컴퓨터에 맞는 설치 파일을 찾는다. 릴리스가 하나도 없으면 null. */
export function findUpdate(releases: unknown, platform: string, arch: string): CheckFinding | null {
  const latest = pickLatestRelease(releases);
  if (latest === null) return null;
  return { latest: latest.version, downloadUrl: pickAsset(latest.assets, platform, arch)?.url ?? null };
}
