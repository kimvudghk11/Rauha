import { describe, expect, it } from 'vitest';
import { answerDepthOf, asksArchitecture, greetingReply, isSmallTalk, pointsAtRepository, onlyDocuments, sameQuestionKey, wantsToProceed } from './question-hint.js';

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

  it('저장소 파일·폴더·구조를 가리키는 말은 라우터가 light라 해도 deep이다', () => {
    expect(answerDepthOf('light', '이 레포 폴더 구조 정리해줘')).toBe('deep');
    expect(answerDepthOf('light', '아까 그 파일 보여줘')).toBe('deep');
    expect(answerDepthOf('light', '그 파일')).toBe('deep');
    expect(answerDepthOf('light', 'src/money.ts 뭐 해?')).toBe('deep');
  });

  it('구성·설계·합치기·나누기 같은 아키텍처 질문은 내 환경을 읽어야 해서 라우터가 light 라 해도 deep 이다', () => {
    for (const text of ['모노레포할 때 어떻게 구성할까?', '찢어진 레포들을 모노레포로 합치려면?', '서비스를 마이크로서비스로 나눌까?', 'REST에서 GraphQL로 전환할까', 'Nx vs Turborepo 뭐가 나아?']) expect(answerDepthOf('light', text), text).toBe('deep');
  });

  it('저장소를 가리키지 않는 질문은 라우터 판단을 따른다(간단한 질문은 가볍게 빨리)', () => {
    expect(answerDepthOf('light', '1+1은 얼마야?')).toBe('light');
    expect(answerDepthOf('light', 'REST가 뭐야?')).toBe('light');
    expect(answerDepthOf('deep', '이 함수 어디서 써?')).toBe('deep');
    expect(answerDepthOf('deep', '안녕')).toBe('light');
  });
});

