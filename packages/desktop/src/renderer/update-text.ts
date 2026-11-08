import type { UpdateView } from '../shared/update-record.js';

export const MAC_INSTALL_NOTE = '내려받은 뒤 Applications에 덮어쓰고, 처음 열 때 경고가 뜨면 터미널에서 xattr -dr com.apple.quarantine /Applications/rauha.app';

/** 위쪽 배너의 글(돈·가격 표시 없음) */
export function bannerText(view: UpdateView): string {
  const base = `새 버전 v${view.latest ?? ''}가 있어요`;
  return view.hasDownload ? base : `${base} · 내 컴퓨터용 설치 파일을 준비 중이에요`;
}

/** 설정 화면의 확인 상태 한 줄. time은 마지막 확인 시각을 사람이 읽는 글로 바꾼 것 */
export function checkedText(view: UpdateView, time: string): string {
  if (view.checking) return '확인하는 중…';
  if (view.failed) return view.failReason === null ? '지금은 확인하지 못했어요' : `확인하지 못했어요: ${view.failReason}`;
  if (view.checkedAt === null) return '아직 확인하지 않았어요';
  return `마지막 확인 ${time} · ${view.newer ? `새 버전 v${view.latest ?? ''}가 있어요` : `최신 버전이에요 (v${view.current})`}`;
}
