import { describe, expect, it } from 'vitest';
import { AppVersion, isAllowedDownload, pickAsset } from '../../shared/app-update.js';
import { UpdateService, type FetchLike, type Installer, type UpdateStore } from './update-service.js';

const BASE = 'https://github.com/kimvudghk11/rauha/releases/download/';
const SHA = 'b'.repeat(64);
const asset = (version: string) => ({ name: `rauha-${version}-mac-arm64.dmg`, browser_download_url: `${BASE}v${version}/rauha-${version}-mac-arm64.dmg`, digest: `sha256:${SHA}` });
const release = (version: string) => ({ tag_name: `v${version}`, draft: false, prerelease: false, html_url: 'x', assets: [asset(version)] });

function setup(current: string, served: unknown, saved: unknown = null) {
  const installs: string[] = [];
  const installer: Installer = { run: async (req) => void installs.push(req.url) };
  const fetch: FetchLike = async () => ({ ok: true, json: async () => served });
  const store: UpdateStore = { load: async () => saved, save: async () => undefined };
  const service = new UpdateService({
    installer,
    fetch,
    store,
    current: AppVersion.parse(current)!,
    platform: 'darwin',
    arch: 'arm64',
    now: () => new Date('2026-11-11T00:00:00.000Z'),
    enabled: () => true,
    openExternal: async () => undefined,
    onChange: () => undefined,
  });
  return { service, installs };
}

describe('업데이트 설치 우회 시도', () => {
  it('이미 최신이면 설치 요청(IPC 직접 호출)을 해도 설치하지 않는다', async () => {
    const t = setup('0.1.11', [release('0.1.11')]);
    await t.service.init();
    await t.service.check();
    expect(await t.service.installNow()).toBe(false);
    expect(t.installs).toEqual([]);
  });

  it('저장 파일을 높은 버전으로 바꿔 둬도, 새로 확인해 보니 최신이면 설치하지 않는다', async () => {
    const saved = { latest: '9.9.9', downloadUrl: `${BASE}v9.9.9/rauha-9.9.9-mac-arm64.dmg`, checkedAt: '2026-11-10T00:00:00.000Z', dismissed: null };
    const t = setup('0.1.11', [release('0.1.11')], saved);
    await t.service.init();
    expect(t.service.view().newer).toBe(true);
    expect(await t.service.installNow()).toBe(false);
    expect(t.installs).toEqual([]);
  });

  it('더 높은 버전이 있고 검증이 되면 설치한다(정상 길은 막히지 않는다)', async () => {
    const t = setup('0.1.11', [release('0.1.12')]);
    await t.service.init();
    await t.service.check();
    expect(await t.service.installNow()).toBe(true);
    expect(t.installs).toEqual([`${BASE}v0.1.12/rauha-0.1.12-mac-arm64.dmg`]);
  });

  it('설치 요청을 동시에 여러 번 보내도 설치기는 한 번만 돈다', async () => {
    const t = setup('0.1.11', [release('0.1.12')]);
    await t.service.init();
    await t.service.check();
    await Promise.all([t.service.installNow(), t.service.installNow(), t.service.installNow()]);
    expect(t.installs.length).toBe(1);
  });

  it('낮은 버전(다운그레이드) 릴리스만 있으면 설치하지 않는다', async () => {
    const t = setup('0.1.11', [release('0.1.10'), release('0.0.1')]);
    await t.service.init();
    expect(await t.service.installNow()).toBe(false);
    expect(t.installs).toEqual([]);
  });
});

describe('설치 파일 주소 허용 목록 우회 시도', () => {
  const ok = `${BASE}v0.1.12/rauha-0.1.12-mac-arm64.dmg`;
  it('정상 주소는 허용한다', () => {
    expect(isAllowedDownload(ok)).toBe(true);
    expect(isAllowedDownload(ok.replace('kimvudghk11/rauha', 'KimVudghk11/Rauha'))).toBe(true);
  });

  const bad = [
    `${BASE}%2e%2e/%2e%2e/evil/x/raw/main.exe`,
    `${BASE}%2E%2E/%2E%2E/evil/x.exe`,
    `${BASE}v1/%2e%2e%2f%2e%2e%2fx.exe`,
    `${BASE}v1/..%2fx.exe`,
    `${BASE}v1/../../../evil/x.exe`,
    `${BASE}v1/./x.exe`,
    `${BASE}v1/x.exe?redirect=https://evil.example/x.exe`,
    `${BASE}v1/x.exe#frag`,
    `${BASE}v1/x.exe:stream`,
    `${BASE}v1/x%00.exe`,
    `${BASE}v1/x.exe `,
    `${BASE}v1/x\\y.exe`,
    `${BASE}\tv1/x.exe`,
    `${BASE}`,
    `${BASE}v1`,
    `${BASE}v1/`,
    `${BASE}v1/a/b.exe`,
    'https://github.com.evil.example/kimvudghk11/rauha/releases/download/v1/x.exe',
    'https://evil.example/https://github.com/kimvudghk11/rauha/releases/download/v1/x.exe',
    'http://github.com/kimvudghk11/rauha/releases/download/v1/x.exe',
    'https://user@github.com/kimvudghk11/rauha/releases/download/v1/x.exe',
    'https://github.com/kimvudghk11/rauha-evil/releases/download/v1/x.exe',
    'https://github.com/kimvudghk11/rauha/releases/download2/v1/x.exe',
  ];
  it.each(bad)('거절한다: %s', (url) => {
    expect(isAllowedDownload(url)).toBe(false);
    expect(pickAsset([{ name: 'rauha-1-mac-arm64.dmg', url, sha256: SHA }], 'darwin', 'arm64')).toBeNull();
  });
  it('문자열이 아니면 거절한다', () => {
    for (const v of [null, undefined, 1, {}, [], ['x']]) expect(isAllowedDownload(v)).toBe(false);
  });
});
