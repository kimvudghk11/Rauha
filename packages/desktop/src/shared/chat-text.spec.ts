import { describe, expect, it } from 'vitest';
import { canRevise, composerHeight, replyWho } from './chat-text.js';

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
