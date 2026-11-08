/**
 * 빠른 열기용 이름 맞추기. 검색어의 글자들이 경로에 차례대로 들어 있으면(대소문자 무시) 맞은 것이다.
 * 점수: 파일 이름 안에서 맞을수록, 글자가 이어질수록, 단어 시작(/ . _ - 뒤나 대문자)에서 맞을수록 높다. 안 맞으면 null.
 */
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.trim().toLowerCase().replace(/\\/g, '/');
  if (q === '') return 0;
  const lower = path.toLowerCase();
  const nameStart = path.lastIndexOf('/') + 1;
  let score = 0;
  let pos = 0;
  let previous = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = lower.indexOf(ch, pos);
    if (at < 0) return null;
    score += 1;
    if (at === previous + 1) score += 5;
    const before = at === 0 ? '/' : (path[at - 1] ?? '/');
    if (/[/._\- ]/.test(before) || (/[A-Z]/.test(path[at] ?? '') && /[a-z]/.test(before))) score += 4;
    if (at >= nameStart) score += 3;
    previous = at;
    pos = at + 1;
  }
  const name = lower.slice(nameStart);
  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 40;
  else if (name.includes(q)) score += 20;
  return score - path.length * 0.01;
}

/** 점수 높은 순으로 최대 limit개. 점수가 같으면 짧은 경로, 그다음 가나다순. */
export function rankFiles(query: string, paths: readonly string[], limit: number): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const score = fuzzyScore(query, path);
    if (score !== null) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}
