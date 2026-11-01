import { describe, expect, it } from 'vitest';
import { queueLines, shellLines } from './command-lines.js';

describe('shellLines', () => {
  it('출력을 들여 써서 보여 주고, 성공하면 상태 줄을 더하지 않는다', () => {
    expect(shellLines({ output: 'a\r\nb\n', exitCode: 0, timedOut: false }, 120_000)).toEqual(['  a', '  b']);
  });

  it('실패하면 종료 코드를 알린다', () => {
    expect(shellLines({ output: '', exitCode: 2, timedOut: false }, 120_000)).toEqual(['  종료 코드 2']);
    expect(shellLines({ output: '', exitCode: null, timedOut: false }, 120_000)).toEqual(['  종료 코드 -']);
  });

  it('시간이 지나 멈췄으면 몇 초인지 알린다', () => {
    expect(shellLines({ output: 'x', exitCode: null, timedOut: true }, 120_000)).toEqual(['  x', '  120초가 지나 멈췄어요.']);
  });
});

describe('queueLines', () => {
  it('비었으면 기다리는 입력이 없다고 알린다', () => {
    expect(queueLines([])).toEqual(['  기다리는 입력이 없어요.']);
  });

  it('번호를 붙여 순서대로 보여 주고 비우는 법을 알린다', () => {
    const lines = queueLines(['하나', '둘']);
    expect(lines.join('\n')).toContain('기다리는 입력 2개 (/queue clear로 비워요)');
    expect(lines).toContain('    1. 하나');
    expect(lines).toContain('    2. 둘');
  });
});