describe('greetingReply', () => {
  it('인사·감사·작별 인사는 모델 없이 바로 답한다', () => {
    for (const text of ['ㅎㅇ', 'ㅎㅇㅎㅇ', '안녕', '안녕하세요!', '하이~', 'hi', 'Hello', '헬로']) expect(greetingReply(text), text).toMatch(/안녕/);
    for (const text of ['고마워', '감사합니다', 'ㄳ', 'ㄱㅅ', '땡큐', 'thanks', 'thank you']) expect(greetingReply(text), text).toMatch(/천만에요|별말씀/);
    for (const text of ['잘자', '바이', 'ㅂㅇ', 'bye', '수고했어']) expect(greetingReply(text), text).toMatch(/수고|안녕히|또/);
  });

  describe('변형 조합 — 기본 인사 × 꾸밈(부호·웃음·이모지·늘임·되풀이·말끝·부르는 말)', () => {
    const BASE: Record<string, RegExp> = {
      ㅎㅇ: /안녕/, ㅎ2: /안녕/, 하이: /안녕/, 하2: /안녕/, 안녕: /안녕/, 안녕하세요: /안녕/, 반가워: /안녕/, 굿모닝: /안녕/, '좋은 아침': /안녕/, hi: /안녕/, hello: /안녕/, hey: /안녕/,
      고마워: /천만에요/, 감사합니다: /천만에요/, ㄳ: /천만에요/, 땡큐: /천만에요/, thanks: /천만에요/, 'thank you': /천만에요/,
      잘자: /수고/, 바이: /수고/, ㅂㅇ: /수고/, ㅂ2: /수고/, 수고했어: /수고/, 수고하세요: /수고/, '안녕히 계세요': /수고/, bye: /수고/, 'good night': /수고/,
    };
    const DECORATE: Record<string, (word: string) => string> = {
      그대로: (w) => w,
      느낌표: (w) => `${w}!!`,
      물결: (w) => `${w}~~`,
      마침표: (w) => `${w}.`,
      웃음: (w) => `${w} ㅋㅋㅋ`,
      붙은웃음: (w) => `${w}ㅎㅎ`,
      이모지: (w) => `${w} 😊`,
      이모티콘: (w) => `${w} ^^`,
      울음: (w) => `${w}ㅠㅠ`,
      대문자: (w) => w.toUpperCase(),
      앞뒤공백: (w) => `  ${w}  `,
      되풀이: (w) => `${w}${w}`,
      끝글자늘임: (w) => `${w}${w.slice(-1).repeat(3)}`,
      부르는말앞: (w) => `델피야 ${w}`,
      부르는말뒤: (w) => `${w} 델피`,
      여러분: (w) => `${w} 여러분`,
    };

    for (const [word, reply] of Object.entries(BASE)) {
      for (const [how, decorate] of Object.entries(DECORATE)) {
        it(`${how}: "${decorate(word)}"`, () => expect(greetingReply(decorate(word))).toMatch(reply));
      }
    }

    it('말끝 변형(여·염·욤·용·당·웡, 요 붙이기)도 같은 인사다', () => {
      for (const text of ['안녕하세여', '안녕하세염', '안녕하세욤', '안녕하세용', 'ㅎㅇ요', 'ㅎㅇ염', '하이요', '반가워요', '반가웡']) expect(greetingReply(text), text).toMatch(/안녕/);
      for (const text of ['고마워여', '고마워용', '고마웡', '감사해욤', '감사합니당', '고맙당', '감사요', '땡큐요']) expect(greetingReply(text), text).toMatch(/천만에요/);
      for (const text of ['수고하세염', '수고하세여', '수고요', '잘자용', '바이요', '고생하셨습니당']) expect(greetingReply(text), text).toMatch(/수고/);
    });

    it('인사끼리 이어진 말도 받는다(작별 > 감사 > 인사 순으로 답한다)', () => {
      expect(greetingReply('ㅎㅇ 반가워')).toMatch(/안녕/);
      expect(greetingReply('안녕 델피야 반가워')).toMatch(/안녕/);
      expect(greetingReply('고마워 수고했어')).toMatch(/수고/);
      expect(greetingReply('감사합니다 수고하세요!')).toMatch(/수고/);
      expect(greetingReply('ㅎㅇ ㄳ')).toMatch(/천만에요/);
      expect(greetingReply('thanks a lot, bye')).toMatch(/수고/);
    });
  });

  it('인사가 아닌 말이 하나라도 섞이면 모델에게 맡긴다(물음·시킴·대답·웃음만)', () => {
    const NOT = [
      '응', 'ㅇㅇ', 'ㅇㅋ', 'ㄱㄱ', '네', '넵', '그래', '좋아', '진행', 'ok', 'yes', 'ㅋㅋ', 'ㅎㅎ', 'ㅋㅋㅋㅋ', '델피야', '?', '',
      '안녕 이 함수 뭐야', '하이퍼파라미터', '바이너리 파일', 'hi, fix the bug', 'hello world 출력해줘', '고마워 근데 테스트도 돌려줘',
      '수고했어 근데 왜 실패했어?', '안녕?? 어디야', '굿모닝 오늘 일정 알려줘', 'thanks but it still fails', '감사 인사 메일 써줘', '잘자 알람 기능 만들어줘',
      'ㅎㅇ 로그인 고쳐줘', '퇴근 시간 계산해줘', 'bye 버튼 추가', '안녕하세요 저는 김개발입니다',
    ];
    for (const text of NOT) expect(greetingReply(text), text).toBeNull();
  });

  it('자주 쓰는 변형(존댓말 꼬리·줄임말·되풀이)도 바로 답한다', () => {
    for (const text of ['ㅎㅇ요', 'ㅎㅇㅎㅇㅎㅇ', '하잉', '하이요', '안녕하세용', '안녕하십니까', '반가워', '반갑습니다', '안녕 ~', 'hi there', 'hey there', 'good morning', 'ㅎ2', 'ㅎ2ㅎ2', '하2', '하이루', '방가', '방가방가'])expect(greetingReply(text), text).toMatch(/안녕/);
    for (const text of ['고마워용', '감사감사', '땡스', 'ㄳㄳ', 'thank u', 'thanks!!']) expect(greetingReply(text), text).toMatch(/천만에요/);
    for (const text of ['잘가', 'ㅃㅃ', 'ㅃㅇ', '굿밤', '굿나잇', 'good night', '수고요', '수고하세요', 'ㅂ2', '바2', '빠2'])expect(greetingReply(text), text).toMatch(/수고/);
  });

  it('앞 대화에 대한 대답일 수 있는 말과 무언가를 묻거나 시키는 말은 모델에게 맡긴다', () => {
    for (const text of ['응', 'ㅇㅇ', 'ㅇㅋ', '진행', '그래', '네', '안녕 이 함수 뭐야', '고마워 근데 테스트도 돌려줘', 'hi, fix the bug', '안녕?? 어디야']) expect(greetingReply(text), text).toBeNull();
  });
});

