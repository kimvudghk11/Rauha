import { describe, expect, it } from 'vitest';
import { askArgs, cleanAnswer, limitMessage, loginState, AI_PROVIDERS, providerOf } from './external-ai.js';

describe('바깥 AI 고르기', () => {
  it('kiro · codex 만 받는다(claude 는 팀이 맡는다)', () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual(['kiro', 'codex']);
    expect(providerOf('kiro')?.label).toBe('Kiro');
    expect(providerOf('rm -rf')).toBeNull();
  });
});

describe('한 번 묻기 인자: 파일을 고치지 못하게', () => {
  it('kiro 는 대화 없이, 도구를 미리 허락하지 않는다', () => {
    const a = askArgs('kiro', 'hi', 'C:/out.txt');
    expect(a).toEqual(['chat', '--no-interactive', 'hi']);
    expect(a.join(' ')).not.toMatch(/trust-all|-a\b/);
  });
  it('codex 는 읽기 전용 샌드박스, 기록 없이, 마지막 답을 파일로', () => {
    expect(askArgs('codex', 'hi', 'C:/out.txt')).toEqual(['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-last-message', 'C:/out.txt', 'hi']);
  });
  it('- 로 시작하는 질문도 옵션으로 읽히지 않게 -- 뒤에 둔다', () => {
    expect(askArgs('codex', '--help', 'o').slice(-2)).toEqual(['--', '--help']);
    expect(askArgs('kiro', '-a', 'o').slice(-2)).toEqual(['--', '-a']);
  });
});

describe('답 정리', () => {
  it('kiro 출력에서 색 코드·크레딧 줄·> 를 떼고 답만', () => {
    const raw = '\u001b[m\u001b[0m\u001b[?25l\u001b[0m\u001b[0m\n\u001b[m\n ▸ Credits: 0.03 • Time: 3s\n\u001b[m> \u001b[0mpong\n\u001b[0m\u001b[1G\u001b[0m\u001b[0m\u001b[?25h';
    expect(cleanAnswer('kiro', raw)).toBe('pong');
  });
  it('여러 줄 답은 줄을 지킨다', () => {
    expect(cleanAnswer('kiro', '> line one\nline two\n\n ▸ Time: 2s')).toBe('line one\nline two');
    expect(cleanAnswer('codex', '  answer\n')).toBe('answer');
  });
});

describe('한도 · 로그인 상태 읽기', () => {
  it('한도 문구를 쉬운 말로(초기화 날짜 포함)', () => {
    expect(limitMessage('kiro', 'Monthly request limit reached\nUpgrade your plan\nThe limits reset on 12/01.')).toBe('Kiro’s monthly free limit is used up. It resets on 12/01. You can switch to another account in Extensions > AI accounts.');
    expect(limitMessage('codex', "You've hit your usage limit. Try again later.")).toMatch(/ChatGPT.*limit/);
    expect(limitMessage('kiro', 'pong')).toBeNull();
  });
  it('로그인 상태', () => {
    expect(loginState('kiro', 'Logged in with GitHub\nEmail: me@example.com', 0)).toEqual({ signedIn: true, who: 'me@example.com · GitHub' });
    expect(loginState('kiro', 'Not logged in', 1)).toEqual({ signedIn: false, who: '' });
    expect(loginState('codex', 'Logged in using ChatGPT', 0)).toEqual({ signedIn: true, who: 'ChatGPT account' });
    expect(loginState('codex', 'Not logged in', 1)).toEqual({ signedIn: false, who: '' });
  });
});
