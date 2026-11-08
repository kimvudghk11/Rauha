import { describe, expect, it } from 'vitest';
import { BlogRedactor, snippetAllowed, usableRepoNames, type RedactContext } from './blog-redact.js';

const ctx: RedactContext = {
  repoNames: ['bridge-backend', 'zzenddo-plugin'],
  companyNames: ['Acme Corp', '브릿지페이'],
  userName: 'kimbo',
  homePath: 'C:\\Users\\kimbo',
};

const redact = (text: string, keep: readonly string[] = []) => BlogRedactor.create(ctx, keep).apply(text);

describe('공개용 가림', () => {
  it('회사 이름과 레포 이름을 일반 이름으로 바꾼다', () => {
    const r = redact('Acme Corp의 bridge-backend 에서 브릿지페이 결제가 실패했어요');
    expect(r.text).not.toMatch(/Acme|bridge-backend|브릿지페이/);
    expect(r.text).toContain('서비스 A');
    expect(r.text).toContain('레포 A');
  });

  it('같은 이름은 같은 일반 이름으로, 다른 이름은 다른 글자로 바꾼다', () => {
    const r = redact('Acme Corp 그리고 브릿지페이 그리고 Acme Corp');
    expect(r.text).toBe('서비스 A 그리고 서비스 B 그리고 서비스 A');
  });

  it('이름은 대소문자를 가리지 않고 한국어 조사가 붙어도 바꾼다', () => {
    expect(redact('ACME CORP는 느렸고 acme corp에서도').text).not.toMatch(/acme/i);
  });

  it('다른 낱말 안에 든 이름은 건드리지 않는다', () => {
    const r = BlogRedactor.create({ ...ctx, repoNames: ['api-gw'] }, []).apply('rapi-gwx 는 그대로');
    expect(r.text).toBe('rapi-gwx 는 그대로');
  });

  it('도메인과 주소(URL)를 가린다', () => {
    const r = redact('https://pay.acme-internal.co.kr/v1/charge 와 db.prod.internal 에 접속');
    expect(r.text).not.toMatch(/acme-internal|prod\.internal|pay\./);
    expect(r.text).toMatch(/도메인 A/);
  });

  it('IPv4 주소와 CIDR를 가린다', () => {
    const r = redact('서버 10.20.30.40 과 172.16.0.0/16 대역, 버전 1.2.3 은 그대로');
    expect(r.text).not.toMatch(/10\.20\.30\.40|172\.16\.0\.0/);
    expect(r.text).toContain('버전 1.2.3');
  });

  it('IPv6 주소를 가린다', () => {
    expect(redact('주소 2001:db8:85a3::8a2e:370:7334 로').text).not.toMatch(/2001:db8/);
  });

  it('12자리 계정 번호를 가린다', () => {
    const r = redact('계정 123456789012 에서 실행');
    expect(r.text).not.toContain('123456789012');
    expect(r.text).toContain('계정 번호');
  });

  it('ARN은 통째로 가린다(계정 번호와 리전도 함께 사라진다)', () => {
    const r = redact('arn:aws:iam::123456789012:role/payment-admin-role 을 맡아서');
    expect(r.text).not.toMatch(/123456789012|payment-admin/);
    expect(r.text).toContain('ARN');
  });

  it('리전을 가린다', () => {
    const r = redact('ap-northeast-2 와 us-east-1 에 배포');
    expect(r.text).not.toMatch(/ap-northeast-2|us-east-1/);
    expect(r.text).toContain('리전');
  });

  it('토큰과 키를 가린다', () => {
    const secrets = ['AKIAIOSFODNN7EXAMPLE', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'sk-abcdefghijklmnopqrstuvwxyz', 'Bearer abcdef0123456789abcdef', 'password=hunter2hunter2'];
    for (const s of secrets) {
      const r = redact(`값은 ${s} 입니다`);
      expect(r.text, s).not.toContain(s.replace(/^password=/, ''));
    }
  });

  it('이메일을 가린다', () => {
    const r = redact('담당자 kim.bo@acme-mail.com 에게');
    expect(r.text).not.toMatch(/kim\.bo|acme-mail/);
    expect(r.text).toContain('이메일');
  });

  it('홈 경로와 사용자 이름을 가린다', () => {
    const r = redact('C:\\Users\\kimbo\\work\\x.ts 와 /Users/kimbo/app 와 /home/other/z 그리고 kimbo 님');
    expect(r.text).not.toMatch(/kimbo|other/);
    expect(r.text).toContain('~');
  });

  it('달러 금액을 가린다', () => {
    const r = redact('한 달 $1,234.50 와 300달러 와 12 USD');
    expect(r.text).not.toMatch(/1,234|300달러|12 USD/);
  });

  it('비밀 파일 이름과 경로는 글에 남기지 않는다', () => {
    const r = redact('config/.env.production 과 deploy/key.pem 과 .env.example 을 열어서');
    expect(r.text).not.toMatch(/\.env\.production|key\.pem/);
    expect(r.text).toContain('.env.example');
    expect(r.text).toContain('비밀 파일');
  });

  it('바뀐 목록에 원래 값과 바뀐 값과 횟수가 들어 있다', () => {
    const r = redact('Acme Corp 와 Acme Corp');
    expect(r.changes).toEqual([{ kind: 'company', original: 'Acme Corp', replacement: '서비스 A', count: 2, revertible: true, kept: false }]);
  });

  it('토큰과 키는 되돌릴 수 없다', () => {
    const r = redact('AKIAIOSFODNN7EXAMPLE');
    expect(r.changes[0]?.revertible).toBe(false);
    const again = redact('AKIAIOSFODNN7EXAMPLE', ['AKIAIOSFODNN7EXAMPLE']);
    expect(again.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('항목을 되돌리면 그 원래 값만 남고 나머지는 계속 가려진다', () => {
    const r = redact('Acme Corp 의 10.0.0.1', ['Acme Corp']);
    expect(r.text).toContain('Acme Corp');
    expect(r.text).not.toContain('10.0.0.1');
    expect(r.changes.find((c) => c.original === 'Acme Corp')).toMatchObject({ replacement: '서비스 A', kept: true });
  });

  it('여러 글을 거쳐도 같은 이름은 같은 일반 이름이다', () => {
    const red = BlogRedactor.create(ctx, []);
    expect(red.apply('브릿지페이').text).toBe('서비스 A');
    expect(red.apply('Acme Corp').text).toBe('서비스 B');
    expect(red.apply('브릿지페이').text).toBe('서비스 A');
    expect(red.changes().map((c) => c.original)).toEqual(['브릿지페이', 'Acme Corp']);
  });

  it('두 번 거쳐도 결과가 같다', () => {
    const once = redact('Acme Corp bridge-backend 10.1.2.3 foo@bar.com ap-northeast-2').text;
    expect(redact(once).text).toBe(once);
  });

  it('여러 종류가 섞인 글에서 아무것도 새지 않는다', () => {
    const raw = [
      'Acme Corp 결제 서버(bridge-backend)가 10.20.30.40 에서 ap-northeast-2 로 나갈 때',
      'arn:aws:s3:::acme-prod-bucket 접근이 막혀 accounts 987654321098 의 role 로 바꿨고,',
      'admin@acme.com 에게 알렸으며 키는 AKIAIOSFODNN7EXAMPLE 였다. pay.acme.com 에 월 $500 들었다.',
    ].join('\n');
    const out = redact(raw).text;
    for (const leak of ['Acme', 'acme', 'bridge-backend', '10.20.30.40', 'ap-northeast-2', '987654321098', 'AKIAIOSFODNN7EXAMPLE', 'admin@', '$500']) {
      expect(out, leak).not.toContain(leak);
    }
  });

  it('흔한 낱말인 폴더 이름(app 등)은 가림 이름 목록에서 뺀다', () => {
    expect(usableRepoNames(['app', 'src', 'ab', 'bridge-backend'])).toEqual(['bridge-backend']);
  });
});

describe('코드 조각', () => {
  it('비밀 파일 이름이 들어 있거나 환경 변수 모양이면 넣을 수 없다', () => {
    expect(snippetAllowed('# .env\nDB_HOST=a\nDB_PASS=b')).toBe(false);
    expect(snippetAllowed('DB_HOST=a\nDB_PASS=b\nAPI_URL=c')).toBe(false);
    expect(snippetAllowed('cat ~/.aws/credentials')).toBe(false);
  });

  it('보통 코드는 넣을 수 있다', () => {
    expect(snippetAllowed('const x = 1;\nretry(3);')).toBe(true);
  });
});
