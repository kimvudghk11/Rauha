import { describe, expect, it } from 'vitest';
import { conventionsView } from './git-conventions-view.js';
import { RepoConventions } from './repo-conventions.js';

const ko = ['feat(ui): 버튼 추가', 'fix(api): 오류 수정', 'feat(ui): 탭 추가', 'docs: 문서 갱신', 'feat(core): 규칙 추가'];
const branches = ['feature/a', 'feature/b', 'feature/c', 'fix/d', 'main'];

describe('레포 방식 안내 화면용 정보', () => {
  it('feat(범위): 내용 방식은 안내 문장·예시·말머리 칩을 만든다', () => {
    const v = conventionsView(RepoConventions.infer(branches, ko));
    expect(v.commit.known).toBe(true);
    expect(v.commit.text).toBe('이 레포는 `feat(범위): 내용` 방식(한국어)이에요.');
    expect(v.commit.example).toMatch(/^feat\(.+\): /);
    expect(v.commit.chips[0]).toBe('feat(');
    expect(v.commit.chips).toContain('fix(');
  });
  it('범위가 없는 방식의 칩은 "타입: "이다', () => {
    const v = conventionsView(RepoConventions.infer([], ['feat: 가', 'fix: 나', 'feat: 다', 'docs: 라']));
    expect(v.commit.text).toBe('이 레포는 `feat: 내용` 방식(한국어)이에요.');
    expect(v.commit.chips).toContain('feat: ');
  });
  it('대괄호 방식은 [태그] 를 칩으로 준다', () => {
    const v = conventionsView(RepoConventions.infer([], ['[WEB] 가', '[WEB] 나', '[WEB] 다']));
    expect(v.commit.text).toContain('[WEB] 내용');
    expect(v.commit.chips).toEqual(['[WEB] ']);
  });
  it('근거가 약하면 모른다고 하고 칩을 주지 않는다', () => {
    const v = conventionsView(RepoConventions.default());
    expect(v.commit.known).toBe(false);
    expect(v.commit.text).toBe('이 레포의 커밋 방식은 아직 몰라요.');
    expect(v.commit.chips).toEqual([]);
  });
  it('브랜치 접두어는 레포 방식이 있으면 그것을, 없으면 흔한 말머리를 보여 주며 출처를 구분한다', () => {
    const own = conventionsView(RepoConventions.infer(branches, ko));
    expect(own.branch).toMatchObject({ fromRepo: true, prefixes: ['feature/'] });
    const none = conventionsView(RepoConventions.default());
    expect(none.branch.fromRepo).toBe(false);
    expect(none.branch.prefixes).toEqual(['feature/', 'fix/', 'chore/']);
  });
});