describe('asksArchitecture', () => {
  it('구성·설계·아키텍처·합치기·나누기·전환·비교는 아키텍처 질문이다', () => {
    for (const text of ['모노레포 구성', '폴더 구조를 어떻게 설계할까', '아키텍처 추천해줘', '레포 합치기', '모듈 분리', 'DB 마이그레이션 전략', 'Nx vs Turborepo', 'monorepo setup', 'how should we architect this']) expect(asksArchitecture(text), text).toBe(true);
  });

  it('인사·용어 뜻·산수는 아키텍처 질문이 아니다', () => {
    for (const text of ['안녕', 'REST가 뭐야?', '1+1은 얼마야?', '오늘 날짜']) expect(asksArchitecture(text), text).toBe(false);
  });

  it('흔한 말에 섞인 낱말로 opus 를 부르지 않는다(이전 답, git merge, eslint setup, 이미지 scale)', () => {
    for (const text of ['이전 답 다시 보여줘', 'git merge 하는 법', 'eslint setup 어떻게 해', '이미지 scale 하는 css', 'split 함수 쓰는 법', '분리수거 요일']) expect(asksArchitecture(text), text).toBe(false);
  });
});

describe('pointsAtRepository', () => {
  it('파일 경로·확장자·폴더·구조를 말하면 저장소를 가리킨다', () => {
    for (const text of ['src/money.ts 보여줘', 'package.json 뭐야', '이 레포 폴더 구조 정리해줘', '디렉터리 구조 알려줘', 'repo 구조가 어때?']) expect(pointsAtRepository(text)).toBe(true);
  });

  it('"그 파일"·"방금 만든 폴더"처럼 지시어로 파일을 가리키면 저장소를 가리킨다', () => {
    for (const text of ['아까 그 파일 보여줘', '그 파일', '방금 만든 폴더 어디 있어?', '어디에 있어?']) expect(pointsAtRepository(text)).toBe(true);
  });

  it('일반 상식·산수·인사는 저장소를 가리키지 않는다', () => {
    for (const text of ['1+1은 얼마야?', '안녕', 'REST와 GraphQL 차이가 뭐야?', '지금 몇 시야?']) expect(pointsAtRepository(text)).toBe(false);
  });

  it('모노레포·멀티레포 같은 일반 개념은 이 저장소를 가리키지 않는다', () => {
    for (const text of ['모노레포할 때 어떻게 구성할까?', '멀티레포랑 모노레포 차이', 'monorepo 장단점', '폴리레포가 뭐야']) expect(pointsAtRepository(text)).toBe(false);
    expect(pointsAtRepository('이 모노레포 폴더 구조 알려줘')).toBe(true);
  });
});

describe('onlyDocuments', () => {
  it('문서 파일만 말하면 true, 코드가 섞이면 false', () => {
    expect(onlyDocuments('README.md 맨 아래에 hello rauha 한 줄을 추가해 줘')).toBe(true);
    expect(onlyDocuments('src/money.ts 고치고 README.md에도 반영해줘')).toBe(false);
    expect(onlyDocuments('Money.add가 빼기를 해, 고쳐줘')).toBe(false);
  });
});
