import { describe, expect, it } from 'vitest';
import { ExternalAiService } from './external-ai-service.js';

const none = ExternalAiService.create({ platform: process.platform, env: { PATH: '' }, fake: false });
const fake = ExternalAiService.create({ platform: process.platform, env: { PATH: '' }, fake: true });

describe('바깥 AI 서비스', () => {
  it('모르는 AI·빈 질문·너무 긴 질문은 실행 전에 거절한다', async () => {
    expect(await none.ask('gpt-x', 'hi', '.')).toMatchObject({ ok: false, error: 'Unknown AI.' });
    expect(await none.ask('kiro', '   ', '.')).toMatchObject({ ok: false });
    expect(await none.ask('kiro', 'x'.repeat(20_001), '.')).toMatchObject({ ok: false, error: expect.stringMatching(/too long/) });
    expect(await none.login('../evil')).toMatchObject({ ok: false });
  });
  it('설치돼 있지 않으면 설치 안내를 준다', async () => {
    expect(await none.ask('codex', 'hi', '.')).toMatchObject({ ok: false, error: expect.stringMatching(/not installed.*npm install -g @openai\/codex/) });
    expect(await none.status()).toEqual([
      { id: 'kiro', installed: false, signedIn: false, who: '' },
      { id: 'codex', installed: false, signedIn: false, who: '' },
    ]);
  });
  it('확인용 실행에서는 CLI 를 부르지 않고 정해 둔 답', async () => {
    expect(await fake.ask('kiro', 'hello', '.')).toMatchObject({ ok: true, data: { text: '(Kiro test answer) hello' } });
  });
});
