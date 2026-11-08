import { posix, win32 } from 'node:path';

/** Windows는 끝의 점·공백을 지우고 연다(".git." → ".git"). 비교할 때 같은 모양으로 맞춘다. */
const normalizeSegment = (segment: string): string => segment.replace(/[. ]+$/, '').toLowerCase();

/**
 * 화면이 보낸 "작업 폴더 기준 상대 경로"를 슬래시 하나로 정리한다. 받으면 안 되는 경로면 null.
 * 문자열 검사만 하는 순수 함수다. 심볼릭 링크로 새어 나가는지는 실제 경로(realpath)로 따로 본다.
 * - 절대 경로·드라이브·UNC·NUL·`..` 는 받지 않는다.
 * - `.git` 폴더 안은 받지 않는다(훅이 코드 실행 통로가 되고, 설정이 바뀌면 git이 망가진다).
 */
export function cleanRelative(input: unknown): string | null {
  if (typeof input !== 'string' || input.includes('\0')) return null;
  if (input.startsWith('/') || input.startsWith('\\') || /^[a-zA-Z]:/.test(input)) return null;
  const parts: string[] = [];
  for (const part of input.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    if (normalizeSegment(part) === '.git') return null;
    parts.push(part);
  }
  return parts.join('/');
}

/**
 * target이 root와 같거나 그 아래인지. 둘 다 realpath를 거친 절대 경로여야 한다.
 * 대소문자 무시는 Windows에서만 켠다(대소문자를 가리는 파일 시스템에서는 폴더가 다르다).
 */
export function isInside(root: string, target: string, caseInsensitive: boolean): boolean {
  const fold = (p: string): string => (caseInsensitive ? p.toLowerCase() : p);
  const a = fold(root);
  const b = fold(target);
  if (caseInsensitive && win32.parse(a).root !== win32.parse(b).root) return false;
  const rel = caseInsensitive ? win32.relative(a, b) : posix.relative(a, b);
  if (rel === '') return true;
  if (posix.isAbsolute(rel) || win32.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${caseInsensitive ? '\\' : '/'}`);
}
