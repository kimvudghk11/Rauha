import { describe, expect, it } from 'vitest';
import { canRevise, composerHeight, replyWho, roomLogLine, stopReasonText } from './chat-text.js';

describe('입력칸 높이', () => {
  it('내용이 한 줄이면 기본 높이를 지킨다', () => {
    expect(composerHeight(22)).toBe(40);
  });
  it('여러 줄이면 내용 높이만큼 늘어난다', () => {
    expect(composerHeight(96)).toBe(96);
  });
  it('아주 길면 최대 높이에서 멈추고 안에서 스크롤한다', () => {
    expect(composerHeight(900)).toBe(160);
  });
});

describe('다르게 해 줘 버튼', () => {
  it('바꿀 내용을 적기 전에는 누를 수 없다', () => {
    expect(canRevise('')).toBe(false);
    expect(canRevise('   \n')).toBe(false);
  });
  it('내용을 적으면 누를 수 있다', () => {
    expect(canRevise('main 말고 qa에 올려 줘')).toBe(true);
  });
});

describe('결과 말풍선의 출처', () => {
  it('어느 요청에 대한 답인지 요청 앞부분을 붙인다', () => {
    expect(replyWho('Delfi', '로그인 화면 문구 정리')).toBe('Delfi · "로그인 화면 문구 정리"');
  });
  it('요청이 길면 줄여서 붙이고 줄바꿈은 공백으로 바꾼다', () => {
    expect(replyWho('Delfi', `${'가'.repeat(40)}\n끝`)).toBe(`Delfi · "${'가'.repeat(23)}…"`);
  });
});

describe('멈춤 이유 한국어 문구', () => {
  it('이유가 없으면 모른다고 쓰되 다시 맡길 수 있다고 알린다', () => {
    expect(stopReasonText(null)).toBe('이유를 알 수 없어요.');
  });
  it('이미 한국어인 이유는 그대로 둔다', () => {
    expect(stopReasonText('사용자가 멈춤')).toBe('사용자가 멈춤');
  });
  it('사용 한도에 걸린 영어 오류는 한도 문구로 바꾼다', () => {
    expect(stopReasonText('Claude AI usage limit reached|1731000000')).toBe('사용 한도에 걸렸어요. 한도가 풀린 뒤에 다시 맡겨 주세요.');
    expect(stopReasonText('429 rate_limit_error')).toBe('사용 한도에 걸렸어요. 한도가 풀린 뒤에 다시 맡겨 주세요.');
  });
  it('로그인 문제는 로그인 문구로 바꾼다', () => {
    expect(stopReasonText('401 authentication_error: invalid x-api-key')).toBe('로그인이 풀렸어요. 설정의 계정 칸에서 로그인한 뒤 다시 맡겨 주세요.');
  });
  it('네트워크 오류는 연결 문구로 바꾼다', () => {
    expect(stopReasonText('fetch failed: ECONNRESET')).toBe('네트워크 연결이 끊겼어요. 연결을 확인하고 다시 맡겨 주세요.');
  });
  it('그 밖의 영어 오류는 원문을 괄호로 남긴다', () => {
    expect(stopReasonText('boom')).toBe('예상하지 못한 오류로 멈췄어요. (boom)');
  });
});

describe('팀 방의 마지막 줄', () => {
  it('끝난 일은 마지막 진행 줄 대신 완료로 보인다', () => {
    expect(roomLogLine('done', '리뷰어 작업 중…')).toBe('▸ Done');
  });

  it('멈춘 일은 마지막 진행 줄 대신 멈춤으로 보인다', () => {
    expect(roomLogLine('stopped', '리뷰어 작업 중…')).toBe('▸ Stopped');
  });

  it('도는 일은 마지막 진행 줄을 그대로 보이고, 줄이 없으면 시작을 기다린다고 한다', () => {
    expect(roomLogLine('running', '리뷰어 작업 중…')).toBe('▸ 리뷰어 작업 중…');
    expect(roomLogLine('queued', null)).toBe('▸ 시작을 기다려요');
  });
});
