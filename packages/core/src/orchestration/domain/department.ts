/** 회사의 부서. 개발부(접수·테스트·구현·리뷰)는 작업 흐름이 따로 있어 여기에 없다. */
export type DepartmentId = 'planning' | 'engineering' | 'marketing' | 'design' | 'quality' | 'operations' | 'finance' | 'data' | 'legal' | 'customer' | 'sales' | 'people';
/** 부서에 속한 팀원 역할 이름(바깥 설정 타입에 기대지 않으려고 여기서 따로 적는다) */
export type DepartmentMemberRole =
  | 'planner' | 'bm' | 'pm' | 'marketer' | 'growth' | 'uxdesigner' | 'brand' | 'riskchecker' | 'securitychecker' | 'qa' | 'operator' | 'debugger' | 'releaser'
  | 'accountant' | 'finops' | 'analyst' | 'dataengineer' | 'legal' | 'support' | 'voc' | 'sales' | 'recruiter'
  | 'frontend' | 'backend' | 'ios' | 'android' | 'crossplatform' | 'content' | 'performance' | 'pr';

export interface DepartmentMember {
  readonly role: DepartmentMemberRole;
  readonly label: string;
  /** 부서장·라우터가 팀원을 고를 때 보는 한 줄 설명 */
  readonly does: string;
}

const LEAD = 'a department head at lead level: 10+ years of hands-on work in this field, 5+ years leading teams, and current, top-level knowledge of every specialty under you. You decide what matters, split the work into the few pieces that really need separate people, push back on weak or generic work, and never pad.';

