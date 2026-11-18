/** 회사의 부서. 개발부(접수·테스트·구현·리뷰)는 작업 흐름이 따로 있어 여기에 없다. */
export type DepartmentId = 'planning' | 'marketing' | 'design' | 'quality' | 'operations';
/** 부서에 속한 팀원 역할 이름(바깥 설정 타입에 기대지 않으려고 여기서 따로 적는다) */
export type DepartmentMemberRole = 'planner' | 'bm' | 'marketer' | 'growth' | 'uxdesigner' | 'brand' | 'riskchecker' | 'securitychecker' | 'operator' | 'debugger' | 'releaser';

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
      { role: 'bm', label: '사업 모델 팀원', does: '수익 모델(BM), 가격, 단위 경제, 시장 규모 근거, 린 캔버스' },
    ],
  },
  marketing: {
    label: '마케팅·그로스부',
    persona: `You head the Marketing & Growth department, ${LEAD} Your field is getting the first users and keeping them: positioning, channels, ad copy, store listings, funnels and experiments.`,
    members: [
      { role: 'marketer', label: '마케팅 팀원', does: '포지셔닝, 광고 문구와 캠페인 계획, 스토어 설명, 랜딩 페이지 카피, 이메일·SNS 글' },
      { role: 'growth', label: '그로스 팀원', does: '지표 설계, 가입·유지 개선 실험, 스토어 검색 최적화(ASO), SEO' },
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
};

const IDS = Object.keys(DEPARTMENTS) as DepartmentId[];

/** 런칭 계획에서 부서장이 한 번씩 쓰는 순서. 앞 부서의 글이 뒤 부서의 입력이 된다. */
export const LAUNCH_ORDER: readonly DepartmentId[] = ['planning', 'design', 'marketing', 'quality', 'operations'];

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
