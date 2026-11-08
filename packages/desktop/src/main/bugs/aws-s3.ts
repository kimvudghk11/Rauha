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
  if (name === 'CredentialsProviderError' || name === 'TokenProviderError') return new S3PortError(`프로필 "${profile}"로 로그인할 수 없어요. 터미널에서 aws configure --profile ${profile} 로 등록했는지(SSO면 aws sso login) 확인해 주세요.`);
  if (/Expired|InvalidToken|InvalidClientTokenId|SignatureDoesNotMatch/.test(name)) return new S3PortError('이 프로필의 로그인이 만료되었거나 키가 올바르지 않아요. 터미널에서 다시 로그인해 주세요.');
  if (/AccessDenied|Forbidden/.test(name)) return new S3PortError('이 프로필에 버킷을 읽고 쓸 권한이 없어요.');
  if (name === 'NoSuchBucket') return new S3PortError('버킷을 찾을 수 없어요. 버킷 이름과 리전을 확인해 주세요.');
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(code) || /Timeout|NetworkingError|TimeoutError/.test(name)) return new S3PortError('인터넷에 연결할 수 없어요. 메모는 이 컴퓨터에 그대로 있고, 연결되면 다시 올릴 수 있어요.');
  return new S3PortError('AWS 요청이 실패했어요. 설정(프로필·버킷·리전)을 확인해 주세요.');
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
        if (out.Account === undefined) throw new S3PortError('로그인된 계정을 확인하지 못했어요.');
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