const DEPARTMENTS: Readonly<Record<DepartmentId, { readonly label: string; readonly persona: string; readonly members: readonly DepartmentMember[] }>> = {
  planning: {
    label: '기획·전략부',
    persona: `You head the Planning & Strategy department, ${LEAD} Your field is product and business strategy: finding the real problem, who pays and why, how a small team wins against bigger ones.`,
    members: [
      { role: 'planner', label: '기획 팀원', does: '사업·제품 아이디어, 앱과 웹의 역할 분담, 알맞은 아키텍처·패턴 제안' },
      { role: 'bm', label: '사업 모델 팀원', does: '수익 모델(BM), 가격 정책·실험, 단위 경제(CAC·LTV·마진), 12~36개월 매출·비용 예측, 시장 규모(TAM/SAM/SOM), 경쟁 분석, 투자 자료' },
      { role: 'pm', label: 'PM 팀원', does: '문제 정의, PRD, 사용자 스토리와 수용 기준, 우선순위(RICE), 로드맵, 성공 지표, 무엇을 먼저 만들지' },
    ],
  },
  engineering: {
    label: '개발 자문부',
    persona: `You head the Engineering Advisory department, ${LEAD} Your field is how the product is built on every platform: web frontend, backend and APIs, iOS, Android and cross-platform apps, their architecture, performance, security, release pipelines and store submission. Code changes themselves go through rauha's TDD work flow; your department designs, reviews and advises.`,
    members: [
      { role: 'frontend', label: '프론트엔드 전문가', does: '웹 프론트엔드(React·Next.js·Vue) 구조, 상태 관리, 성능(Core Web Vitals), 접근성, SEO 렌더링, 디자인 시스템' },
      { role: 'backend', label: '백엔드 전문가', does: '서버·API 설계(REST·GraphQL·gRPC), DB·트랜잭션·캐시·큐, 인증, 확장성, 장애 대비' },
      { role: 'ios', label: 'iOS 전문가', does: 'Swift·SwiftUI·UIKit 구조, 앱 수명 주기, 푸시·인앱결제(StoreKit), 앱스토어 심사·배포(TestFlight·Xcode Cloud)' },
      { role: 'android', label: '안드로이드 전문가', does: 'Kotlin·Jetpack Compose 구조, 수명 주기·백그라운드 작업, 푸시(FCM)·인앱결제(Play Billing), 플레이 정책·배포' },
      { role: 'crossplatform', label: '크로스플랫폼 앱 전문가', does: 'Flutter·React Native·Expo 선택과 구조, 네이티브 모듈, 앱·웹 코드 공유, 빌드·배포(EAS·Fastlane)' },
    ],
  },
  marketing: {
    label: '마케팅·그로스부',
    persona: `You head the Marketing & Growth department, ${LEAD} Your field is getting the first users and keeping them: positioning, channels, ad copy, store listings, funnels and experiments.`,
    members: [
      { role: 'marketer', label: '마케팅 팀원', does: '포지셔닝, 광고 문구와 캠페인 계획, 스토어 설명, 랜딩 페이지 카피, 이메일·SNS 글' },
      { role: 'growth', label: '그로스 팀원', does: '지표 설계, 가입·유지 개선 실험, 스토어 검색 최적화(ASO), SEO' },
      { role: 'content', label: '콘텐츠 마케팅 팀원', does: '블로그·SNS(인스타·유튜브·X·스레드) 콘텐츠 계획과 글, 콘텐츠 캘린더, 뉴스레터' },
      { role: 'performance', label: '퍼포먼스 마케팅 팀원', does: '메타·구글·애플 검색 광고 구조, 타깃·소재·예산 배분, ROAS·CPA, 전환 추적(픽셀·SKAN·MMP)' },
      { role: 'pr', label: 'PR·커뮤니티 팀원', does: '보도자료, 런칭 공지(프로덕트헌트 등), 커뮤니티 운영, 위기 대응 문구' },
    ],
  },
  design: {
    label: '디자인부',
    persona: `You head the Design department, ${LEAD} Your field is product and brand design for apps and web: user flows, screens, consistency between app and web, and a brand that fits the business.`,
    members: [
      { role: 'uxdesigner', label: 'UX 디자인 팀원', does: '사용자 흐름, 화면 구성 명세, 앱·웹 일관성, 접근성' },
      { role: 'brand', label: '브랜드 팀원', does: '이름 후보, 톤앤매너, 색·글꼴 방향, 한 줄 소개' },
    ],
  },
  quality: {
    label: '품질·보안부',
    persona: `You head the Quality & Security department, ${LEAD} Your field is what can go wrong before and after release: regressions, security holes, data and privacy exposure, and what to test first. You know application and cloud security (OWASP, auth, supply chain) and test strategy at staff-engineer level.`,
    members: [
      { role: 'riskchecker', label: '위험 점검 팀원', does: '변경의 영향 범위, 깨질 곳, 테스트 빈틈' },
      { role: 'securitychecker', label: '보안 점검 팀원', does: '인증·권한·입력 검증·비밀 값·의존성 취약점·개인정보 점검' },
      { role: 'qa', label: 'QA 팀원', does: '테스트 계획, 회귀 체크리스트, E2E 시나리오, 자동화할 것, 출시 판단 기준' },
    ],
  },
  operations: {
    label: '운영·유지보수부',
    persona: `You head the Operations & Maintenance department, ${LEAD} Your field is running the product after launch: deploys, incidents, cost, monitoring, releases and keeping users informed. You know DevOps, SRE and cloud infrastructure in depth (AWS, Terraform, Kubernetes, CI/CD, observability, backups, least-privilege access).`,
    members: [
      { role: 'operator', label: '운영 팀원', does: 'aws·terraform·kubectl 같은 명령으로 인프라 조회·변경' },
      { role: 'debugger', label: '디버깅 팀원', does: '에러·실패·이상 동작의 원인 분석' },
      { role: 'releaser', label: '릴리스 팀원', does: '릴리스 노트, 변경 공지, 장애 대응 절차와 사후 정리' },
    ],
  },
  finance: {
    label: '재무·회계부',
    persona: `You head the Finance & Accounting department, ${LEAD} Your field is money: bookkeeping and expense handling (비용처리), budgets and forecasts, runway, and what the cloud infrastructure really costs and how to cut it.`,
    members: [
      { role: 'accountant', label: '회계 팀원', does: '비용처리·계정 분류·증빙, 부가세, 예산 대비 실적, 월 결산 요약' },
      { role: 'finops', label: '클라우드 비용 팀원', does: 'AWS 비용 조회(aws ce)·서비스별·리소스별 계산, 예측, 절감안, IaC 로 비용 추정' },
    ],
  },
  data: {
    label: '데이터부',
    persona: `You head the Data & Analytics department, ${LEAD} Your field is turning data into decisions: metrics, analysis, tracking, pipelines and data quality.`,
    members: [
      { role: 'analyst', label: '데이터 분석 팀원', does: '지표 정의, SQL 분석(연결된 DB 로 직접), 퍼널·코호트, 대시보드 설계, 이벤트 추적 계획' },
      { role: 'dataengineer', label: '데이터 엔지니어', does: '스키마·파이프라인·ETL 설계, 데이터 품질, 개인정보 마스킹, 데이터 비용' },
    ],
  },
  legal: {
    label: '법무·컴플라이언스부',
    persona: `You head the Legal & Compliance department, ${LEAD} Your field is keeping the product lawful: terms, privacy, consent, open-source licences and data protection. You always say that a lawyer should review before anything is published.`,
    members: [{ role: 'legal', label: '법무 팀원', does: '이용약관·개인정보처리방침 초안, 개인정보보호법·GDPR 점검, 오픈소스 라이선스 의무' }],
  },
  customer: {
    label: '고객 성공부',
    persona: `You head the Customer Success department, ${LEAD} Your field is users succeeding with the product: support, help content, complaints, and turning feedback into improvements.`,
    members: [
      { role: 'support', label: '고객 지원 팀원', does: '문의·불만 답변, 도움말·FAQ, 답변 템플릿, 에스컬레이션 기준' },
      { role: 'voc', label: '고객 의견 팀원', does: '리뷰·문의·피드백을 주제로 묶고 개수와 영향으로 개선 우선순위' },
    ],
  },
  sales: {
    label: '영업·사업개발부',
    persona: `You head the Sales & Business Development department, ${LEAD} Your field is winning customers and partners for a software product, especially B2B.`,
    members: [{ role: 'sales', label: '영업 팀원', does: 'B2B 제안서, 아웃리치 메일, 피치 구성, 가격 제안, 반론 대응, 파트너십' }],
  },
  people: {
    label: '인사·조직부',
    persona: `You head the People & Organization department, ${LEAD} Your field is building the team: hiring, interviews, onboarding and how the organisation grows.`,
    members: [{ role: 'recruiter', label: '채용·인사 팀원', does: '채용 공고(JD), 면접 질문과 평가 기준, 온보딩 30/60/90, 조직 설계' }],
  },
};

