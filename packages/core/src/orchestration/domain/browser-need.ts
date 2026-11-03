import type { MemberRole } from './member-role.js';

/** 브라우저로 페이지를 열어 볼 수 있는 역할. 답을 찾거나(답변·디버깅) 화면을 다루는(UX) 팀원만. */
const BROWSER_ROLES: ReadonlySet<MemberRole> = new Set(['answerer', 'debugger', 'uxdesigner']);

const ADDRESS = /https?:\/\/\S+|\b(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\b/i;
const WEB_WORDS = /웹\s?페이지|웹\s?사이트|브라우저|browser|web\s?page|(dev|개발)\s?서버/i;
/** "띄운 웹페이지", "열어 둔 로그인 페이지"처럼 지금 떠 있는 페이지를 가리키는 말 */
const OPENED_PAGE = /(띄운|띄워\s?(둔|놓은)|열어\s?(둔|놓은)|열린|켜\s?(둔|놓은))\s*(\S+\s+){0,2}\S*(페이지|화면|사이트)/;

/**
 * 이 요청에 브라우저 도구를 붙일지. 도구 설명만 2만 자쯤이라 모든 호출에 붙이면 한도를 크게 쓴다.
 * 그래서 주소나 웹페이지를 가리키는 말이 있을 때만 붙인다. 놓치면 팀원이 WebFetch로 읽는다(JS로 그리는 화면은 못 본다).
 */
export class BrowserNeed {
  private constructor() {}

  static wanted(role: MemberRole, request: string): boolean {
    if (!BROWSER_ROLES.has(role)) return false;
    return ADDRESS.test(request) || WEB_WORDS.test(request) || OPENED_PAGE.test(request);
  }
}
