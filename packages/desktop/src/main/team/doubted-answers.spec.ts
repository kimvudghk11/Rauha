import { describe, expect, it } from 'vitest';
import { DoubtedAnswers } from './doubted-answers.js';

const turn = (input: string, result: string) => ({ input, result });

describe('DoubtedAnswers', () => {
  it('찾지 못했다고 끝난 답은 사실이 아니라 다시 확인할 것으로 표시한다', () => {
    const [marked] = DoubtedAnswers.mark([turn('beta-api 구조 알려줘', 'beta-api라는 폴더는 찾을 수 없어요.')]);
    expect(marked?.input).toBe('beta-api 구조 알려줘');
    expect(marked?.result).toBe('(이전에 찾지 못함: 다시 확인할 것)');
  });

  it('찾지 못함류 말이 없는 답은 그대로 둔다', () => {
    const turns = [turn('구조 알려줘', 'src 아래에 domain과 application이 있어요.')];
    expect(DoubtedAnswers.mark(turns)).toEqual(turns);
  });

  it('사용자가 바로 다음 말에서 틀렸다고 지적한 답도 다시 확인할 것으로 표시한다', () => {
    const marked = DoubtedAnswers.mark([turn('포트가 뭐야', '8080이에요.'), turn('그거 틀렸어, 다시 봐줘', '3000이에요.')]);
    expect(marked[0]?.result).toBe('(사용자가 틀렸다고 지적함: 다시 확인할 것)');
    expect(marked[1]?.result).toBe('3000이에요.');
  });

  it('턴 수와 순서는 바꾸지 않는다', () => {
    const turns = [turn('a', '못 찾았어요'), turn('b', '정상'), turn('c', '정상')];
    expect(DoubtedAnswers.mark(turns).map((t) => t.input)).toEqual(['a', 'b', 'c']);
  });
});
