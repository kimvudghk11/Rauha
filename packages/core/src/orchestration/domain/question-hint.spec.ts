import { describe, expect, it } from 'vitest';
import { isSmallTalk, looksLikeQuestion, sameQuestionKey, wantsToProceed } from './question-hint.js';

describe('looksLikeQuestion', () => {
  it('물음표나 의문 표현이 있으면 질문처럼 보인다', () => {
    expect(looksLikeQuestion('이거 뭐야?')).toBe(true);
    expect(looksLikeQuestion('Money.add는 왜 이렇게 짰어')).toBe(true);
    expect(looksLikeQuestion('ECS on EC2와 Fargate 차이 알려줘')).toBe(true);
  });

  it('짧은 인사나 맞장구도 질문처럼 보고 미리 답을 준비한다', () => {
    expect(looksLikeQuestion('안녕')).toBe(true);
    expect(looksLikeQuestion('고마워')).toBe(true);
  });

  it('무언가를 시키는 말은 질문처럼 보지 않는다 (답변 팀원을 괜히 부르지 않는다)', () => {
    expect(looksLikeQuestion('오타 고쳐줘')).toBe(false);
    expect(looksLikeQuestion('쿠폰 기능 만들어줘')).toBe(false);
    expect(looksLikeQuestion('이 앱 런칭 계획 짜줘')).toBe(false);
    expect(looksLikeQuestion('테스트 추가하고 왜 깨지는지도 알려줘')).toBe(false);
  });

  it('긴 서술이 의문 표현 없이 이어지면 질문처럼 보지 않는다', () => {
    expect(looksLikeQuestion('결제 모듈에 할인 쿠폰 적용 순서를 장바구니 단위로 바꾸는 방향으로 정리하고 싶어요')).toBe(false);
  });
});

describe('isSmallTalk', () => {
  it('짧은 인사·맞장구는 인사로 본다', () => {
    expect(isSmallTalk('안녕')).toBe(true);
    expect(isSmallTalk('고마워')).toBe(true);
  });

  it('물음이나 시키는 말이 들어 있으면 인사가 아니다', () => {
    expect(isSmallTalk('이거 뭐야?')).toBe(false);
    expect(isSmallTalk('고쳐줘')).toBe(false);
    expect(isSmallTalk('결제 모듈에 쿠폰 순서 설명해줘 제발')).toBe(false);
  });
});

describe('wantsToProceed', () => {
  it('"그래도 진행"처럼 미뤄 둔 일을 하라는 말로 읽는다', () => {
    for (const text of ['그래도 진행', '그냥 해줘', ' 그래도  진행해', '그냥 할게', '그래도 실행']) expect(wantsToProceed(text)).toBe(true);
  });

  it('문장 중간에 있거나 다른 말이면 아니다', () => {
    expect(wantsToProceed('이건 그래도 진행하기 어려워')).toBe(false);
    expect(wantsToProceed('그냥 궁금해서')).toBe(false);
    expect(wantsToProceed('진행해')).toBe(false);
  });
});

describe('sameQuestionKey', () => {
  it('공백과 대소문자만 다른 질문은 같은 질문이다', () => {
    expect(sameQuestionKey('  이  함수 뭐 해?')).toBe(sameQuestionKey('이 함수 뭐 해?'));
    expect(sameQuestionKey('What IS this')).toBe(sameQuestionKey('what is this'));
  });

  it('말이 다르면 다른 질문이다', () => {
    expect(sameQuestionKey('이 함수 뭐 해?')).not.toBe(sameQuestionKey('저 함수 뭐 해?'));
  });
});
