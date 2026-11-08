import { describe, expect, it } from 'vitest';
import { failureReason, loggedInText, loginText, loginUrlFrom, needsLogin, parseLoginStatus } from './claude-login.js';

describe('parseLoginStatus', () => {
  it('claude auth status의 JSON에서 로그인 여부만 읽는다', () => {
    expect(parseLoginStatus('{"loggedIn": true, "authMethod": "claude.ai"}')).toBe(true);
    expect(parseLoginStatus('{"loggedIn": false}')).toBe(false);
  });

  it('읽을 수 없는 출력은 모른다(null)고 한다', () => {
    expect(parseLoginStatus('')).toBeNull();
    expect(parseLoginStatus('not json')).toBeNull();
    expect(parseLoginStatus('{"loggedIn": "yes"}')).toBeNull();
  });
});

describe('loginUrlFrom', () => {
  it('출력에서 https 주소 하나를 뽑는다', () => {
    expect(loginUrlFrom('Opening browser...\nIf it does not open, visit: https://claude.ai/oauth/authorize?code=true&client_id=abc\n')).toBe('https://claude.ai/oauth/authorize?code=true&client_id=abc');
  });

  it('문장 끝 마침표·괄호는 주소에 넣지 않는다', () => {
    expect(loginUrlFrom('Visit https://claude.ai/login.')).toBe('https://claude.ai/login');
    expect(loginUrlFrom('(https://claude.ai/login)')).toBe('https://claude.ai/login');
  });

  it('http나 다른 프로토콜은 열지 않는다', () => {
    expect(loginUrlFrom('http://claude.ai/login')).toBeNull();
    expect(loginUrlFrom('file:///etc/passwd javascript:alert(1)')).toBeNull();
  });

  it('주소가 없으면 null이다', () => {
    expect(loginUrlFrom('')).toBeNull();
    expect(loginUrlFrom('Waiting for login')).toBeNull();
  });

  it('주소에 공백·제어 문자가 섞이면 거기서 끊는다', () => {
    expect(loginUrlFrom('https://claude.ai/a\u001b[0m next')).toBe('https://claude.ai/a');
  });
});

describe('needsLogin', () => {
  it('로그인이 필요하다는 안내 글이면 참이다', () => {
    expect(needsLogin('이 프로필은 Claude에 로그인되어 있지 않거나 로그인이 만료됐어요.')).toBe(true);
    expect(needsLogin('Claude 로그인이 필요합니다')).toBe(true);
    expect(needsLogin('Not logged in · Please run /login')).toBe(true);
  });

  it('다른 이유로 멈춘 글이면 거짓이다', () => {
    expect(needsLogin('사용 한도에 닿았어요')).toBe(false);
    expect(needsLogin('')).toBe(false);
  });
});

describe('failureReason', () => {
  it('실행 파일이 없으면 그 이유 한 줄이다', () => {
    expect(failureReason({ kind: 'no-executable' })).toBe('앱에 들어 있는 Claude 실행 파일을 찾지 못했어요.');
  });

  it('시간이 지났으면 그 이유 한 줄이다', () => {
    expect(failureReason({ kind: 'timeout' })).toContain('시간이 지나');
  });

  it('종료 코드가 0이 아니면 출력의 마지막 줄을 이유로 쓴다(길면 자른다)', () => {
    expect(failureReason({ kind: 'exit', code: 1, output: 'a\nError: access_denied\n\n' })).toBe('Error: access_denied');
    expect(failureReason({ kind: 'exit', code: 1, output: 'x'.repeat(300) }).length).toBeLessThanOrEqual(120);
  });

  it('출력이 비어 있으면 종료 코드만 알린다', () => {
    expect(failureReason({ kind: 'exit', code: 2, output: '' })).toBe('로그인이 끝나지 않았어요(종료 코드 2).');
  });

  it('로그인은 끝났는데 로그인 상태가 확인되지 않으면 그렇게 알린다', () => {
    expect(failureReason({ kind: 'not-confirmed' })).toContain('확인하지 못');
  });
});

describe('loginText', () => {
  it('진행 중·성공·실패·취소를 한 줄로 보여 준다', () => {
    expect(loginText({ state: 'idle', message: null })).toBe('');
    expect(loginText({ state: 'running', message: null })).toContain('브라우저');
    expect(loginText({ state: 'success', message: null })).toBe('로그인됐어요.');
    expect(loginText({ state: 'failed', message: '시간이 지났어요.' })).toBe('로그인하지 못했어요: 시간이 지났어요.');
    expect(loginText({ state: 'cancelled', message: null })).toBe('로그인을 취소했어요.');
  });
});

describe('loggedInText', () => {
  it('로그인 여부를 말로 바꾼다(모르면 모른다고 한다)', () => {
    expect(loggedInText(true)).toBe('로그인되어 있어요');
    expect(loggedInText(false)).toBe('로그인되어 있지 않아요');
    expect(loggedInText(null)).toBe('로그인 상태를 확인하지 못했어요');
  });
});
