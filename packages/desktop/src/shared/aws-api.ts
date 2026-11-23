import type { AwsProfileView } from './aws-profiles.js';

export const AWS_IPC = {
  profiles: 'aws:profiles',
  who: 'aws:who',
  ssoLogin: 'aws:sso-login',
  configureSso: 'aws:configure-sso',
} as const;

export const AWS_CLI_INSTALL_URL = 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html';

export interface AwsProfilesView {
  /** aws CLI 경로(없으면 null) */
  readonly cli: string | null;
  readonly profiles: readonly AwsProfileView[];
}

export interface AwsWho {
  readonly account: string;
  readonly who: string;
}

export type AwsResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string; readonly needsLogin?: boolean };

export interface AwsApi {
  profiles(): Promise<AwsProfilesView>;
  /** 이 프로필로 누구인지(aws sts get-caller-identity, 읽기 전용) */
  who(profile: string): Promise<AwsResult<AwsWho>>;
  /** 새 터미널에서 aws sso login --profile */
  ssoLogin(profile: string): Promise<AwsResult<null>>;
  /** 새 터미널에서 aws configure sso */
  configureSso(): Promise<AwsResult<null>>;
}
