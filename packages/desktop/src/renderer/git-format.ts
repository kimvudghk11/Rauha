/** 커밋 시각을 "5분 전"처럼. 한 달 넘으면 날짜(로컬 기준). */
export function ago(atSec: number, nowSec: number): string {
  const d = nowSec - atSec;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  const days = Math.floor(d / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const t = new Date(atSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function syncChips(ahead: number | null, behind: number | null): string[] {
  if (ahead === null || behind === null) return ['No remote'];
  if (ahead === 0 && behind === 0) return ['In sync'];
  return [ahead > 0 ? `Ahead ${ahead}` : '', behind > 0 ? `Behind ${behind}` : ''].filter((x) => x !== '');
}