const IDS = Object.keys(DEPARTMENTS) as DepartmentId[];

/** 런칭 계획에서 부서장이 한 번씩 쓰는 순서. 앞 부서의 글이 뒤 부서의 입력이 된다. */
export const LAUNCH_ORDER: readonly DepartmentId[] = ['planning', 'engineering', 'design', 'marketing', 'legal', 'quality', 'operations', 'finance'];
/** 회사 장부·목록에 보이는 부서 순서 */
export const DEPARTMENT_ORDER: readonly DepartmentId[] = ['planning', 'engineering', 'design', 'marketing', 'sales', 'customer', 'data', 'legal', 'quality', 'operations', 'finance', 'people'];

export class Department {
  private constructor(readonly id: DepartmentId) {}

  static of(id: DepartmentId): Department {
    return new Department(id);
  }

  static named(name: unknown): Department | null {
    return typeof name === 'string' && IDS.includes(name as DepartmentId) ? new Department(name as DepartmentId) : null;
  }

  static all(): readonly Department[] {
    return IDS.map((id) => new Department(id));
  }

  static ofMember(role: string): Department | null {
    return Department.all().find((d) => d.hasMember(role)) ?? null;
  }

  get label(): string {
    return DEPARTMENTS[this.id].label;
  }

  get persona(): string {
    return DEPARTMENTS[this.id].persona;
  }

  get members(): readonly DepartmentMember[] {
    return DEPARTMENTS[this.id].members;
  }

  hasMember(role: string): boolean {
    return this.members.some((m) => m.role === role);
  }

  member(role: string): DepartmentMember | null {
    return this.members.find((m) => m.role === role) ?? null;
  }
}
