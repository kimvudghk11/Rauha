/** 새 버전 알림의 순수 규칙(버전 비교·릴리스 고르기·설치 파일 고르기·주소 검증). 바깥(네트워크·파일)을 모른다. */

export const RELEASES_URL = 'https://api.github.com/repos/kimvudghk11/rauha/releases?per_page=10';
export const DOWNLOAD_PREFIX = 'https://github.com/kimvudghk11/rauha/releases/download/';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** semver 버전(값 객체). `v` 접두사와 빌드 메타데이터는 무시한다. */
export class AppVersion {
  private constructor(
    private readonly core: readonly [number, number, number],
    private readonly pre: readonly string[],
  ) {}

  static parse(input: unknown): AppVersion | null {
    if (typeof input !== 'string') return null;
    const m = SEMVER.exec(input.trim());
    if (m === null) return null;
    return new AppVersion([Number(m[1]), Number(m[2]), Number(m[3])], m[4] === undefined ? [] : m[4].split('.'));
  }

  toString(): string {
    const base = this.core.join('.');
    return this.pre.length === 0 ? base : `${base}-${this.pre.join('.')}`;
  }

  equals(other: AppVersion): boolean {
    return this.compareTo(other) === 0;
  }

  isNewerThan(other: AppVersion): boolean {
    return this.compareTo(other) > 0;
  }

  /** 음수·0·양수. 정식 버전은 같은 숫자의 prerelease보다 높다. */
  compareTo(other: AppVersion): number {
    for (let i = 0; i < 3; i++) {
      const d = this.core[i]! - other.core[i]!;
      if (d !== 0) return d;
    }
    if (this.pre.length === 0 || other.pre.length === 0) return other.pre.length - this.pre.length;
    const n = Math.min(this.pre.length, other.pre.length);
    for (let i = 0; i < n; i++) {
      const d = compareIdentifier(this.pre[i]!, other.pre[i]!);
      if (d !== 0) return d;
    }
    return this.pre.length - other.pre.length;
  }
}

const isNumeric = (s: string): boolean => /^\d+$/.test(s);

/** 숫자 칸은 숫자로, 숫자 칸은 글 칸보다 낮게, 글 칸끼리는 사전순으로 */
function compareIdentifier(a: string, b: string): number {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  if (isNumeric(a)) return -1;
  if (isNumeric(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 내려받기 주소는 이 저장소의 릴리스 파일만 허용한다. */
export function isAllowedDownload(url: unknown): url is string {
  // GitHub는 저장소 이름을 바꾸면 응답의 주소에 새 대소문자(Rauha)를 쓴다. 호스트·소유자·저장소 이름은 대소문자를 가리지 않고 비교한다.
  if (typeof url !== 'string' || !url.toLowerCase().startsWith(DOWNLOAD_PREFIX.toLowerCase())) return false;
  const rest = url.slice(DOWNLOAD_PREFIX.length);
  return rest !== '' && !/[\s\\]/.test(rest) && !rest.split('/').some((seg) => seg === '..' || seg === '.');
}

export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
  /** GitHub가 알려 주는 파일의 SHA-256(소문자 16진수 64자). 없으면 null */
  readonly sha256: string | null;
}

export interface ReleaseInfo {
  readonly version: AppVersion;
  readonly pageUrl: string | null;
  readonly assets: readonly ReleaseAsset[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "sha256:<64자 16진수>" 모양만 인정한다 */
export function readDigest(raw: unknown): string | null {
  const m = typeof raw === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(raw) : null;
  return m === null ? null : (m[1] ?? '').toLowerCase();
}

function readAssets(raw: unknown): ReleaseAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: ReleaseAsset[] = [];
  for (const a of raw) if (isObject(a) && typeof a['name'] === 'string' && typeof a['browser_download_url'] === 'string') out.push({ name: a['name'], url: a['browser_download_url'], sha256: readDigest(a['digest']) });
  return out;
}

/** GitHub 릴리스 목록 응답에서 draft를 빼고 prerelease를 포함해 가장 높은 버전을 고른다. */
export function pickLatestRelease(input: unknown): ReleaseInfo | null {
  if (!Array.isArray(input)) return null;
  let best: ReleaseInfo | null = null;
  for (const r of input) {
    if (!isObject(r) || r['draft'] === true) continue;
    const version = AppVersion.parse(r['tag_name']);
    if (version === null) continue;
    if (best !== null && !version.isNewerThan(best.version)) continue;
    best = { version, pageUrl: typeof r['html_url'] === 'string' ? r['html_url'] : null, assets: readAssets(r['assets']) };
  }
  return best;
}

/** 이 컴퓨터에 맞는 설치 파일. 없거나 주소 검증을 못 넘으면 null. */
export function pickAsset(assets: readonly ReleaseAsset[], platform: string, arch: string): ReleaseAsset | null {
  const match = (re: RegExp) => assets.find((a) => re.test(a.name) && isAllowedDownload(a.url)) ?? null;
  if (platform === 'darwin' && arch === 'arm64') return match(/-mac-arm64\.dmg$/);
  if (platform === 'darwin' && arch === 'x64') return match(/-mac-x64\.dmg$/);
  if (platform === 'win32' && arch === 'x64') return match(/-Setup-.*-x64\.exe$/);
  return null;
}

/** 배너를 보일지: 지금보다 높은 버전이 있고, 나중에로 미룬 버전이 아니어야 한다. */
export function shouldShowBanner(current: AppVersion, latest: AppVersion | null, dismissed: AppVersion | null): boolean {
  if (latest === null || !latest.isNewerThan(current)) return false;
  return dismissed === null || latest.isNewerThan(dismissed);
}
