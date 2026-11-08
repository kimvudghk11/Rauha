import { describe, expect, it } from 'vitest';
import { AppVersion, DOWNLOAD_PREFIX, isAllowedDownload, pickAsset, pickLatestRelease, shouldShowBanner } from './app-update.js';

const v = (s: string): AppVersion => AppVersion.parse(s)!;
const asset = (name: string) => ({ name, url: `${DOWNLOAD_PREFIX}v0.1.2/${name}`, sha256: null });
const rawAsset = (name: string) => ({ name, browser_download_url: `${DOWNLOAD_PREFIX}v0.1.2/${name}` });
const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `https://github.com/kimvudghk11/rauha/releases/tag/${tag}`, draft: false, prerelease: false, assets: [], ...extra });

describe('AppVersion', () => {
  it('v 접두사가 있어도 없어도 같은 버전으로 읽는다', () => {
    expect(v('v0.1.2').compareTo(v('0.1.2'))).toBe(0);
    expect(v('v0.1.2').toString()).toBe('0.1.2');
  });

  it('버전 모양이 아니면 읽지 않는다', () => {
    expect(AppVersion.parse('latest')).toBeNull();
    expect(AppVersion.parse('1.2')).toBeNull();
    expect(AppVersion.parse('')).toBeNull();
    expect(AppVersion.parse(42)).toBeNull();
  });

  it('숫자로 비교한다(0.1.10은 0.1.9보다 높다)', () => {
    expect(v('0.1.10').isNewerThan(v('0.1.9'))).toBe(true);
    expect(v('1.0.0').isNewerThan(v('0.99.99'))).toBe(true);
    expect(v('0.1.1').isNewerThan(v('0.1.1'))).toBe(false);
  });

  it('같은 숫자면 정식 버전이 prerelease보다 높다', () => {
    expect(v('0.2.0').isNewerThan(v('0.2.0-beta.1'))).toBe(true);
    expect(v('0.2.0-beta.1').isNewerThan(v('0.1.9'))).toBe(true);
  });

  it('prerelease끼리는 숫자 칸을 숫자로, 긴 쪽을 더 높게 비교한다', () => {
    expect(v('0.2.0-beta.10').isNewerThan(v('0.2.0-beta.2'))).toBe(true);
    expect(v('0.2.0-beta.1.1').isNewerThan(v('0.2.0-beta.1'))).toBe(true);
    expect(v('0.2.0-rc.1').isNewerThan(v('0.2.0-beta.9'))).toBe(true);
    expect(v('0.2.0-beta.1').isNewerThan(v('0.2.0-1'))).toBe(true);
  });

  it('빌드 메타데이터(+...)는 비교에 쓰지 않는다', () => {
    expect(v('0.1.2+abc').compareTo(v('0.1.2'))).toBe(0);
  });
});

describe('pickLatestRelease', () => {
  it('prerelease를 포함해 가장 높은 버전을 고른다(목록 순서와 상관없이)', () => {
    const list = [release('v0.1.1'), release('v0.2.0-beta.1', { prerelease: true }), release('v0.1.9')];
    expect(pickLatestRelease(list)?.version.toString()).toBe('0.2.0-beta.1');
  });

  it('draft는 뺀다', () => {
    expect(pickLatestRelease([release('v0.3.0', { draft: true }), release('v0.1.1')])?.version.toString()).toBe('0.1.1');
  });

  it('버전이 아닌 태그와 모양이 틀린 항목은 건너뛴다', () => {
    expect(pickLatestRelease([null, 'x', { tag_name: 'nightly' }, release('v0.1.1')])?.version.toString()).toBe('0.1.1');
  });

  it('배열이 아니거나 후보가 없으면 null이다', () => {
    expect(pickLatestRelease({ message: 'rate limit' })).toBeNull();
    expect(pickLatestRelease([])).toBeNull();
  });

  it('asset 중 이름·주소가 글이 아닌 것은 버린다', () => {
    const r = pickLatestRelease([release('v0.1.2', { assets: [rawAsset('a.dmg'), { name: 1 }, null] })]);
    expect(r?.assets).toHaveLength(1);
  });
});

