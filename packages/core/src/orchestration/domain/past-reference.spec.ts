import { describe, expect, it } from 'vitest';
import { PastReference } from './past-reference.js';

describe('PastReference.in', () => {
  it('"이어서 해줘"·"아까 그거"·"마저 해줘" 같은 한국어 지시어를 지난 일을 가리키는 말로 읽는다', () => {
    for (const text of ['아까 그거 이어서 해줘', '이어서 해줘', '이어서', '그거 마저 해줘', '방금 거 고쳐줘', '저번에 하던 거 계속해줘', '지난번 작업 이어서 진행해', '하다 만 거 마저 해']) {
      expect(PastReference.in(text), text).toBe(true);
    }
  });

  it('영어 지시어도 읽는다', () => {
    for (const text of ['continue where we left off', 'pick up where we left off', 'continue with that', 'keep going', 'finish what we started']) {
      expect(PastReference.in(text), text).toBe(true);
    }
  });

  it('이어폰·아까운·테이블을 이어서 조회처럼 다른 뜻으로 쓰인 말은 아니다', () => {
    for (const text of ['이어폰 버그 고쳐줘', '아까운 메모리 줄여줘', '두 테이블을 이어서 조회하는 쿼리 만들어줘', '그거래서 로그인 잠금 기능 만들어줘', 'resume parser 버그 고쳐줘', 'continue 버튼 색을 바꿔줘']) {
      expect(PastReference.in(text), text).toBe(false);
    }
  });
});

describe('PastReference.lacksTarget', () => {
  const none = { refersToPast: false, hasConversation: false, hasPastWork: false };

  it('가리키는 대상(앞 대화·지난 작업)이 하나도 없으면 되물어야 한다', () => {
    expect(PastReference.lacksTarget({ ...none, text: '아까 그거 이어서 해줘' })).toBe(true);
    expect(PastReference.lacksTarget({ ...none, refersToPast: true, text: '로그인 잠금 기능 마저' })).toBe(true);
  });

  it('앞 대화나 지난 작업이 있으면 이어서 진행한다', () => {
    expect(PastReference.lacksTarget({ ...none, hasConversation: true, text: '아까 그거 이어서 해줘' })).toBe(false);
    expect(PastReference.lacksTarget({ ...none, hasPastWork: true, refersToPast: true, text: '아까 그거 이어서 해줘' })).toBe(false);
  });

  it('지시어도 refersToPast 도 없으면 맥락이 없어도 새 작업이다', () => {
    expect(PastReference.lacksTarget({ ...none, text: '이어폰 버그 고쳐줘' })).toBe(false);
  });
});

describe('PastReference.notice', () => {
  it('무엇을 이어서 할지 한 줄로 알려 달라고 안내한다', () => {
    expect(PastReference.notice()).toContain('이어서 할 작업을 찾지 못했어요');
  });
});
