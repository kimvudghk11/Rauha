import { describe, expect, it } from 'vitest';
import { GitPublishIntent } from './git-publish-intent.js';

const of = (text: string) => GitPublishIntent.from(text);

describe('GitPublishIntent', () => {
  it('요청에 아무 말이 없으면 커밋·push·PR 모두 시키지 않은 것이다', () => {
    const none = of('로그인 버그 고쳐줘');
    expect([none.allowsCommit(), none.allowsPush(), none.allowsPullRequest(), none.allowsMerge()]).toEqual([false, false, false, false]);
    expect(GitPublishIntent.none().allowsCommit()).toBe(false);
  });

  it('커밋을 시키면 커밋만 허락한다', () => {
    for (const text of ['고치고 커밋해줘', 'fix the bug and commit it', '커밋까지 해 줘', 'Please commit the change']) {
      const intent = of(text);
      expect(intent.allowsCommit(), text).toBe(true);
      expect(intent.allowsPush(), text).toBe(false);
      expect(intent.allowsPullRequest(), text).toBe(false);
    }
  });

  it('push를 시키면 커밋도 함께 허락한다', () => {
    for (const text of ['푸시까지 해줘', 'commit하고 push 해', 'origin에 push해 줘', '깃허브에 올려줘', '원격에 올려 줘']) {
      const intent = of(text);
      expect(intent.allowsPush(), text).toBe(true);
      expect(intent.allowsCommit(), text).toBe(true);
      expect(intent.allowsPullRequest(), text).toBe(false);
    }
  });

  it('PR을 시키면 커밋·push·PR을 모두 허락한다', () => {
    for (const text of ['커밋하고 PR까지 해줘', 'PR 만들어줘', '풀리퀘 올려줘', '풀리퀘스트 열어줘', 'open a pull request', 'make a PR']) {
      const intent = of(text);
      expect([intent.allowsCommit(), intent.allowsPush(), intent.allowsPullRequest()], text).toEqual([true, true, true]);
      expect(intent.allowsMerge(), text).toBe(false);
    }
  });

  it('PR 머지를 시키면 머지도 허락한다', () => {
    expect(of('PR 머지해줘').allowsMerge()).toBe(true);
    expect(of('merge the PR').allowsMerge()).toBe(true);
    expect(of('머지해줘').allowsMerge()).toBe(false);
  });

  it('하지 말라는 말은 요청으로 보지 않는다', () => {
    for (const text of ['커밋하지 마', '커밋은 내가 할게', 'push 하지 말고 고치기만 해', "don't commit anything", 'do not push', '커밋 말고 수정만', 'without committing', '커밋 안 해도 돼', 'PR은 만들지 마']) {
      const intent = of(text);
      expect([intent.allowsCommit(), intent.allowsPush(), intent.allowsPullRequest()], text).toEqual([false, false, false]);
    }
  });

  it('한 문장 안에서도 부정된 것만 뺀다', () => {
    const intent = of('커밋은 해 주고 push는 하지 마');
    expect(intent.allowsCommit()).toBe(true);
    expect(intent.allowsPush()).toBe(false);
    const other = of('push 하지 말고 커밋만 해줘');
    expect(other.allowsCommit()).toBe(true);
    expect(other.allowsPush()).toBe(false);
  });

  it('커밋 내역을 보여 달라는 말은 커밋을 시킨 것이 아니다', () => {
    for (const text of ['최근 커밋 보여줘', '커밋 로그 확인해줘', 'show the last commit', 'commit history 알려줘', '커밋하지 않은 변경을 검토해 줘']) {
      expect(of(text).allowsCommit(), text).toBe(false);
    }
  });

  it('코드 작업 뒤 커밋·PR 단계는 작업이 끝까지 통과했을 때만 붙고, 멈췄으면 하지 않는다', () => {
    const asked = of('고치고 커밋까지 해줘');
    expect(asked.afterRun('complete')).toBe('publish');
    expect(asked.afterRun('stopped')).toBe('skip');
    expect(of('고쳐줘').afterRun('complete')).toBe('none');
    expect(of('고쳐줘').afterRun('stopped')).toBe('none');
  });

  it('시킨 git 일을 사람이 읽는 말로 적는다(PR은 커밋·push를 품는다)', () => {
    expect(of('커밋해줘').label()).toBe('커밋');
    expect(of('푸시까지 해줘').label()).toBe('커밋·push');
    expect(of('PR 올려줘').label()).toBe('커밋·push·PR');
    expect(of('PR 만들고 머지까지').label()).toBe('커밋·push·PR·머지');
    expect(GitPublishIntent.none().label()).toBe('');
  });

  it('다른 뜻의 올려/언급은 push로 보지 않는다', () => {
    expect(of('버튼 크기를 올려줘').allowsPush()).toBe(false);
    expect(of('이미지 파일을 올려서 보여줘').allowsPush()).toBe(false);
  });
});
