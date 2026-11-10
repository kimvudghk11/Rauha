import type { UpdateView } from '../shared/update-record.js';

export const MAC_INSTALL_NOTE = 'After downloading, copy it over Applications. If a warning appears on first launch, run this in Terminal: xattr -dr com.apple.quarantine /Applications/rauha.app';

/** 설정의 새 버전 구역 한 줄: 맥 첫 설치 경고(Gatekeeper)는 코드로 없앨 수 없지만, 앱 안 업데이트로 받은 파일에는 안 뜬다 */
export const GATEKEEPER_NOTE = 'Mac: the "unidentified developer" warning appears only on the first install. Versions installed with "Update now" inside the app do not show it again.';

/** 위쪽 배너의 글(돈·가격 표시 없음) */
export function bannerText(view: UpdateView): string {
  const base = `New version v${view.latest ?? ''} available`;
  return view.hasDownload ? base : `${base} · installer for this computer is being prepared`;
}

/** 설정 화면의 확인 상태 한 줄. time은 마지막 확인 시각을 사람이 읽는 글로 바꾼 것 */
export function checkedText(view: UpdateView, time: string): string {
  if (view.checking) return 'Checking…';
  if (view.failed) return view.failReason === null ? 'Could not check right now' : `Could not check: ${view.failReason}`;
  if (view.checkedAt === null) return 'Not checked yet';
  return `Last checked ${time} · ${view.newer ? `New version v${view.latest ?? ''} available` : `You are up to date (v${view.current})`}`;
}
