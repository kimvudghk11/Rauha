import { describe, expect, it } from 'vitest';
import { ToolTally } from './tool-tally.js';

describe('ToolTally', () => {
  it('같은 도구를 부른 횟수를 이름별로 센다', () => {
    const tally = ToolTally.empty();
    tally.record('Grep');
    tally.record('Read');
    tally.record('Grep');
    expect(tally.entries()).toEqual([
      { name: 'Grep', count: 2 },
      { name: 'Read', count: 1 },
    ]);
  });

  it('많이 쓴 도구가 앞에 오고 횟수가 같으면 처음 쓴 순서를 지킨다', () => {
    const tally = ToolTally.empty();
    for (const name of ['Glob', 'Read', 'Read', 'Bash']) tally.record(name);
    expect(tally.entries().map((e) => e.name)).toEqual(['Read', 'Glob', 'Bash']);
  });

  it('한 줄 요약은 도구 이름과 횟수만 보이고 쓴 도구가 없으면 빈 글이다', () => {
    const tally = ToolTally.empty();
    expect(ToolTally.line(tally.entries())).toBe('');
    for (const name of ['Grep', 'Grep', 'Grep', 'Read']) tally.record(name);
    expect(ToolTally.line(tally.entries())).toBe('Grep 3 · Read 1');
  });

  it('빈 이름은 도구 하나로 세지 않는다', () => {
    const tally = ToolTally.empty();
    tally.record('');
    expect(tally.entries()).toEqual([]);
  });
});
