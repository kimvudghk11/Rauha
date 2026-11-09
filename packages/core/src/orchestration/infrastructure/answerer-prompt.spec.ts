import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const answerer = readFileSync(resolve(__dirname, '../../../../../prompts/answerer.md'), 'utf8');

describe('답변 팀원 프롬프트', () => {
  it('앞 대화에서 다시 확인할 것으로 표시된 답은 사실로 쓰지 않고 파일을 직접 열어 확인하게 한다', () => {
    const conversation = answerer.slice(answerer.indexOf('<conversation>'), answerer.indexOf('</conversation>'));
    expect(conversation).toContain('다시 확인할 것');
    expect(conversation).toMatch(/not as fact|never as fact|not treat/i);
    expect(conversation).toMatch(/open the files? yourself/i);
  });
});
