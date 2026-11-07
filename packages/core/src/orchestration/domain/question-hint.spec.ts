import { describe, expect, it } from 'vitest';
import { answerDepthOf, isSmallTalk, onlyDocuments, sameQuestionKey, wantsToProceed } from './question-hint.js';

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

describe('answerDepthOf', () => {
  it('인사는 라우터가 deep이라 해도 light다', () => {
    expect(answerDepthOf('deep', '안녕')).toBe('light');
  });

  it('인사가 아니면 라우터 판정을 따른다', () => {
    expect(answerDepthOf('light', '1+1은 얼마야?')).toBe('light');
    expect(answerDepthOf('deep', '이 함수 어디서 써?')).toBe('deep');
  });
});

describe('onlyDocuments', () => {
  it('문서 파일만 말하면 true, 코드가 섞이면 false', () => {
    expect(onlyDocuments('README.md 맨 아래에 hello rauha 한 줄을 추가해 줘')).toBe(true);
    expect(onlyDocuments('src/money.ts 고치고 README.md에도 반영해줘')).toBe(false);
    expect(onlyDocuments('Money.add가 빼기를 해, 고쳐줘')).toBe(false);
  });
});
