/** 창이 어디로 옮겨 가거나 새로 열릴 수 있는지(순수 함수). 앱 화면은 앱 안의 파일 하나뿐이고, 바깥 주소는 기본 브라우저가 연다. */

/** 기본 브라우저로 열어도 되는 주소: https이고 사용자 정보(user:pw@)가 없다. */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/** 앱 화면 파일(file://…/renderer/index.html, 쿼리·해시만 다를 수 있다) 안에서 다시 읽는 것만 허용한다. */
export function isAppPage(url: string, appPageUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(appPageUrl);
    return a.protocol === 'file:' && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
