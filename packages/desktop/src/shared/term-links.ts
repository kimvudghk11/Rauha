/** 터미널 출력 한 줄에서 찾은 파일 경로 링크 */
export interface TermPathLink {
  /** 글에 적힌 그대로의 경로(줄·칸 제외) */
  readonly path: string;
  readonly line: number;
  readonly column: number;
  /** 줄 안의 글자 위치(start 포함, end 미포함) */
  readonly start: number;
  readonly end: number;
}

/** 경로 구분자가 없는 낱말은 이 확장자일 때만 파일로 본다("e.g." 같은 글이 링크가 되지 않게) */
const KNOWN_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'py', 'go', 'rs', 'java', 'kt', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs',
  'css', 'scss', 'html', 'vue', 'svelte', 'yml', 'yaml', 'toml', 'sh', 'rb', 'php', 'swift', 'sql', 'txt', 'xml', 'lock', 'log', 'gradle',
]);

// 앞에 낱말·`:`·`/`·`.`·`-` 같은 것이 붙어 있으면(URL·버전 번호의 한가운데) 시작점으로 보지 않는다.
const PATH_RE = /(?<![\w:/\\.@~-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?(?:[\w@.+-]+[\\/])*[\w@+-][\w@.+-]*\.([A-Za-z][A-Za-z0-9]{0,7}))(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))?/g;

/** 줄 하나에서 파일 경로(`경로:줄:칸`, `경로(줄,칸)`)를 찾는다. 실제 파일인지는 누를 때 연 쪽이 확인한다. */
export function findPathLinks(text: string): TermPathLink[] {
  const out: TermPathLink[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const path = m[1] ?? '';
    const ext = (m[2] ?? '').toLowerCase();
    if (!/[\\/]/.test(path) && !KNOWN_EXT.has(ext)) continue;
    const line = Number(m[3] ?? m[5] ?? 1);
    const column = Number(m[4] ?? m[6] ?? 1);
    const start = m.index ?? 0;
    out.push({ path, line: line >= 1 ? line : 1, column: column >= 1 ? column : 1, start, end: start + m[0].length });
  }
  return out;
}

const normalize = (p: string): string => p.replace(/\\/g, '/');

/** `.`·`..`를 접는다. 맨 위(루트) 밖으로 나가면 null. */
function fold(parts: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out;
}

/**
 * 링크 경로를 "작업 폴더 기준 상대 경로(/ 구분)"로 바꾼다. 작업 폴더 밖이면 null.
 * - 상대 경로: 터미널을 연 폴더(baseRel, 작업 폴더 기준) 아래로 본다.
 * - 절대 경로: 작업 폴더 안일 때만 상대 경로로 바꾼다(Windows는 대소문자를 가리지 않는다).
 */
export function resolveTermPath(raw: string, workFolder: string, baseRel: string, platform: string): string | null {
  const p = normalize(raw.trim());
  if (p === '' || p.startsWith('~')) return null;
  const win = platform === 'win32';
  const same = (a: string, b: string): boolean => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
  const absolute = /^[A-Za-z]:\//.test(p) || p.startsWith('/');
  if (absolute) {
    const work = fold(normalize(workFolder).split('/'));
    const target = fold(p.split('/'));
    if (work === null || target === null || target.length <= work.length) return null;
    // 드라이브 글자("C:")도 첫 조각으로 같이 비교된다
    if (!work.every((part, i) => same(part, target[i] ?? ''))) return null;
    return target.slice(work.length).join('/');
  }
  const folded = fold([...normalize(baseRel).split('/'), ...p.split('/')]);
  return folded === null || folded.length === 0 ? null : folded.join('/');
}
