/** 에러 글에서 찾은 저장소 파일 한 곳 */
export interface TraceHit {
  readonly path: string;
  readonly line: number;
}

const EXT = 'ts|tsx|js|jsx|mjs|cjs|vue|py|java|kt|go|rb|php|cs|rs|scala|swift';
/** 경로:줄 (Node·Go·일반). 경로는 공백·괄호·따옴표 없이 */
const PATH_LINE = new RegExp(`([^\\s()"'\`]+\\.(?:${EXT})):(\\d+)`, 'g');
/** Python: File "path", line N */
const PY = /File "([^"]+\.py)", line (\d+)/g;
/** Java·Kotlin: at a.b.C.method(C.java:12) */
const JVM = /at\s+([\w$.]+)\.[\w$<>]+\((\w+\.(?:java|kt)):(\d+)\)/g;
const IGNORED = /(^|\/)(node_modules|dist|build|out)\/|^node:|^internal\//;

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * 붙여 넣은 에러 글(스택 트레이스)의 프레임을 저장소 파일·줄로 바꾼다. 모델 호출 없음.
 * 저장소 파일 경로가 프레임 경로의 끝과 맞을 때만 넣는다. 이름만 같은 파일이 여럿이면 어느 것인지 모르므로 넣지 않는다.
 */
export class StackTrace {
  private constructor() {}

  static hits(text: string, files: readonly string[], max = 8): TraceHit[] {
    const repoFiles = files.map(norm);
    const out: TraceHit[] = [];
    const seen = new Set<string>();
    const add = (path: string | null, line: number): void => {
      if (path === null || out.length >= max) return;
      const key = `${path}:${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ path, line });
    };
    // 글에 나온 순서대로(맨 위 프레임이 가장 가깝다)
    const found: { at: number; path: string | null; line: number }[] = [];
    for (const m of text.matchAll(PY)) found.push({ at: m.index ?? 0, path: StackTrace.resolve(m[1]!, repoFiles), line: Number(m[2]) });
    for (const m of text.matchAll(JVM)) {
      const pkg = m[1]!.split('.').slice(0, -1).join('/');
      found.push({ at: m.index ?? 0, path: StackTrace.resolve(pkg === '' ? m[2]! : `${pkg}/${m[2]!}`, repoFiles), line: Number(m[3]) });
    }
    for (const m of text.matchAll(PATH_LINE)) {
      if (/\.(?:java|kt)$/.test(m[1]!) && !m[1]!.includes('/') && !m[1]!.includes('\\')) continue; // JVM 프레임은 위에서
      if (/\.py$/.test(m[1]!) && text.slice(Math.max(0, (m.index ?? 0) - 6), m.index).includes('File')) continue;
      found.push({ at: m.index ?? 0, path: StackTrace.resolve(m[1]!, repoFiles), line: Number(m[2]) });
    }
    for (const f of found.sort((a, b) => a.at - b.at)) add(f.path, f.line);
    return out;
  }

  /** 프레임 경로 → 저장소 파일. 끝이 맞는 파일이 하나일 때만, 가장 긴 일치를 쓴다. */
  private static resolve(raw: string, files: readonly string[]): string | null {
    // a/dist/../src → a/src (빌드 폴더를 거쳐 원본을 가리키는 소스맵 경로)
    const path = norm(raw)
      .split('/')
      .reduce<string[]>((acc, s) => (s === '..' && acc.length > 0 && acc[acc.length - 1] !== '..' ? acc.slice(0, -1) : [...acc, s]), [])
      .join('/');
    if (IGNORED.test(path)) return null;
    const segments = path.split('/').filter((s) => s !== '' && s !== '..' && s !== '.');
    // 뒤에서부터 조각을 늘려 가며 끝이 맞는 파일을 찾고, 하나로 좁혀지면 그 파일
    for (let take = segments.length; take >= 1; take -= 1) {
      const tail = segments.slice(-take).join('/');
      const matches = files.filter((f) => f === tail || f.endsWith(`/${tail}`));
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1 && take === segments.length) return null;
    }
    return null;
  }
}
