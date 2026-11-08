import { InstallFailure } from '../../shared/update-install.js';

/** 확인용 가짜 릴리스 목록(RAUHA_FAKE_UPDATE=1). 실제 GitHub를 부르지 않고 배너를 띄워 본다. */
export function fakeReleases(): unknown {
  const base = 'https://github.com/kimvudghk11/rauha/releases/download/v9.9.9/';
  const names = ['rauha-9.9.9-mac-arm64.dmg', 'rauha-9.9.9-mac-x64.dmg', 'rauha-Setup-9.9.9-x64.exe'];
  return [{ tag_name: 'v9.9.9', draft: false, prerelease: false, html_url: 'https://github.com/kimvudghk11/rauha/releases/tag/v9.9.9', assets: names.map((name) => ({ name, browser_download_url: base + name, digest: `sha256:${'a'.repeat(64)}` })) }];
}

/**
 * 확인용 가짜 설치기(RAUHA_FAKE_INSTALL=1). 실제 파일도 설치도 없이 단계만 흉내 낸다.
 * RAUHA_FAKE_INSTALL_FAIL=1이면 내려받는 도중 멈춤 실패로 끝낸다. 각 단계 사이는 stepMs만큼 둔다.
 */
export function fakeInstaller(failing: boolean, stepMs = 400): import('./update-service.js').Installer {
  const total = 90 * 1024 * 1024;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  return {
    async run(_request, hooks) {
      for (const n of [10, 35, 60, 85]) {
        if (hooks.signal.aborted) throw new InstallFailure('cancelled');
        hooks.onProgress({ percent: n, received: (total * n) / 100, total });
        await sleep(stepMs);
        if (failing && n === 35) throw new InstallFailure('stalled');
      }
      if (hooks.signal.aborted) throw new InstallFailure('cancelled');
      hooks.onStage('verifying');
      await sleep(stepMs);
      hooks.onStage('preparing');
      await sleep(stepMs);
      hooks.onInstalling({ target: '/Applications/Rauha.app', note: '설치 위치: /Applications/Rauha.app (확인용 가짜 설치)' });
    },
  };
}
