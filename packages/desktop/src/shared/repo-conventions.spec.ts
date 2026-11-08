import { describe, expect, it } from 'vitest';
import { RepoConventions } from './repo-conventions.js';

const J = 'a1b2c3d4-5555';

describe('RepoConventions: 기존 기록을 보고 브랜치·커밋 이름을 따른다', () => {
  it('기록이 적으면 예전 기본값(rauha/job-…, "rauha: …")을 쓴다', () => {
    const c = RepoConventions.infer(['main', 'feature/a'], ['init', 'second']);
    expect(c.branchName('로그인 고치기', J)).toBe('rauha/job-a1b2c3d4');
    expect(c.commitSubject('로그인 고치기')).toBe('rauha: 로그인 고치기');
    expect(c.promptNote()).toBe('');
  });

  it('feature/ 접두어가 대부분이면 feature/ 와 하이픈 단어로 브랜치를 만든다', () => {
    const c = RepoConventions.infer(['main', 'feature/add-cart', 'feature/fix-login', 'feature/coupon-page', 'develop'], []);
    expect(c.branchName('Add coupon list', J)).toBe('feature/add-coupon-list');
  });

  it('접두어 없이 쓰는 레포는 접두어 없이 만든다', () => {
    const c = RepoConventions.infer(['main', 'login-fix', 'cart-page', 'coupon-api'], []);
    expect(c.branchName('cart badge', J)).toBe('cart-badge');
  });

  it('티켓 번호를 앞에 붙이는 레포는 요청에 있는 티켓 번호를 앞에 붙인다', () => {
    const c = RepoConventions.infer(['feat/ABC-101-login', 'feat/ABC-102-cart', 'feat/ABC-103-pay', 'main'], []);
    expect(c.branchName('ABC-210 add export', J)).toBe('feat/ABC-210-add-export');
    expect(c.branchName('add export', J)).toBe('feat/add-export');
  });

  it('밑줄로 쓰는 레포는 밑줄로 잇는다', () => {
    const c = RepoConventions.infer(['feature/add_cart', 'feature/fix_login', 'feature/coupon_page'], []);
    expect(c.branchName('add coupon list', J)).toBe('feature/add_coupon_list');
  });

  it('접두어가 사람 이름처럼 제각각이면 근거가 약하니 기본값을 쓴다', () => {
    const c = RepoConventions.infer(['kim/a', 'lee/b', 'park/c', 'choi/d'], []);
    expect(c.branchName('x', J)).toBe('rauha/job-a1b2c3d4');
  });

  it('원격 접두어와 줄기·rauha 브랜치는 세지 않는다', () => {
    const c = RepoConventions.infer(['origin/main', 'origin/feature/a', 'origin/feature/b', 'remotes/origin/feature/c', 'rauha/job-xx'], []);
    expect(c.branchName('hello world', J)).toBe('feature/hello-world');
  });

  it('Conventional Commits를 쓰는 레포는 type: 내용으로 쓰고 요청에 맞는 type을 고른다', () => {
    const c = RepoConventions.infer([], ['feat: 장바구니 추가', 'fix: 로그인 오류', 'docs: 안내 수정', 'feat: 쿠폰', 'chore: 의존성']);
    expect(c.commitSubject('쿠폰 목록 추가', '쿠폰 목록 기능 추가')).toBe('feat: 쿠폰 목록 추가');
    expect(c.commitSubject('로그인 오류 수정', '로그인 버그 수정')).toBe('fix: 로그인 오류 수정');
    expect(c.promptNote()).toContain('feat');
  });

  it('범위(scope)를 늘 쓰는 레포인지도 본다', () => {
    const c = RepoConventions.infer([], ['feat(cart): a', 'fix(auth): b', 'feat(pay): c', 'chore(deps): d']);
    expect(c.promptNote()).toContain('(범위)');
  });

  it('대괄호 말머리를 쓰는 레포는 [말머리] 내용으로 쓴다', () => {
    const c = RepoConventions.infer([], ['[BE] 쿠폰 추가', '[BE] 결제 수정', '[FE] 화면', '[BE] 로그']);
    expect(c.commitSubject('목록 추가')).toBe('[BE] 목록 추가');
  });

  it('티켓 번호로 시작하는 레포는 요청의 티켓 번호를 앞에 붙인다', () => {
    const c = RepoConventions.infer([], ['ABC-1 login', 'ABC-2 cart', 'ABC-3 pay', 'ABC-4 fix']);
    expect(c.commitSubject('add export', 'ABC-9 add export')).toBe('ABC-9 add export');
  });

  it('접두어 없는 한국어 한 줄 방식이면 그대로 쓴다', () => {
    const c = RepoConventions.infer([], ['쿠폰 기능을 추가했다', '로그인 오류를 고쳤다', '안내 문서를 고쳤다']);
    expect(c.commitSubject('목록 추가')).toBe('목록 추가');
    expect(c.promptNote()).toContain('한국어');
  });

  it('병합 커밋 제목은 세지 않는다', () => {
    const c = RepoConventions.infer([], ['Merge branch x', 'Merge pull request #1', 'feat: a', 'feat: b', 'fix: c']);
    expect(c.commitSubject('x', 'feat x')).toBe('feat: x');
  });

  it('제목은 60자로 줄인다', () => {
    const c = RepoConventions.infer([], ['feat: a', 'feat: b', 'feat: c']);
    expect(c.commitSubject('가'.repeat(100)).length).toBeLessThanOrEqual('feat: '.length + 60);
  });
});
