import { describe, expect, it } from 'vitest';
import { AppVersion } from '../../shared/app-update.js';
import { UpdateService, type FetchLike, type UpdateStore } from './update-service.js';

const DL = 'https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/';
const releases = [{ tag_name: 'v0.1.2', draft: false, prerelease: false, html_url: 'x', assets: [{ name: 'rauha-0.1.2-mac-arm64.dmg', browser_download_url: `${DL}rauha-0.1.2-mac-arm64.dmg` }] }, { tag_name: 'v0.1.1', assets: [] }];
const ok = (body: unknown): FetchLike => async () => ({ ok: true, json: async () => body });

function setup(fetch: FetchLike, opts: { enabled?: boolean; saved?: unknown } = {}) {
  const calls: string[] = [];
  const views: unknown[] = [];
  const opened: string[] = [];
  let saved: unknown = opts.saved ?? null;
  const store: UpdateStore = { load: async () => saved, save: async (v) => void (saved = v) };
  const service = new UpdateService({
    fetch: (url, init) => (calls.push(url), fetch(url, init)),
    store,
    current: AppVersion.parse('0.1.1')!,
    platform: 'darwin',
    arch: 'arm64',
    now: () => new Date('2026-11-08T01:00:00.000Z'),
    enabled: () => opts.enabled ?? true,
    openExternal: async (u) => void opened.push(u),
    onChange: (v) => views.push(v),
  });
  return { service, calls, views, opened, saved: () => saved };
}

describe('UpdateService', () => {
  it('릴리스 목록 주소(per_page=10)를 부르고 새 버전과 내 설치 파일을 기억한다', async () => {
    const t = setup(ok(releases));
    const view = await t.service.check();
    expect(t.calls).toEqual(['https://api.github.com/repos/kimvudghk11/rauha/releases?per_page=10']);
    expect(view).toMatchObject({ latest: '0.1.2', showBanner: true, hasDownload: true, failed: false, checking: false });
    expect(t.saved()).toMatchObject({ latest: '0.1.2' });
  });

  it('다시 켜도 저장된 배너가 이어진다', async () => {
    const first = setup(ok(releases));
    await first.service.check();
    const second = setup(ok([]), { saved: first.saved() });
    await second.service.init();
    expect(second.service.view()).toMatchObject({ latest: '0.1.2', showBanner: true });
  });

  it('네트워크 오류·403·모양 오류는 던지지 않고 실패로만 표시한다', async () => {
    const failing: FetchLike[] = [
      async () => {
        throw new Error('offline');
      },
      async () => ({ ok: false, json: async () => ({}) }),
      async () => ({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      }),
    ];
    for (const f of failing) {
      const t = setup(f);
      const view = await t.service.check();
      expect(view).toMatchObject({ failed: true, showBanner: false, checking: false });
      expect(t.saved()).toBeNull();
    }
  });

  it('실패한 뒤 성공하면 실패 표시가 사라진다', async () => {
    let fail = true;
    const t = setup(async () => (fail ? Promise.reject(new Error('x')) : { ok: true, json: async () => releases }));
    await t.service.check();
    fail = false;
    expect((await t.service.check()).failed).toBe(false);
  });

  it('확인에 시간 제한(10초) 신호를 넘긴다', async () => {
    let signal: AbortSignal | undefined;
    const t = setup(async (_u, init) => {
      signal = init.signal;
      return { ok: true, json: async () => [] };
    });
    await t.service.check();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('확인 중에 또 누르면 두 번 부르지 않는다', async () => {
    const t = setup(ok(releases));
    await Promise.all([t.service.check(), t.service.check()]);
    expect(t.calls).toHaveLength(1);
  });

  it('자동 확인은 설정이 꺼져 있으면 부르지 않고, 지금 확인은 꺼져 있어도 부른다', async () => {
    const t = setup(ok(releases), { enabled: false });
    await t.service.autoCheck();
    expect(t.calls).toHaveLength(0);
    await t.service.check();
    expect(t.calls).toHaveLength(1);
  });

  it('나중에를 누르면 배너가 숨고 저장되며 화면에 알린다', async () => {
    const t = setup(ok(releases));
    await t.service.check();
    const before = t.views.length;
    const view = await t.service.dismiss();
    expect(view.showBanner).toBe(false);
    expect(t.saved()).toMatchObject({ dismissed: '0.1.2' });
    expect(t.views.length).toBeGreaterThan(before);
  });

  it('내려받기는 검증을 통과한 주소만 브라우저로 연다', async () => {
    const t = setup(ok(releases));
    await t.service.check();
    expect(await t.service.download()).toBe(true);
    expect(t.opened).toEqual([`${DL}rauha-0.1.2-mac-arm64.dmg`]);
    const bad = setup(ok([]), { saved: { latest: '0.1.2', downloadUrl: 'https://evil.example/a.dmg' } });
    await bad.service.init();
    expect(await bad.service.download()).toBe(false);
    expect(bad.opened).toEqual([]);
  });
});
