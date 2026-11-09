import { describe, expect, it } from 'vitest';
import { ConversationResets } from './conversation-resets.js';

describe('ConversationResets', () => {
  it('초기화한 적 없는 레포의 업무는 결과를 합친다', async () => {
    const mark = new ConversationResets().watch('E:/work/app');
    let ran = false;
    await mark.ifCurrent(async () => void (ran = true));
    expect(ran).toBe(true);
  });

  it('초기화하기 전에 시작한 업무의 결과는 합치지 않는다', async () => {
    const resets = new ConversationResets();
    const mark = resets.watch('E:/work/app');
    resets.reset('E:/work/app');
    let ran = false;
    await mark.ifCurrent(async () => void (ran = true));
    expect(ran).toBe(false);
  });

  it('초기화한 뒤에 시작한 업무의 결과는 합친다', async () => {
    const resets = new ConversationResets();
    resets.reset('E:/work/app');
    let ran = false;
    await resets.watch('E:/work/app').ifCurrent(async () => void (ran = true));
    expect(ran).toBe(true);
  });

  it('다른 레포를 초기화해도 이 레포의 업무는 영향받지 않는다', () => {
    const resets = new ConversationResets();
    const mark = resets.watch('E:/work/app');
    resets.reset('E:/work/other');
    expect(mark.isStale()).toBe(false);
  });

  it('경로 표기(대소문자, 역슬래시)가 달라도 같은 레포로 본다', () => {
    const resets = new ConversationResets();
    const mark = resets.watch('E:/work/app');
    resets.reset('e:\\work\\App\\');
    expect(mark.isStale()).toBe(true);
  });
});
