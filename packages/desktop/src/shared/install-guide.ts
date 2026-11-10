/** 맥 한 줄 설치 명령. 브라우저로 받지 않아 첫 실행 경고(quarantine)가 안 뜬다. */
export const MAC_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/kimvudghk11/rauha/main/scripts/install-mac.sh | bash';

export interface InstallGuide {
  readonly title: string;
  readonly lines: readonly string[];
  /** 복사할 명령(맥). 없으면 null */
  readonly copy: string | null;
  /** 내려받기 버튼을 보일지(Windows 등 설치 파일을 받는 컴퓨터) */
  readonly download: boolean;
}

/** 이 컴퓨터(OS)에 맞는 설치·업데이트 방법. 내려받을 주소는 화면이 정하지 않고 main의 update 서비스가 검증해 연다. */
export function installGuide(platform: string, update: { readonly newer: boolean; readonly latest: string | null; readonly hasDownload: boolean } | null): InstallGuide {
  const found = update === null ? null : update.newer ? `New version ${update.latest ?? ''} available.`.replace('  ', ' ') : 'You are up to date.';
  if (platform === 'darwin') {
    return { title: 'Install / update on Mac', lines: [...(found === null ? [] : [found]), 'Paste the line below into Terminal. It skips the browser, so no first-launch warning appears. New versions install with the same line.'], copy: MAC_INSTALL_COMMAND, download: false };
  }
  if (platform === 'win32') {
    const can = update?.hasDownload !== false;
    return { title: 'Install / update on Windows', lines: [...(found === null ? [] : [found]), can ? 'Download and run the latest installer to switch to the new version.' : 'No installer for this computer yet. Check again in a moment.'], copy: null, download: can };
  }
  return { title: 'Install / update', lines: [...(found === null ? [] : [found]), 'There is no install method for this computer yet. See the GitHub releases page.'], copy: null, download: false };
}
