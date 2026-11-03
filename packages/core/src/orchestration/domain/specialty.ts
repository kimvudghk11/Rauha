/** 팀원이 한 업무에서 맡는 전문 분야. 호출을 늘리지 않고, 같은 팀원이 그 분야의 눈으로 일하게 지침만 붙인다. */
export type SpecialtyName = 'frontend' | 'backend' | 'database' | 'architecture' | 'infra';

const NAMES: readonly SpecialtyName[] = ['frontend', 'backend', 'database', 'architecture', 'infra'];
/** 한 업무에 붙이는 분야 수 상한 */
const MAX_SPECIALTIES = 3;

const GUIDE: Readonly<Record<SpecialtyName, { readonly label: string; readonly rules: readonly string[] }>> = {
  frontend: {
    label: '프론트엔드',
    rules: [
      '화면 상태(로딩·빈 목록·오류)를 모두 다룬다. 정상 경로만 만들지 않는다.',
      '접근성(라벨, 키보드 조작, 대체 글)과 사용자가 보는 문구를 이 프로젝트의 기존 컴포넌트·스타일 방식에 맞춘다.',
      '서버가 돌려주는 값의 모양을 믿지 말고 화면에 쓰기 전에 필요한 만큼 확인한다.',
    ],
  },
  backend: {
    label: '백엔드',
    rules: [
      '입력 검증은 바깥 경계(요청을 받는 곳)에서 하고, 규칙은 도메인 코드에 둔다.',
      '오류는 호출한 쪽이 구분할 수 있는 종류로 돌려준다. 삼키거나 모호한 메시지로 덮지 않는다.',
      '같은 요청이 두 번 와도(재시도) 결과가 망가지지 않는지 본다. 돈·재고처럼 겹치면 안 되는 곳은 특히.',
    ],
  },
  database: {
    label: '데이터베이스',
    rules: [
      '스키마 변경은 마이그레이션으로 하고, 가능하면 되돌릴 수 있게(추가 먼저, 삭제는 나중에) 만든다. 기존 데이터를 잃는 변경은 하지 않는다.',
      '조회는 필요한 열만, 반복 조회(N+1)와 전체 스캔이 생기지 않게 인덱스와 쿼리 모양을 본다.',
      '트랜잭션 경계와 동시에 같은 행을 바꾸는 경우를 생각한다.',
    ],
  },
  architecture: {
    label: '설계·아키텍처',
    rules: [
      '이 프로젝트가 이미 쓰는 층·의존 방향·이름 규칙을 따른다. 새 층이나 새 추상화를 만들지 않는다.',
      '모듈 경계를 넘는 변경은 공개된 접점만 건드리고, 안쪽 구현에 직접 기대지 않는다.',
      '지금 요청에 필요한 만큼만 만든다. 나중을 위한 확장 자리는 만들지 않는다.',
    ],
  },
  infra: {
    label: '인프라',
    rules: [
      '실제 클라우드 자원을 만들거나 바꾸는 명령은 직접 실행하지 않는다. 설정 파일과 스크립트를 쓰고, 실행은 사용자가 정한다.',
      '비밀 값(키, 토큰, 비밀번호)을 코드·설정 파일에 쓰지 않는다. 환경 변수나 비밀 저장소 이름으로 가리킨다.',
      '비용이 크게 늘거나 되돌리기 어려운 변경은 안내서의 확인할 것에 남긴다.',
      '프로젝트가 쓰는 IaC 도구(CDK·Terraform·CloudFormation·SAM)를 그대로 쓰고, 쓴 뒤에는 그 도구의 오프라인 검사(cdk synth, terraform validate, sam validate, cfn-lint)를 돌린다.',
      'IAM은 필요한 동작·자원만 허락하고, 저장소는 암호화하고 공개를 막으며, 멈추면 안 되는 것은 가용 영역을 둘 이상 쓴다. 그렇게 못 하면 이유를 남긴다.',
    ],
  },
};

export class Specialty {
  private constructor() {}

  /** 팀장 출력에서 읽은 분야 목록. 모르는 이름과 중복은 버리고 최대 3개까지. */
  static readAll(input: unknown): SpecialtyName[] {
    if (!Array.isArray(input)) return [];
    const known = input.filter((v): v is SpecialtyName => typeof v === 'string' && (NAMES as readonly string[]).includes(v));
    return [...new Set(known)].slice(0, MAX_SPECIALTIES);
  }

  static label(name: SpecialtyName): string {
    return GUIDE[name].label;
  }

  /** 팀원 메시지에 붙일 지침 블록. 분야가 없으면 빈 글. */
  static block(names: readonly SpecialtyName[]): string {
    if (names.length === 0) return '';
    const body = names.map((n) => [`[${GUIDE[n].label}]`, ...GUIDE[n].rules.map((r) => `- ${r}`)].join('\n'));
    return ['<specialty>', '이 업무에서 맡은 전문 분야입니다. 업무 지시서가 먼저이고, 이 지침은 그 안에서 지킬 눈높이입니다.', ...body, '</specialty>'].join('\n');
  }
}
