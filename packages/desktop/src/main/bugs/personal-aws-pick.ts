import type { AwsTarget } from '../../shared/bug-sync.js';
import { BugSyncError } from '../../shared/bug-sync.js';
import { PERSONAL_AWS, PERSONAL_PROFILE_CANDIDATES, personalTarget } from '../../shared/personal-aws.js';
import type { S3Port } from './s3-port.js';

/**
 * 후보 프로필을 차례로 열어 실제 계정이 개인 계정인 첫 연결을 찾는다.
 * 로그인이 안 되는 프로필, 다른 계정(회사) 프로필은 건너뛴다. 하나도 없으면 이유와 함께 던진다(아무것도 보내지 않는다).
 * 찾은 프로필은 기억해서 다음에 먼저 써 본다.
 */
export function personalAwsPicker(connect: (target: AwsTarget) => S3Port, candidates: readonly string[] = PERSONAL_PROFILE_CANDIDATES): () => Promise<S3Port> {
  let remembered: string | null = null;
  return async () => {
    const order = remembered === null ? candidates : [remembered, ...candidates.filter((c) => c !== remembered)];
    let otherAccount = false;
    for (const profile of order) {
      const port = connect(personalTarget(profile));
      let account: string;
      try {
        account = await port.callerAccount();
      } catch {
        continue;
      }
      if (account !== PERSONAL_AWS.account) {
        otherAccount = true;
        continue;
      }
      remembered = profile;
      return port;
    }
    remembered = null;
    throw new BugSyncError(
      otherAccount
        ? `No profile on this computer signs in to your personal account (ending ${PERSONAL_AWS.account.slice(-4)}); only other accounts were found, so nothing was sent. Add it in a terminal: aws configure --profile personal`
        : 'No AWS profile on this computer can sign in. Add your personal account in a terminal: aws configure --profile personal',
    );
  };
}

/**
 * 서비스가 쓰는 연결: 처음 부를 때 개인 계정 프로필을 찾아 그 연결로 일한다.
 * 서비스는 이 연결의 계정 번호를 다시 개인 계정과 비교하므로(assertAccount) 두 겹으로 막힌다.
 */
export function personalAwsPort(pick: () => Promise<S3Port>): S3Port {
  let picked: Promise<S3Port> | null = null;
  const port = (): Promise<S3Port> => {
    picked ??= pick().catch((error: unknown) => {
      picked = null;
      throw error;
    });
    return picked;
  };
  return {
    callerAccount: async () => (await port()).callerAccount(),
    put: async (k, body) => (await port()).put(k, body),
    list: async (prefix) => (await port()).list(prefix),
    get: async (k) => (await port()).get(k),
  };
}