describe('pickAsset', () => {
  const assets = [asset('rauha-0.1.2-mac-arm64.dmg'), asset('rauha-0.1.2-mac-x64.dmg'), asset('rauha-0.1.2-mac-arm64.zip'), asset('rauha-Setup-0.1.2-x64.exe'), asset('rauha-Setup-0.1.2-x64.exe.blockmap')];

  it('맥 Apple 칩은 arm64 dmg를 고른다', () => {
    expect(pickAsset(assets, 'darwin', 'arm64')?.name).toBe('rauha-0.1.2-mac-arm64.dmg');
  });

  it('맥 인텔은 x64 dmg를 고른다', () => {
    expect(pickAsset(assets, 'darwin', 'x64')?.name).toBe('rauha-0.1.2-mac-x64.dmg');
  });

  it('Windows는 Setup x64 exe를 고른다(blockmap은 아니다)', () => {
    expect(pickAsset(assets, 'win32', 'x64')?.name).toBe('rauha-Setup-0.1.2-x64.exe');
  });

  it('맞는 파일이 없거나 지원하지 않는 플랫폼이면 null이다', () => {
    expect(pickAsset(assets, 'linux', 'x64')).toBeNull();
    expect(pickAsset(assets, 'win32', 'arm64')).toBeNull();
    expect(pickAsset([asset('rauha-0.1.2-mac-arm64.dmg')], 'darwin', 'x64')).toBeNull();
  });

  it('내려받기 주소 검증을 통과하지 못하는 asset은 고르지 않는다', () => {
    const bad = [{ name: 'rauha-0.1.2-mac-arm64.dmg', url: 'https://evil.example/rauha-0.1.2-mac-arm64.dmg', sha256: null }];
    expect(pickAsset(bad, 'darwin', 'arm64')).toBeNull();
  });
});

describe('isAllowedDownload', () => {
  it('이 저장소 릴리스 내려받기 주소만 허용한다', () => {
    expect(isAllowedDownload(`${DOWNLOAD_PREFIX}v0.1.2/rauha-0.1.2-mac-arm64.dmg`)).toBe(true);
  });

  it('다른 저장소·http·비슷한 주소·글이 아닌 값은 막는다', () => {
    expect(isAllowedDownload('https://github.com/other/rauha/releases/download/v1/a.dmg')).toBe(false);
    expect(isAllowedDownload('http://github.com/kimvudghk11/rauha/releases/download/v1/a.dmg')).toBe(false);
    expect(isAllowedDownload('https://github.com.evil.com/kimvudghk11/rauha/releases/download/v1/a.dmg')).toBe(false);
    expect(isAllowedDownload(`${DOWNLOAD_PREFIX}../../../x`)).toBe(false);
    expect(isAllowedDownload('file:///etc/passwd')).toBe(false);
    expect(isAllowedDownload(null)).toBe(false);
  });
});

describe('shouldShowBanner', () => {
  it('새 버전이 있고 그 버전을 나중에로 미루지 않았으면 보인다', () => {
    expect(shouldShowBanner(v('0.1.1'), v('0.1.2'), null)).toBe(true);
  });

  it('지금 버전과 같거나 낮으면 숨긴다', () => {
    expect(shouldShowBanner(v('0.1.2'), v('0.1.2'), null)).toBe(false);
    expect(shouldShowBanner(v('0.1.3'), v('0.1.2'), null)).toBe(false);
  });

  it('나중에를 누른 버전은 숨기고 더 높은 버전이 나오면 다시 보인다', () => {
    expect(shouldShowBanner(v('0.1.1'), v('0.1.2'), v('0.1.2'))).toBe(false);
    expect(shouldShowBanner(v('0.1.1'), v('0.1.3'), v('0.1.2'))).toBe(true);
  });

  it('확인 결과가 없으면 숨긴다', () => {
    expect(shouldShowBanner(v('0.1.1'), null, null)).toBe(false);
  });
});
