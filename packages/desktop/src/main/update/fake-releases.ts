/** 확인용 가짜 릴리스 목록(RAUHA_FAKE_UPDATE=1). 실제 GitHub를 부르지 않고 배너를 띄워 본다. */
export function fakeReleases(): unknown {
  const base = 'https://github.com/kimvudghk11/rauha/releases/download/v9.9.9/';
  const names = ['rauha-9.9.9-mac-arm64.dmg', 'rauha-9.9.9-mac-x64.dmg', 'rauha-Setup-9.9.9-x64.exe'];
  return [{ tag_name: 'v9.9.9', draft: false, prerelease: false, html_url: 'https://github.com/kimvudghk11/rauha/releases/tag/v9.9.9', assets: names.map((name) => ({ name, browser_download_url: base + name })) }];
}
