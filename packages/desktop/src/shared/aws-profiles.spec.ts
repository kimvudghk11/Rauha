import { describe, expect, it } from 'vitest';
import { AwsProfiles, awsNowLine, callerOf } from './aws-profiles.js';

const CONFIG = `[default]
region = ap-northeast-2

[profile company-dev]
sso_session = corp
sso_account_id = 111122223333
sso_role_name = Developer
region = ap-northeast-2

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
sso_region = ap-northeast-2

[profile personal]
region = us-east-1
`;

const CREDENTIALS = `[default]
aws_access_key_id = AKIAEXAMPLE
aws_secret_access_key = SECRET

[old-keys]
aws_access_key_id = AKIA2
aws_secret_access_key = SECRET2
`;

describe('AWS 프로필 목록', () => {
  it('config 와 credentials 의 프로필 이름을 합치고 SSO 여부·리전을 읽는다', () => {
    expect(AwsProfiles.read(CONFIG, CREDENTIALS).list()).toEqual([
      { name: 'default', region: 'ap-northeast-2', sso: false, keys: true },
      { name: 'company-dev', region: 'ap-northeast-2', sso: true, keys: false },
      { name: 'personal', region: 'us-east-1', sso: false, keys: false },
      { name: 'old-keys', region: null, sso: false, keys: true },
    ]);
  });

  it('sso-session 칸은 프로필이 아니다', () => {
    expect(AwsProfiles.read(CONFIG, '').list().map((p) => p.name)).not.toContain('corp');
  });

  it('키 값은 어디에도 담지 않는다', () => {
    expect(JSON.stringify(AwsProfiles.read(CONFIG, CREDENTIALS).list())).not.toMatch(/SECRET|AKIA/);
  });

  it('옛 방식 sso_start_url 만 있는 프로필도 SSO 로 본다', () => {
    expect(AwsProfiles.read('[profile x]\nsso_start_url = https://a.awsapps.com/start\n', '').list()[0]!.sso).toBe(true);
  });

  it('프로필 이름이 안전한지 본다(명령 인자로 넘기므로)', () => {
    const p = AwsProfiles.read(CONFIG, '');
    expect(p.has('company-dev')).toBe(true);
    expect(p.has('nope')).toBe(false);
    expect(p.has('a; rm -rf /')).toBe(false);
  });

  it('파일이 없거나 비어도 빈 목록이다', () => {
    expect(AwsProfiles.read('', '').list()).toEqual([]);
  });
});

describe('팀원에게 붙이는 지금 AWS 상태 한 줄', () => {
  const p = AwsProfiles.read(CONFIG, CREDENTIALS);

  it('AWS_PROFILE 이 가리키는 프로필과 그 리전, 다른 프로필, VPN 을 적는다', () => {
    expect(awsNowLine(p, { AWS_PROFILE: 'company-dev' }, { name: '회사', routes: ['172.31.0.0/16'] })).toBe('profile=company-dev (SSO) · region=ap-northeast-2 · 다른 프로필: default, personal, old-keys · VPN: "회사" 연결됨, 172.31.0.0/16');
  });

  it('AWS_PROFILE 이 없으면 default, AWS_REGION 이 있으면 그 리전', () => {
    expect(awsNowLine(p, { AWS_REGION: 'us-west-2' }, null)).toMatch(/^profile=default \(access keys\) · region=us-west-2 · .* · VPN: 꺼짐$/);
  });

  it('키 값은 담지 않는다', () => {
    expect(awsNowLine(p, {}, null)).not.toMatch(/SECRET|AKIA/);
  });

  it('프로필도 VPN 도 없으면 빈 글(붙이지 않는다)', () => {
    expect(awsNowLine(AwsProfiles.read('', ''), {}, null)).toBe('');
  });
});

describe('sts get-caller-identity 결과', () => {
  it('계정 번호와 역할 이름을 읽는다', () => {
    expect(callerOf('{"UserId":"AROA:me@corp.com","Account":"111122223333","Arn":"arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_Developer_abc/me@corp.com"}')).toEqual({ account: '111122223333', who: 'AWSReservedSSO_Developer_abc/me@corp.com' });
  });

  it('IAM 사용자면 사용자 이름이다', () => {
    expect(callerOf('{"Account":"1","Arn":"arn:aws:iam::1:user/kim"}')).toEqual({ account: '1', who: 'kim' });
  });

  it('읽을 수 없으면 null', () => {
    expect(callerOf('oops')).toBeNull();
  });
});
