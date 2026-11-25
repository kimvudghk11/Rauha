import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const direct = readFileSync(resolve(__dirname, '../../../../../prompts/direct.md'), 'utf8');

describe('메인 채팅(지배인) 프롬프트', () => {
  it('답은 answer 칸에만 한 번 쓰고, 같은 글을 일반 메시지로 또 쓰지 않게 한다(실측: 블로그 글 4,520자가 두 번 출력됐다)', () => {
    expect(direct).toMatch(/only in `answer`/i);
    expect(direct).toMatch(/not (also )?write (it|the reply) (as|in) (a )?(normal|plain)/i);
  });

  it('팀원이 끝낸 글(문서·블로그)은 다시 쓰거나 줄이지 않고 그대로 answer 에 옮기게 한다', () => {
    expect(direct).toMatch(/finished (text|document|post)/i);
    expect(direct).toMatch(/as it is|verbatim|unchanged/i);
  });
});
