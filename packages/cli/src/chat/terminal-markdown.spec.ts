import { describe, expect, it } from 'vitest';
import { terminalMarkdown } from './terminal-markdown.js';

const hl = (t: string) => `<${t}>`;

describe('terminalMarkdown — 터미널에서 마크다운 답 읽기', () => {
  it('### 제목과 ■ 제목은 ▍ 강조 줄이 된다', () => {
    expect(terminalMarkdown('### 관리 주체\n■ 비용', hl)).toEqual(['<▍ 관리 주체>', '<▍ 비용>']);
  });

  it('강조 함수가 없으면 ▍ 제목만 남긴다', () => {
    expect(terminalMarkdown('## 결론', null)).toEqual(['▍ 결론']);
  });

  it('굵게·인라인 코드 표시 문자는 지우고 글자만 남긴다', () => {
    expect(terminalMarkdown('**ECS**가 `task.ts`를 부른다', null)).toEqual(['ECS가 task.ts를 부른다']);
  });

  it('표는 구분 줄을 빼고 한글 폭에 맞춰 칸을 맞춘다', () => {
    expect(terminalMarkdown('| 항목 | 값 |\n| --- | --- |\n| 메모리 | **512** |\n| cpu | 1 |', null)).toEqual(['항목    값', '──────  ───', '메모리  512', 'cpu     1']);
  });

  it('코드 블록은 울타리 줄을 빼고 안쪽을 그대로 두 칸 들여 쓴다', () => {
    expect(terminalMarkdown('실행:\n```bash\nyarn **test**\n```', null)).toEqual(['실행:', '  yarn **test**']);
  });

  it('목록·번호 목록·빈 줄은 그대로 둔다', () => {
    expect(terminalMarkdown('- 하나\n\n1. 둘', null)).toEqual(['- 하나', '', '1. 둘']);
  });
});
