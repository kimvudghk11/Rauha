import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsTarget } from '../../shared/bug-sync.js';
import { S3PortError, type S3Port } from './s3-port.js';

/**
 * 진짜 AWS 연결. 이 파일만 AWS SDK를 안다.
 * 자격은 SDK의 fromIni({ profile })로만 얻는다: 앱은 AWS 키를 입력받지도, 저장하지도, 읽지도 않는다(~/.aws 파일을 직접 열지 않는다).
 * 프로필 이름은 사용자가 설정에 적은 것만 쓴다(적지 않았다면 AwsTarget이 만들어지지 않으므로 여기까지 오지 않는다).
 * 오류는 이유를 한국어 문구로 바꿔 던진다(AWS가 준 원문에 든 계정·ARN이 화면과 기록에 새지 않게).
 */
const TIMEOUTS = { requestTimeout: 15_000, connectionTimeout: 8_000 };
const LIST_PAGE_LIMIT = 10;

function explain(error: unknown, profile: string): S3PortError {
  const name = error instanceof Error ? error.name : '';
  const code = (error as { code?: string } | null)?.code ?? '';
  if (name === 'CredentialsProviderError' || name === 'TokenProviderError') return new S3PortError(`Cannot sign in with profile "${profile}". Check that you registered it with aws configure --profile ${profile} in a terminal (or aws sso login for SSO).`);
  if (/Expired|InvalidToken|InvalidClientTokenId|SignatureDoesNotMatch/.test(name)) return new S3PortError('This profile sign-in expired or the keys are wrong. Sign in again in a terminal.');
  if (/AccessDenied|Forbidden/.test(name)) return new S3PortError('This profile has no permission to read and write the bucket.');
  if (name === 'NoSuchBucket') return new S3PortError('The bucket was not found. Check the bucket name and region.');
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(code) || /Timeout|NetworkingError|TimeoutError/.test(name)) return new S3PortError('No internet connection. Your notes stay on this computer; upload again once connected.');
  return new S3PortError('The AWS request failed. Check the settings (profile, bucket, region).');
}

export function connectAws(target: AwsTarget): S3Port {
  const credentials = fromIni({ profile: target.profile });
  const s3 = new S3Client({ region: target.region, credentials, maxAttempts: 2, requestHandler: TIMEOUTS });
  const sts = new STSClient({ region: target.region, credentials, maxAttempts: 2, requestHandler: TIMEOUTS });
  const guard = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      throw explain(error, target.profile);
    }
  };
  return {
    callerAccount: () =>
      guard(async () => {
        const out = await sts.send(new GetCallerIdentityCommand({}));
        if (out.Account === undefined) throw new S3PortError('Could not tell which account is signed in.');
        return out.Account;
      }),
    put: (key, body) =>
      guard(async () => {
        await s3.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: body, ContentType: 'application/json; charset=utf-8' }));
      }),
    list: (prefix) =>
      guard(async () => {
        const keys: string[] = [];
        let token: string | undefined;
        for (let page = 0; page < LIST_PAGE_LIMIT; page++) {
          const out = await s3.send(new ListObjectsV2Command({ Bucket: target.bucket, Prefix: prefix, ContinuationToken: token }));
          for (const o of out.Contents ?? []) if (o.Key !== undefined) keys.push(o.Key);
          if (out.IsTruncated !== true) break;
          token = out.NextContinuationToken;
        }
        return keys;
      }),
    get: (key) =>
      guard(async () => {
        const out = await s3.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
        return (await out.Body?.transformToString('utf-8')) ?? '';
      }),
  };
}
