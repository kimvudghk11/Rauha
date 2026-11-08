import { posix, win32 } from 'node:path';

/** Windows는 끝의 점·공백을 지우고 연다(".git." → ".git"). 비교할 때 같은 모양으로 맞춘다. */
/** 대체 데이터 스트림(".git::$INDEX_ALLOCATION")도 같은 폴더를 연다. 첫 콜론부터는 이름이 아니다. */
const normalizeSegment = (segment: string): string => segment.replace(/:.*$/s, '').replace(/[. ]+$/, '').toLowerCase();

/** Windows 예약 장치 이름(확장자가 붙어도 장치다) */
const DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(\..*)?$/i;

/**
 * 화면이 보낸 "작업 폴더 기준 상대 경로"를 슬래시 하나로 정리한다. 받으면 안 되는 경로면 null.
 * 문자열 검사만 하는 순수 함수다. 심볼릭 링크로 새어 나가는지는 실제 경로(realpath)로 따로 본다.
 * - 절대 경로·드라이브·UNC·NUL·`..` 는 받지 않는다.
 * - Windows에서는 콜론이 든 이름(대체 데이터 스트림)과 예약 장치 이름도 받지 않는다.
 * - `.git` 폴더 안은 받지 않는다(훅이 코드 실행 통로가 되고, 설정이 바뀌면 git이 망가진다).
 */
export function cleanRelative(input: unknown, windows: boolean = process.platform === 'win32'): string | null {
  if (typeof input !== 'string' || input.includes('\0')) return null;
  if (input.startsWith('/') || input.startsWith('\\') || /^[a-zA-Z]:/.test(input)) return null;
  const parts: string[] = [];
  for (const part of input.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    if (normalizeSegment(part) === '.git') return null;
    // Windows: 콜론은 드라이브·대체 데이터 스트림이고, CON·NUL 같은 이름은 파일이 아니라 장치다
    if (windows && (part.includes(':') || DEVICE.test(part.replace(/[. ]+$/, '')))) return null;
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
