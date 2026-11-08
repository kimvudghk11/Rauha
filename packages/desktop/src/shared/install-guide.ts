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
  const found = update === null ? null : update.newer ? `새 버전 ${update.latest ?? ''}이 있어요.`.replace('  ', ' ') : '지금 최신 버전이에요.';
  if (platform === 'darwin') {
    return { title: '맥에 설치·업데이트', lines: [...(found === null ? [] : [found]), '터미널에 아래 한 줄을 붙여 넣어요. 브라우저로 받지 않아서 첫 실행 경고가 뜨지 않아요. 새 버전도 같은 한 줄로 덮어써요.'], copy: MAC_INSTALL_COMMAND, download: false };
  }
  if (platform === 'win32') {
    const can = update?.hasDownload !== false;
    return { title: 'Windows에 설치·업데이트', lines: [...(found === null ? [] : [found]), can ? '최신 설치 파일을 내려받아 실행하면 새 버전으로 바뀌어요.' : '이 컴퓨터에 맞는 설치 파일을 아직 못 찾았어요. 잠시 뒤 다시 확인해 주세요.'], copy: null, download: can };
  }
  return { title: '설치·업데이트', lines: [...(found === null ? [] : [found]), '이 컴퓨터용 설치 방법은 아직 없어요. GitHub 릴리스 페이지에서 확인해 주세요.'], copy: null, download: false };
}
