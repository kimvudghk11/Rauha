/** 창이 어디로 옮겨 가거나 새로 열릴 수 있는지(순수 함수). 앱 화면은 앱 안의 파일 하나뿐이고, 바깥 주소는 기본 브라우저가 연다. */

// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/**
 * 기본 브라우저로 열어도 되는 주소를 다듬어 돌려준다. https이고 사용자 정보(user:pw@)가 없고 제어 문자·역슬래시가 없어야 한다.
 * 돌려주는 값은 사용자가 넘긴 글이 아니라 파싱한 주소(href)라서 따옴표·공백이 인코딩되어 있다. 열 때는 이 값을 쓴다. 안전하지 않으면 null.
 */
export function externalUrlOf(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048 || CONTROL_OR_BACKSLASH.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.hostname !== '' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** 기본 브라우저로 열어도 되는 주소인지 */
export const isSafeExternalUrl = (url: unknown): url is string => externalUrlOf(url) !== null;

/** 앱 화면 파일(file://…/renderer/index.html, 쿼리·해시만 다를 수 있다) 안에서 다시 읽는 것만 허용한다. 다른 호스트(공유 폴더)의 같은 경로는 앱 화면이 아니다. */
export function isAppPage(url: string, appPageUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(appPageUrl);
    const sameHost = a.host === b.host || ((a.host === '' || a.host === 'localhost') && (b.host === '' || b.host === 'localhost'));
    return a.protocol === 'file:' && sameHost && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
