import type { TeamRole } from './team.js';

/** 팀원 역할 전체. 새 역할은 아래 ROLE_INFO 한 곳에 더하면 이름·진행 단계·쓰기 권한이 한꺼번에 정해진다(빠뜨리면 컴파일이 막는다). */
export const MEMBER_ROLES = [
  'intake', 'tester', 'implementer', 'reviewer', 'router', 'answerer', 'surveyor', 'writer', 'designer', 'operator',
  'debugger', 'riskchecker', 'planner', 'chief', 'bm', 'marketer', 'growth', 'uxdesigner', 'brand', 'securitychecker', 'releaser', 'splitter',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface RoleInfo {
  /** 사람이 읽는 이름(팀 목록, 허락 화면) */
  readonly name: string;
  /** 진행 줄에 보이는 짧은 단계 이름. 사용자에게 한 가지 일로 보이는 역할(라우터·답변)은 null */
  readonly stage: string | null;
  /** 쓰기 권한(WritePolicy)에서 어느 팀 역할로 볼지. 파일을 쓰지 않는 역할은 모두 팀장(lead)과 같다. */
  readonly writeRole: TeamRole;
  /** 작업 시작 알림에 쓰는 이름 */
  readonly stepName: string;
}

const info = (name: string, stage: string | null, writeRole: TeamRole = 'lead', stepName: string = name): RoleInfo => ({ name, stage, writeRole, stepName });

export const ROLE_INFO: Readonly<Record<MemberRole, RoleInfo>> = {
  intake: info('팀장', '접수', 'lead', '팀장 접수'),
  tester: info('테스트 팀원', '테스트', 'tester'),
  implementer: info('구현 팀원', '구현', 'implementer'),
  reviewer: info('리뷰어', '리뷰', 'reviewer'),
  router: info('라우터', null),
  answerer: info('답변 팀원', null),
  surveyor: info('저장소 파악', '파악'),
  writer: info('문서 팀원', '문서', 'writer'),
  designer: info('설계 팀원', '설계'),
  operator: info('운영 팀원', '운영'),
  debugger: info('디버깅 팀원', '진단'),
  riskchecker: info('위험 점검 팀원', '점검'),
  planner: info('기획 팀원', '기획'),
  chief: info('부서장', '부서장'),
  bm: info('사업 모델 팀원', '사업모델'),
  marketer: info('마케팅 팀원', '마케팅'),
  growth: info('그로스 팀원', '그로스'),
  uxdesigner: info('UX 디자인 팀원', 'UX'),
  brand: info('브랜드 팀원', '브랜드'),
  securitychecker: info('보안 점검 팀원', '보안'),
  releaser: info('릴리스 팀원', '릴리스'),
  splitter: info('저장소 나누기 팀원', '나누기'),
};
