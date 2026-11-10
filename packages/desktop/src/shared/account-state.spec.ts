import { describe, expect, it } from 'vitest';
import { accountCard, accountFromStatus, shortPath, unknownBecause } from './account-state.js';

describe('로그인 상태 읽기', () => {
  it('로그인된 출력에서는 누구인지를 읽는다(이메일 우선)', () => {
    const state = accountFromStatus('{"loggedIn": true, "authMethod": "claude.ai", "email": "a@b.com", "orgName": "Acme", "subscriptionType": "max"}');
    expect(state).toEqual({ kind: 'signed-in', who: 'a@b.com', detail: 'Acme · max' });
  });

  it('이메일이 없으면 로그인 방식으로, 그것도 없으면 "Claude 계정"으로 말한다', () => {
    expect(accountFromStatus('{"loggedIn": true, "authMethod": "api_key"}')).toMatchObject({ kind: 'signed-in', who: 'API key' });
    expect(accountFromStatus('{"loggedIn": true}')).toMatchObject({ kind: 'signed-in', who: 'Claude account' });
  });

  it('로그인 안 됐다고 분명히 답한 때만 "로그인 안 됨"이다', () => {
    expect(accountFromStatus('{"loggedIn": false, "authMethod": "none"}')).toEqual({ kind: 'signed-out' });
  });

  it('읽을 수 없는 출력은 "로그인 안 됨"이 아니라 "확인 못 함"이다', () => {
    for (const out of ['', 'Error: boom', '{"loggedIn": "yes"}', '{}']) {
      expect(accountFromStatus(out).kind).toBe('unknown');
    }
  });

  it('확인 못 한 이유를 한 줄로 말한다', () => {
    expect(unknownBecause({ kind: 'no-executable' })).toEqual({ kind: 'unknown', reason: 'Could not find the Claude executable bundled with the app.' });
    expect(unknownBecause({ kind: 'timeout', seconds: 10 })).toEqual({ kind: 'unknown', reason: 'Claude did not answer within 10s.' });
    expect(unknownBecause({ kind: 'config', message: '설정 파일이 깨졌어요' }).reason).toBe('Could not read the account settings: 설정 파일이 깨졌어요');
    expect(unknownBecause({ kind: 'spawn', message: 'spawn EACCES' }).reason).toBe('Could not start the Claude executable: spawn EACCES');
    expect(unknownBecause({ kind: 'exit', code: 1, stderr: 'a\nsomething failed\n' }).reason).toBe('Claude exited with an error (code 1): something failed');
    expect(unknownBecause({ kind: 'exit', code: 9, stderr: '' }).reason).toBe('Claude exited with an error (code 9).');
    expect(unknownBecause({ kind: 'unreadable' }).reason).toBe('Could not read the reply from Claude.');
  });

  it('이유가 너무 길면 한 줄 길이로 줄인다', () => {
    const reason = unknownBecause({ kind: 'spawn', message: 'x'.repeat(500) }).reason;
    expect(reason.length).toBeLessThanOrEqual(160);
  });
});

describe('설정 폴더 경로 줄이기', () => {
  it('홈 폴더는 ~로 줄이고 역슬래시는 슬래시로 보인다', () => {
    expect(shortPath('C:\\Users\\k\\.rauha\\profiles\\personal\\claude', 'C:\\Users\\k')).toBe('~/.rauha/profiles/personal/claude');
    expect(shortPath('/Users/k/.rauha/profiles/work/claude', '/Users/k')).toBe('~/.rauha/profiles/work/claude');
  });

  it('홈 밖이거나 홈을 모르면 그대로 둔다', () => {
    expect(shortPath('/opt/claude', '/Users/k')).toBe('/opt/claude');
    expect(shortPath('/opt/claude', null)).toBe('/opt/claude');
  });

  it('이름만 비슷한 다른 폴더는 줄이지 않는다', () => {
    expect(shortPath('/Users/kim/x', '/Users/k')).toBe('/Users/kim/x');
  });
});

describe('계정 카드', () => {
  const dir = '~/.rauha/profiles/personal/claude';

  it('로그인됨: 누구인지 보이고 로그인 버튼은 작은 "다른 계정으로 로그인"이다', () => {
    const card = accountCard({ state: { kind: 'signed-in', who: 'a@b.com', detail: null }, configDir: dir });
    expect(card).toMatchObject({ tone: 'ok', title: 'Logged in · a@b.com', loginLabel: 'Log in with another account', loginProminent: false });
  });

  it('로그인 안 됨: 로그인 버튼이 두드러지고, 이 앱 계정 폴더가 터미널 로그인과 따로라는 걸 알려 준다', () => {
    const card = accountCard({ state: { kind: 'signed-out' }, configDir: dir });
    expect(card).toMatchObject({ tone: 'off', title: 'Not logged in', loginLabel: 'Log in to Claude', loginProminent: true });
    expect(card.detail).toContain(dir);
    expect(card.detail).toContain('terminal');
  });

  it('확인 못 함: 이유가 보이고 "로그인 안 됨"처럼 두드러진 로그인 버튼을 내지 않는다', () => {
    const card = accountCard({ state: { kind: 'unknown', reason: 'It takes a while' }, configDir: dir });
    expect(card).toMatchObject({ tone: 'warn', title: 'Could not check login status', detail: 'It takes a while', loginProminent: false, canRecheck: true });
  });

  it('아직 읽는 중이면 읽는 중이라고만 하고 로그인을 권하지 않는다', () => {
    expect(accountCard(null)).toMatchObject({ tone: 'warn', title: 'Checking login status…', loginProminent: false, canRecheck: false });
  });

  it('설정 폴더가 있으면 로그인됨 카드에도 어느 폴더인지 보인다', () => {
    expect(accountCard({ state: { kind: 'signed-in', who: 'a@b.com', detail: 'Acme · max' }, configDir: dir }).detail).toBe(`Acme · max · Account folder ${dir}`);
  });
});
