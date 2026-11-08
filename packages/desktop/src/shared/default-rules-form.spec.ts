import { describe, expect, it } from 'vitest';
import { variantsFromText, variantsToText } from './default-rules-form.js';

describe('기본 규칙의 찾을 글 칸', () => {
  it('경우마다 한 줄, 줄 안의 글은 +로 잇고 도구는 앞에 쓴다', () => {
    const variants = [{ tools: ['Bash'], includes: ['git push', 'main'] }, { tools: [], includes: ['mcp__playwright__'] }];
    expect(variantsToText(variants)).toBe('Bash: git push + main\nmcp__playwright__');
  });

  it('글로 적은 것을 다시 경우들로 읽는다(빈 줄·빈 글은 버린다)', () => {
    expect(variantsFromText('Bash: git push + main\n\n  terraform apply \n + \nWrite, Edit: .github')).toEqual([
      { tools: ['Bash'], includes: ['git push', 'main'] },
      { tools: [], includes: ['terraform apply'] },
      { tools: ['Write', 'Edit'], includes: ['.github'] },
    ]);
  });

  it('도구 이름이 아닌 앞말의 콜론은 찾을 글로 본다', () => {
    expect(variantsFromText('curl http://x')).toEqual([{ tools: [], includes: ['curl http://x'] }]);
    expect(variantsFromText('http://x')).toEqual([{ tools: [], includes: ['http://x'] }]);
  });

  it('쓴 글을 되읽어도 같다', () => {
    const variants = [{ tools: ['Bash'], includes: ['aws', 'delete-'] }];
    expect(variantsFromText(variantsToText(variants))).toEqual(variants);
  });
});
