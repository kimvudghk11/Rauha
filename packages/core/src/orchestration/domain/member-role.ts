import type { TeamRole } from './team.js';

/** 팀원 역할 전체. 새 역할은 아래 ROLE_INFO 한 곳에 더하면 이름·진행 단계·쓰기 권한이 한꺼번에 정해진다(빠뜨리면 컴파일이 막는다). */
export const MEMBER_ROLES = [
  'intake', 'tester', 'implementer', 'reviewer', 'router', 'answerer', 'surveyor', 'writer', 'designer', 'operator',
  'debugger', 'riskchecker', 'planner', 'chief', 'bm', 'marketer', 'growth', 'uxdesigner', 'brand', 'securitychecker', 'releaser', 'splitter', 'publisher',
  // 큰 회사 부서(2026-11-18): 기획 PM, 재무·회계, 데이터, 법무, 고객 성공, 영업, 인사, 품질 QA
  'pm', 'accountant', 'finops', 'analyst', 'dataengineer', 'legal', 'support', 'voc', 'sales', 'recruiter', 'qa',
  // 개발 자문부(설계·검토·출시 자문, 코드는 작업 흐름이 쓴다)와 마케팅 세분화
  'frontend', 'backend', 'ios', 'android', 'crossplatform', 'content', 'performance', 'pr',
  // 사업 하나를 할 수 있는 회사(2026-11-19): 콘텐츠부(카피·영상), 상품·그래픽 디자인, 상품기획 MD, 커머스부(입점·물류)
  'copywriter', 'video', 'productdesigner', 'graphic', 'md', 'ecommerce', 'logistics',
  // 메인 채팅 기본(2026-11-24): 사용자 말을 그대로 받는 Claude 세션 하나. rauha 는 결과 모양·UI 만 얹는다
  'direct',
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
  // 커밋·push·PR만 한다. 파일은 고치지 않는다(쓰기 권한은 팀장과 같다).
  publisher: info('git 팀원', '커밋·PR'),
  pm: info('PM 팀원', 'PM'),
  accountant: info('회계 팀원', '회계'),
  finops: info('클라우드 비용 팀원', '비용'),
  analyst: info('데이터 분석 팀원', '분석'),
  dataengineer: info('데이터 엔지니어', '데이터'),
  legal: info('법무 팀원', '법무'),
  support: info('고객 지원 팀원', '지원'),
  voc: info('고객 의견 팀원', 'VoC'),
  sales: info('영업 팀원', '영업'),
  recruiter: info('채용·인사 팀원', '인사'),
  qa: info('QA 팀원', 'QA'),
  frontend: info('프론트엔드 전문가', '프론트'),
  backend: info('백엔드 전문가', '백엔드'),
  ios: info('iOS 전문가', 'iOS'),
  android: info('안드로이드 전문가', 'Android'),
  crossplatform: info('크로스플랫폼 앱 전문가', '앱'),
  content: info('콘텐츠 마케팅 팀원', '콘텐츠'),
  performance: info('퍼포먼스 마케팅 팀원', '광고'),
  pr: info('PR·커뮤니티 팀원', 'PR'),
  copywriter: info('카피라이터', '카피'),
  video: info('영상 PD', '영상'),
  productdesigner: info('상품 디자이너', '상품디자인'),
  graphic: info('그래픽 디자이너', '그래픽'),
  md: info('상품기획 MD', 'MD'),
  ecommerce: info('이커머스 운영 팀원', '커머스'),
  logistics: info('물류 팀원', '물류'),
  // 사용자에게는 그냥 Claude 와 하는 대화로 보인다(단계 이름 없음). 파일은 고른 폴더 안에서 가드·허락을 거쳐 쓴다
  direct: info('Claude', null, 'implementer'),
};
