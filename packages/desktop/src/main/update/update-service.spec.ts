import { describe, expect, it } from 'vitest';
import { AppVersion } from '../../shared/app-update.js';
import { InstallFailure } from '../../shared/update-install.js';
import { UpdateService, type AttemptStore, type FetchLike, type Installer, type UpdateStore } from './update-service.js';

const DL = 'https://github.com/kimvudghk11/rauha/releases/download/v0.1.2/';
const SHA = 'a'.repeat(64);
const releases = [{ tag_name: 'v0.1.2', draft: false, prerelease: false, html_url: 'x', assets: [{ name: 'rauha-0.1.2-mac-arm64.dmg', browser_download_url: `${DL}rauha-0.1.2-mac-arm64.dmg`, digest: `sha256:${SHA}` }] }, { tag_name: 'v0.1.1', assets: [] }];
const ok = (body: unknown): FetchLike => async () => ({ ok: true, json: async () => body });

function setup(fetch: FetchLike, opts: { enabled?: boolean; saved?: unknown; installer?: Installer; attempts?: AttemptStore } = {}) {
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
    ...(opts.installer === undefined ? {} : { installer: opts.installer }),
    ...(opts.attempts === undefined ? {} : { attempts: opts.attempts }),
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

  it('설치기가 없으면(개발 실행) 앱 안 설치를 못 하고 canInstall이 거짓이다', async () => {
    const t = setup(ok(releases));
    await t.service.check();
    expect(t.service.view().canInstall).toBe(false);
    expect(await t.service.installNow()).toBe(false);
  });

  it('이미 최신 버전이면 지금 업데이트를 눌러도 설치기를 돌리지 않는다(앱을 또 다시 켜지 않는다)', async () => {
    let ran = 0;
    const installer: Installer = { async run() { ran += 1; } };
    const saved = { latest: '0.1.1', downloadUrl: `${DL}rauha-0.1.1-mac-arm64.dmg`, checkedAt: '2026-11-08T00:00:00.000Z', dismissed: null };
    const t = setup(ok(releases), { installer, saved });
    await t.service.init();
    expect(t.service.view()).toMatchObject({ newer: false, canInstall: false });
    expect(await t.service.installNow()).toBe(false);
    expect(ran).toBe(0);
  });

  it('앱 안 설치는 검증된 주소로 설치기를 돌리고 내려받는 중 → 확인 → 설치 중 상태를 알린다', async () => {
    const seen: Array<{ url: string; sha256: string; from: string; to: string }> = [];
    const installer: Installer = {
      async run(request, hooks) {
        seen.push(request);
        hooks.onProgress({ percent: 50, received: 50, total: 100 });
        hooks.onStage('verifying');
        hooks.onStage('preparing');
        hooks.onInstalling({ target: '/Applications/Rauha.app', note: '설치 위치: /Applications/Rauha.app' });
      },
    };
    const t = setup(ok(releases), { installer });
    await t.service.check();
    expect(t.service.view().canInstall).toBe(true);
    expect(await t.service.installNow()).toBe(true);
    expect(seen).toEqual([{ url: `${DL}rauha-0.1.2-mac-arm64.dmg`, sha256: SHA, from: '0.1.1', to: '0.1.2' }]);
    const phases = (t.views as Array<{ install: { phase: string; percent: number | null } }>).map((v) => `${v.install.phase}:${v.install.percent}`);
    expect(phases).toEqual(expect.arrayContaining(['downloading:null', 'downloading:50', 'verifying:100', 'preparing:null', 'installing:null']));
    expect(t.service.view().install).toMatchObject({ phase: 'installing', target: '/Applications/Rauha.app', targetNote: '설치 위치: /Applications/Rauha.app' });
  });

  it('설치에 실패하면 던지지 않고 이유 한 줄과 멈춘 단계를 담은 실패 상태로 두며 브라우저 내려받기는 그대로 된다', async () => {
    const installer: Installer = {
      run: async (_r, hooks) => {
        hooks.onStage('verifying');
        throw new InstallFailure('checksum');
      },
    };
    const t = setup(ok(releases), { installer });
    await t.service.check();
    expect(await t.service.installNow()).toBe(false);
    expect(t.service.view().install).toMatchObject({ phase: 'failed', failedAt: 'verifying', reason: expect.stringContaining('SHA-256') });
    expect(await t.service.download()).toBe(true);
    expect(t.opened).toEqual([`${DL}rauha-0.1.2-mac-arm64.dmg`]);
  });

  it('실패한 뒤 다시 시도하면 새로 시작하고, 닫으면 쉬는 상태로 돌아간다', async () => {
    let calls = 0;
    const installer: Installer = {
      run: async () => {
        calls += 1;
        if (calls === 1) throw new InstallFailure('network');
      },
    };
    const t = setup(ok(releases), { installer });
    await t.service.check();
    await t.service.installNow();
    expect(t.service.view().install.phase).toBe('failed');
    expect((await t.service.cancel()).install.phase).toBe('idle');
    await t.service.installNow();
    expect(calls).toBe(2);
  });

  it('내려받는 중 취소하면 설치기에 취소 신호를 보내고 실패 표시 없이 쉬는 상태로 돌아간다', async () => {
    const installer: Installer = {
      run: (_r, hooks) =>
        new Promise((_resolve, reject) => {
          hooks.onProgress({ percent: 10, received: 10, total: 100 });
          hooks.signal.addEventListener('abort', () => reject(new InstallFailure('cancelled')));
        }),
    };
    const t = setup(ok(releases), { installer });
    await t.service.check();
    const running = t.service.installNow();
    await Promise.resolve();
    await t.service.cancel();
    expect(await running).toBe(false);
    expect(t.service.view().install.phase).toBe('idle');
  });

  it('설치 단계에서는 닫기·취소가 아무것도 바꾸지 않는다', async () => {
    const installer: Installer = { run: async (_r, hooks) => hooks.onInstalling({ target: null, note: null }) };
    const t = setup(ok(releases), { installer });
    await t.service.check();
    await t.service.installNow();
    expect((await t.service.cancel()).install.phase).toBe('installing');
  });

  it('이미 내려받는 중이면 두 번째 설치 요청은 무시한다', async () => {
    let release: () => void = () => undefined;
    let runs = 0;
    const installer: Installer = {
      run: () => {
        runs += 1;
        return new Promise<void>((r) => (release = r));
      },
    };
    const t = setup(ok(releases), { installer });
    await t.service.check();
    const first = t.service.installNow();
    expect(await t.service.installNow()).toBe(false);
    release();
    await first;
    expect(runs).toBe(1);
  });

  it('확인 실패는 이유를 담는다: 연결 없음·시간 초과·한도(403)·오류 번호·읽기 실패', async () => {
    const reason = async (f: FetchLike): Promise<string | null> => (await setup(f).service.check()).failReason;
    expect(
      await reason(async () => {
        throw new Error('offline');
      }),
    ).toContain('인터넷');
    expect(
      await reason(async () => {
        const e = new Error('t');
        e.name = 'TimeoutError';
        throw e;
      }),
    ).toContain('10초');
    expect(await reason(async () => ({ ok: false, status: 403, json: async () => ({}) }))).toContain('요청이 너무 많다');
    expect(await reason(async () => ({ ok: false, status: 500, json: async () => ({}) }))).toContain('(500)');
    expect(
      await reason(async () => ({
        ok: true,
        json: async () => {
          throw new Error('x');
        },
      })),
    ).toContain('읽지 못했어요');
    expect(await reason(ok(releases))).toBeNull();
  });

  it('새 SHA-256을 모르는데 확인도 실패하면 받지 않고 실패로 둔다', async () => {
    let runs = 0;
    const installer: Installer = { run: async () => void (runs += 1) };
    const offline: FetchLike = async () => {
      throw new Error('offline');
    };
    const t = setup(offline, { installer, saved: { latest: '0.1.2', downloadUrl: `${DL}rauha-0.1.2-mac-arm64.dmg` } });
    await t.service.init();
    expect(await t.service.installNow()).toBe(false);
    expect(runs).toBe(0);
    expect(t.service.view().install).toMatchObject({ phase: 'failed', failedAt: 'checking' });
  });
});

describe('지난 설치 시도 알림', () => {
  const stored = (result: string | null) => {
    let cleared = false;
    const attempts: AttemptStore = {
      read: async () => ({ record: { from: '0.1.1', to: '0.1.2', target: '/Applications/Rauha.app', at: '2026-11-07T00:00:00.000Z', log: '/u/update-swap.log' }, result }),
      clear: async () => void (cleared = true),
    };
    return { attempts, wasCleared: () => cleared };
  };

  it('버전이 안 바뀌고 스크립트가 실패를 남겼으면 시작할 때 이유와 함께 알리고 흔적을 지운다', async () => {
    const s = stored('fail copy');
    const t = setup(ok(releases), { attempts: s.attempts });
    await t.service.init();
    expect(t.service.view().attempt).toMatchObject({ kind: 'failed', version: '0.1.2', reason: expect.stringContaining('복사하지 못했어요') });
    expect(s.wasCleared()).toBe(true);
    expect((await t.service.cancel()).attempt).toBeNull();
  });
});
