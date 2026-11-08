/**
 * 내 S3 버킷과 이야기하는 좁은 문. 앱 규칙(bug-service)은 이 인터페이스만 알고, 진짜 AWS SDK는 aws-s3.ts 한 곳에만 있다.
 * 시험에서는 가짜 구현을 끼운다(실제 AWS를 부르지 않는다).
 */
export interface S3Port {
  /** 이 프로필로 실제 로그인된 계정 번호(STS GetCallerIdentity) */
  callerAccount(): Promise<string>;
  put(key: string, body: string): Promise<void>;
  /** prefix로 시작하는 키 목록 */
  list(prefix: string): Promise<readonly string[]>;
  get(key: string): Promise<string>;
}

/** 바깥(AWS) 오류를 화면에 보일 한국어 이유로 바꾼 오류 */
export class S3PortError extends Error {}
