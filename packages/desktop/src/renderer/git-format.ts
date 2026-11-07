/** 커밋 시각을 "5분 전"처럼. 한 달 넘으면 날짜(로컬 기준). */
export function ago(atSec: number, nowSec: number): string {
  const d = nowSec - atSec;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  const days = Math.floor(d / 86400);
  if (days === 1) return '어제';
  if (days < 30) return `${days}일 전`;
  const t = new Date(atSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function syncChips(ahead: number | null, behind: number | null): string[] {
  if (ahead === null || behind === null) return ['원격 연결 안 됨'];
  if (ahead === 0 && behind === 0) return ['원격과 같음'];
  return [ahead > 0 ? `앞섬 ${ahead}` : '', behind > 0 ? `뒤처짐 ${behind}` : ''].filter((x) => x !== '');
}
