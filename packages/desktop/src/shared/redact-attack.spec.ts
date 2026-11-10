import { describe, expect, it } from 'vitest';
import { BlogRedactor, type RedactContext } from './blog-redact.js';
import { redactSecrets } from './chat-redact.js';

// 시험용 가짜 비밀: 조각을 이어붙여 만든다(저장소에 진짜처럼 보이는 값을 두지 않는다).
const awsKey = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
const awsSecret = ['wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCYEXAMPLEKEY'].join('');
const ghToken = ['gh', 'p_', 'a'.repeat(30)].join('');
const skKey = ['s', 'k-', 'proj-', 'b'.repeat(30)].join('');
const jwt = ['ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcdefghij1234567890'].join('');
const account = '1234' + '5678' + '9012';

const ctx: RedactContext = { repoNames: ['payroll-core'], companyNames: ['Acme Corp'], userName: 'kimtester', homePath: 'C:/Users/kimtester' };
const upload = (text: string): string => BlogRedactor.create(ctx, []).apply(text).text;

const SECRET_SAMPLES: readonly (readonly [string, string])[] = [
  ['AWS 접근 키', awsKey],
  ['깃허브 토큰', ghToken],
  ['sk 키', skKey],
  ['JWT', jwt],
  ['AWS 비밀 키(접두사 있는 변수 이름)', `AWS_SECRET_ACCESS_KEY=${awsSecret}`],
  ['AWS 비밀 키(소문자 설정 줄)', `aws_secret_access_key = ${awsSecret}`],
  ['환경 변수 이름 접두사', `OPENAI_API_KEY=${['abc', '123', 'def456'].join('')}`],
  ['접두사 있는 토큰 변수', `GITHUB_TOKEN: ${['abc', '123', 'def456'].join('')}`],
  ['JSON 비밀번호', `{"password": "${['hunter', '2'].join('')}"}`],
  ['JSON 토큰', `{"access_token":"${['tok', 'en', 'value99'].join('')}"}`],
  ['따옴표 안 api key', `api_key = '${['abcd', 'efgh', '1234'].join('')}'`],
  ['URL 속 비밀번호', `postgres://admin:${['pa', 'ss', 'w0rd'].join('')}@db.internal/app`],
  ['개인 키 블록', ['-----BEGIN ', 'PRIVATE KEY-----', '\nMIIE', 'abc\n', '-----END ', 'PRIVATE KEY-----'].join('')],
];

describe('채팅 기록 가림 우회 시도', () => {
  it.each(SECRET_SAMPLES)('저장 전에 가려진다: %s', (_name, sample) => {
    const out = redactSecrets(`앞 글 ${sample} 뒷 글`);
    expect(out).not.toContain(awsKey);
    expect(out).not.toContain(awsSecret);
    expect(out).not.toContain(ghToken);
    expect(out).not.toContain(skKey);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('tokenvalue99');
    expect(out).not.toContain('abc123def456');
    expect(out).not.toContain('abcdefgh1234');
    expect(out).not.toContain('pas' + 'sw0rd');
    expect(out).not.toContain('MIIEabc');
    expect(out).not.toContain('eyJzdWIi');
    expect(out).toContain('[값 가림]');
  });

  it('여러 번 거쳐도 결과가 같다', () => {
    for (const [, sample] of SECRET_SAMPLES) {
      const once = redactSecrets(sample);
      expect(redactSecrets(once)).toBe(once);
    }
  });

  it('한국어 글에 붙어 있어도 가려진다', () => {
    expect(redactSecrets(`키는${skKey}입니다`)).not.toContain(skKey);
    expect(redactSecrets(`토큰:${ghToken}`)).not.toContain(ghToken);
  });
});

describe('리포트 올리기 가림 우회 시도', () => {
  it.each(SECRET_SAMPLES)('올리기 전에 가려진다: %s', (_name, sample) => {
    const out = upload(`메모 ${sample} 끝`);
    expect(out).not.toContain(awsSecret);
    expect(out).not.toContain(awsKey);
    expect(out).not.toContain(skKey);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc123def456');
  });

  it('회사·레포·사용자·홈 경로가 대소문자·섞인 구분자로 적혀도 가려진다', () => {
    const out = upload('ACME CORP, acme   corp, PAYROLL-CORE, KimTester, c:\\users\\kimtester\\x,C:/Users/KIMTESTER/y');
    for (const leak of [/acme/i, /payroll/i, /kimtester/i]) expect(out).not.toMatch(leak);
  });

  it('눈에 안 보이는 글자(너비 0)나 전각 글자를 끼워 넣어도 가려진다', () => {
    const zw = '\u200b';
    const out = upload(`Ac${zw}me Corp / ＡＣＭＥ Corp / ${account.slice(0, 6)}${zw}${account.slice(6)} / ａｄｍｉｎ＠ｅｘａｍｐｌｅ．ｃｏｍ`);
    expect(out).not.toMatch(/acme/i);
    expect(out).not.toContain(account.slice(0, 6));
    expect(out).not.toContain('ａｄｍｉｎ');
  });

  it('계정 번호는 붙여 쓰든 하이픈이든 공백이든 가려진다', () => {
    for (const form of [account, '1234-5678-9012', '1234 5678 9012']) {
      expect(upload(`account ${form} end`), form).not.toMatch(/1234.?5678.?9012/);
    }
  });

  it('흔치 않은 최상위 도메인과 하위 도메인도 가려진다', () => {
    const out = upload('see wiki.acme-internal.app and git.example.ai and tool.corp.co.kr and host.example.me');
    expect(out).not.toMatch(/acme-internal|example\.ai|example\.me/);
  });

  it('제목처럼 짧은 글에서도 같은 규칙이 적용된다', () => {
    expect(upload(`로그인 실패 ${ghToken}`)).not.toContain(ghToken);
  });
});
