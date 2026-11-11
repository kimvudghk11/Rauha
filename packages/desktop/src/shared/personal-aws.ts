import { AwsTarget, type AwsInput } from './bug-sync.js';

/**
 * 리포트를 올리고 받는 곳은 사용자의 개인 AWS 하나로 고정한다(설정 칸 없음).
 * 회사 노트북은 default 프로필이 회사 계정이라, 프로필은 정해 둔 후보를 차례로 써 보고
 * 실제 로그인된 계정이 이 개인 계정인 첫 프로필만 쓴다(회사 계정으로는 절대 올리지 않는다).
 */
export const PERSONAL_AWS = { account: '841162691623', bucket: 'rauha-notes-841162691623', region: 'ap-northeast-2' } as const;

/** 써 볼 프로필 이름(앞에서부터). 회사 PC 의 default 가 회사 계정이어도 personal 이 먼저 맞으면 그것을 쓴다. */
export const PERSONAL_PROFILE_CANDIDATES: readonly string[] = ['personal', 'rauha-personal', 'default'];

/** 후보 프로필 하나로 만든 올릴 곳 */
export function personalTarget(profile: string): AwsTarget {
  const input: AwsInput = { profile, bucket: PERSONAL_AWS.bucket, region: PERSONAL_AWS.region, account: PERSONAL_AWS.account };
  return AwsTarget.require(input);
}

/** 설정 화면에 보일 안내 한 줄(계정 번호는 끝 4자리만) */
export function personalAwsHint(): string {
  return `Reports go to your personal AWS account (ending ${PERSONAL_AWS.account.slice(-4)}). This computer uses the first profile among ${PERSONAL_PROFILE_CANDIDATES.join(', ')} that signs in to that account; a company account is never used.`;
}
