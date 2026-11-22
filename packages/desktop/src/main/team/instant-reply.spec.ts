import { describe, expect, it } from 'vitest';
import { instantReply } from './instant-reply.js';

describe('instantReply', () => {
  it('인사는 작업 폴더 준비(git·체크포인트) 없이 바로 답한다', () => {
    expect(instantReply('ㅎㅇ', {})).toMatchObject({ kind: 'answer', answer: expect.stringContaining('안녕하세요'), costUsd: 0, canGoDeeper: false });
    expect(instantReply('고마워', {})).toMatchObject({ kind: 'answer' });
  });

  it('인사가 아니면, 또는 더 깊게·이어서 묻기·이미지를 붙인 말이면 바로 답하지 않는다(평소 흐름으로)', () => {
    expect(instantReply('이 함수 뭐 해?', {})).toBeNull();
    expect(instantReply('ㅎㅇ', { depth: 'deep' })).toBeNull();
    expect(instantReply('ㅎㅇ', { followUp: true })).toBeNull();
    expect(instantReply('ㅎㅇ', { images: true })).toBeNull();
  });
});
