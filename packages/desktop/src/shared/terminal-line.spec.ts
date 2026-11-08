import { describe, expect, it } from 'vitest';
import { parseInput, stripAnsi, TerminalScreen } from './terminal-line.js';

describe('터미널 입력줄 읽기', () => {
  it('빈 줄은 아무 일도 아니다', () => {
    expect(parseInput('   ')).toEqual({ kind: 'empty' });
  });

  it('clear·cls는 화면 지우기다', () => {
    expect(parseInput('clear')).toEqual({ kind: 'clear' });
    expect(parseInput('CLS')).toEqual({ kind: 'clear' });
  });

  it('cd 폴더는 터미널이 폴더를 기억한다', () => {
    expect(parseInput('cd src')).toEqual({ kind: 'cd', target: 'src' });
    expect(parseInput('cd /d D:\\work')).toEqual({ kind: 'cd', target: 'D:\\work' });
    expect(parseInput('Set-Location ..')).toEqual({ kind: 'cd', target: '..' });
  });

  it('따옴표로 감싼 폴더 이름은 따옴표를 벗긴다', () => {
    expect(parseInput('cd "my docs"')).toEqual({ kind: 'cd', target: 'my docs' });
  });

  it('cd 만 쓰면 홈, cd - 는 이전 폴더', () => {
    expect(parseInput('cd')).toEqual({ kind: 'cd', target: null });
    expect(parseInput('cd -')).toEqual({ kind: 'cd-back' });
  });

  it('명령을 이은 줄(cd a && npm test)은 그대로 실행한다', () => {
    expect(parseInput('cd a && npm test')).toEqual({ kind: 'run', command: 'cd a && npm test' });
    expect(parseInput('cd a; ls')).toEqual({ kind: 'run', command: 'cd a; ls' });
  });

  it('cd로 시작하는 다른 명령(cdk deploy)은 명령이다', () => {
    expect(parseInput('cdk deploy')).toEqual({ kind: 'run', command: 'cdk deploy' });
  });

  it('나머지는 실행할 명령이다', () => {
    expect(parseInput('  git status ')).toEqual({ kind: 'run', command: 'git status' });
  });
});

describe('출력 정리', () => {
  it('색·커서 제어 글자를 지운다', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m ok')).toBe('red ok');
    expect(stripAnsi('\u001b]0;title\u0007hi')).toBe('hi');
  });

  it('줄 바꿈으로 줄을 나눈다', () => {
    const s = new TerminalScreen();
    s.write('a\nb');
    s.write('c\n');
    expect(s.text()).toBe('a\nbc\n');
  });

  it('CRLF도 한 번만 줄을 바꾼다', () => {
    const s = new TerminalScreen();
    s.write('a\r\nb');
    expect(s.text()).toBe('a\nb');
  });

  it('캐리지 리턴은 같은 줄을 덮어쓴다(진행 막대)', () => {
    const s = new TerminalScreen();
    s.write('10%\r50%\r100%');
    expect(s.text()).toBe('100%');
  });

  it('덮어쓴 글이 더 짧으면 앞부분만 바뀐다', () => {
    const s = new TerminalScreen();
    s.write('abcdef\rxy');
    expect(s.text()).toBe('xycdef');
  });

  it('줄 수 상한을 넘으면 오래된 줄부터 버린다', () => {
    const s = new TerminalScreen(3);
    s.write('1\n2\n3\n4\n5');
    expect(s.text()).toBe('3\n4\n5');
  });

  it('지우면 빈 화면이다', () => {
    const s = new TerminalScreen();
    s.write('abc');
    s.clear();
    expect(s.text()).toBe('');
  });

  it('endLine은 줄 끝이 아니면 줄을 바꾸고, 빈 줄이면 그대로 둔다', () => {
    const s = new TerminalScreen();
    s.write('abc');
    s.endLine();
    s.endLine();
    expect(s.text()).toBe('abc\n');
  });
});
