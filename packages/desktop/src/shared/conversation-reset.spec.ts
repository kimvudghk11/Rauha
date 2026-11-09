import { describe, expect, it } from 'vitest';
import { ConversationResetDto, RESET_CONFIRM, resetNotice } from './conversation-reset.js';

describe('ConversationResetDto', () => {
  it('root가 null이면 작업 폴더의 레포 전부를 대상으로 한다', () => {
    const dto = ConversationResetDto.from({ root: null });
    expect(dto.targets(['E:/work/a', 'E:/work/b'])).toEqual(['E:/work/a', 'E:/work/b']);
  });

  it('root를 주면 알려진 레포 가운데 같은 경로 하나만 대상으로 한다(표기 차이는 무시)', () => {
    const dto = ConversationResetDto.from({ root: 'e:\\work\\A\\' });
    expect(dto.targets(['E:/work/a', 'E:/work/b'])).toEqual(['E:/work/a']);
  });

  it('앱이 모르는 경로는 대상이 되지 않는다', () => {
    expect(ConversationResetDto.from({ root: 'C:/Windows' }).targets(['E:/work/a'])).toEqual([]);
  });

  it('객체가 아니거나 root가 글자·null이 아니면 거절한다', () => {
    expect(() => ConversationResetDto.from(undefined)).toThrow();
    expect(() => ConversationResetDto.from({ root: 3 })).toThrow();
    expect(() => ConversationResetDto.from({ root: '' })).toThrow();
    expect(() => ConversationResetDto.from({})).toThrow();
  });
});

describe('초기화 안내 글', () => {
  it('확인 글은 되돌릴 수 없음과 기억이 남음을 알리고 달러 표시가 없다', () => {
    expect(RESET_CONFIRM.body).toContain('되돌릴 수 없');
    expect(RESET_CONFIRM.body).toContain('기억');
    expect(RESET_CONFIRM.body).not.toContain('$');
  });

  it('성공하면 비웠다고, 실패하면 이유를, 대상이 없으면 못 찾았다고 알린다', () => {
    expect(resetNotice({ ok: true, cleared: 1 })).toContain('비웠어요');
    expect(resetNotice({ ok: true, cleared: 0 })).toContain('찾지 못했어요');
    expect(resetNotice({ ok: false, error: '실패 이유' })).toBe('실패 이유');
  });
});
