import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AwsTarget } from '../../shared/bug-sync.js';

describe('AWS 연결 보안(소스 검사)', () => {
  const src = readFileSync(join(__dirname, 'aws-s3.ts'), 'utf8');

  it('저장소 요청(올리기·목록·받기)마다 버킷 주인(ExpectedBucketOwner)을 등록한 개인 계정으로 못 박는다', () => {
    for (const command of ['PutObjectCommand', 'ListObjectsV2Command', 'GetObjectCommand']) {
      const call = new RegExp(`new ${command}\\(\\{[^}]*\\}\\)`).exec(src)?.[0] ?? '';
      expect(call, command).toContain('ExpectedBucketOwner: target.expectedBucketOwner');
    }
  });

  it('프로필은 사용자가 적은 이름으로만 쓰고 default를 대신 넣지 않으며 자격 증명 파일을 직접 열지 않는다', () => {
    expect(src).toContain('fromIni({ profile: target.profile })');
    expect(src).not.toMatch(/['"]default['"]/);
    expect(src).not.toMatch(/readFile|credentials['"/]|accessKeyId|secretAccessKey/);
  });

  it('AwsTarget은 등록한 계정을 버킷 주인으로 내놓는다', () => {
    const r = AwsTarget.from({ profile: 'personal', bucket: 'my-bucket-1', region: 'ap-northeast-2', account: '123456789012' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.target.expectedBucketOwner).toBe('123456789012');
  });
});
