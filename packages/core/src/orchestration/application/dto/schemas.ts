/** 팀원 구조화 출력(Agent SDK outputFormat)용 JSON Schema. DTO의 from()이 같은 모양을 검증한다. */

const str = { type: 'string', minLength: 1 } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const strList = { type: 'array', items: str } as const;

export const INTAKE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'fileCount', 'crossModule', 'sensitive', 'scope', 'acceptance', 'doneWhen', 'forbidden', 'assumptions', 'readFirst', 'specialties'],
  properties: {
    readFirst: {
      ...strList,
      maxItems: 5,
      description: '접수하며 읽은 파일 중 테스트·구현 팀원이 먼저 봐야 할 것(바뀔 코드, 바로 옆 테스트). rauha가 내용을 붙여 넘긴다. 작업 폴더 기준 정확한 경로',
    },
    specialties: {
      type: 'array',
      maxItems: 3,
      items: { enum: ['frontend', 'backend', 'database', 'architecture', 'infra'] },
      description: '이 업무가 걸친 전문 분야. 화면 = frontend, 서버 로직·API = backend, 스키마·쿼리·마이그레이션 = database, 모듈 경계·구조 변경 = architecture, 배포·클라우드 설정 = infra. 해당 없으면 빈 배열',
    },
    title: { ...str, description: '업무 한 줄 목표' },
    fileCount: { type: 'integer', minimum: 1, description: '바뀔 것으로 보이는 파일 수(테스트 포함)' },
    crossModule: { type: 'boolean', description: '모듈 경계를 넘는 변경인지' },
    sensitive: { type: 'boolean', description: '인증·권한·암호화·결제·개인정보가 걸렸는지' },
    scope: { ...strList, minItems: 1, description: '건드려도 되는 경로 패턴(작업 폴더 기준, 예: src/domain/money.ts, src/cart/**)' },
    acceptance: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: { kind: { enum: ['happy', 'error'] }, text: str },
      },
    },
    doneWhen: str,
    forbidden: strList,
    assumptions: {
      type: 'array',
      maxItems: 3,
      description: '요청이 두 가지 이상으로 읽혀 결과가 달라지는 지점. 없으면 빈 배열.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'chosen', 'alternatives', 'needsUser'],
        properties: {
          question: { ...str, description: '무엇이 갈리는지 한 줄' },
          chosen: { ...str, description: '고른 해석. 구체적인 예시 값 포함' },
          alternatives: { ...strList, minItems: 1, maxItems: 3, description: '다른 해석들. 각각 예시 값 포함' },
          needsUser: { type: 'boolean', description: '사용자가 꼭 정해야 하면 true. 틀리면 되돌리기 어렵거나(돈·데이터 삭제·보안·공개 API·DB 구조) 코드베이스 관례로 추천을 못 정할 때만. 나머지는 false' },
        },
      },
    },
  },
};

/**
 * 근거 한 개. 구조화 출력에서 oneOf를 피하려고 모든 칸을 두고, 종류에 안 쓰는 칸은 null.
 * code: path·line·quote(실제 코드 한 줄 그대로), test: name, web: url·quote, user·record: text.
 */
const EVIDENCE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'path', 'line', 'quote', 'name', 'url', 'text'],
  properties: {
    kind: { enum: ['code', 'test', 'web', 'user', 'record'] },
    path: nullableStr,
    line: { type: ['integer', 'null'] },
    quote: nullableStr,
    name: nullableStr,
    url: nullableStr,
    text: nullableStr,
  },
} as const;

const evidenceList = (max: number) => ({ type: 'array', maxItems: max, items: EVIDENCE }) as const;

const reportProperties = {
  result: { enum: ['done', 'failed', 'needs-decision'] },
  did: { ...strList, minItems: 1, maxItems: 3 },
  changedFiles: strList,
  passed: { type: 'integer', minimum: 0 },
  failed: { type: 'integer', minimum: 0 },
  failedTests: strList,
  remaining: nullableStr,
  question: nullableStr,
} as const;

const reportRequired = ['result', 'did', 'changedFiles', 'passed', 'failed', 'failedTests', 'remaining', 'question'];

export const TESTER_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: reportRequired,
  properties: reportProperties,
};

export const IMPLEMENTER_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [...reportRequired, 'explanation'],
  properties: {
    ...reportProperties,
    explanation: {
      type: 'object',
      additionalProperties: false,
      required: ['decisions', 'readingOrder', 'manualChecks', 'untested', 'facts'],
      properties: {
        decisions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['what', 'why', 'rejected', 'evidence'],
            properties: { what: str, why: str, rejected: nullableStr, evidence: evidenceList(4) },
          },
        },
        facts: {
          type: 'array',
          maxItems: 6,
          description: '코드에 넣은 외부 사실(API 경로, 요청·응답 필드, 설정 키, 라이브러리 동작). 없으면 빈 배열.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['claim', 'evidence'],
            properties: { claim: str, evidence: evidenceList(4) },
          },
        },
        readingOrder: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'line', 'note'],
            properties: { path: str, line: { type: ['integer', 'null'], minimum: 1 }, note: str },
          },
        },
        manualChecks: { ...strList, minItems: 1, maxItems: 3 },
        untested: { ...strList, maxItems: 3 },
      },
    },
  },
};

export const REVIEWER_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'issues'],
  properties: {
    verdict: { enum: ['pass', 'changes'] },
    summary: str,
    issues: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['problem', 'path', 'line', 'evidence'],
        properties: { problem: str, path: nullableStr, line: { type: ['integer', 'null'] }, evidence: evidenceList(4) },
      },
    },
  },
};

export const ROUTE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'refersToPast', 'pastQuery', 'department', 'member', 'depth'],
  properties: {
    mode: { enum: ['work', 'question', 'task', 'feature', 'ops', 'debug', 'risk', 'ideate', 'company', 'launch'], description: 'company: 마케팅·사업 모델·디자인·보안·릴리스처럼 회사 부서가 맡는 일(department 필수), launch: 앱·웹을 기획해 오픈하기까지 여러 부서가 이어 쓰는 런칭 계획, ideate: 사업·제품 아이디어를 내거나 무엇을 만들지 구상해 달라는 요청(아직 만들라는 말이 아님), debug: 에러·실패·이상 동작의 원인을 찾아 달라는 요청(고치라는 말이 없음), risk: 바꾸기 전에 영향 범위·깨질 곳·위험을 점검해 달라는 요청, ops: aws·terraform·kubectl 같은 명령으로 클라우드·인프라를 조회하거나 바꾸는 요청(코드 수정 아님), work: 범위가 분명한 작은 코드 수정, feature: 새 기능이나 동작 변경(해석이 갈리거나 여러 파일에 걸침), question: 코드를 바꾸지 않는 질문, task: 코드가 아닌 결과물(문서·보고서·정리 파일)을 만드는 요청' },
    depth: { enum: ['light', 'deep'], description: 'mode가 question일 때만 의미가 있다. light: 파일을 열지 않아도 답할 수 있는 가벼운 질문(산수, 인사, 일반 상식, 짧은 용어 뜻). deep: 이 저장소의 코드·구조·설정을 읽어야 하는 질문. 그 밖의 mode는 deep' },
    refersToPast: { type: 'boolean', description: '이름 없이 지난 작업을 가리키는지("아까 그 기능", "방금 거")' },
    pastQuery: { ...nullableStr, description: '기억에서 찾을 검색어(코드 이름·기능 단어). 없으면 null' },
    department: { enum: ['planning', 'marketing', 'design', 'quality', 'operations', null], description: 'mode가 company일 때 맡을 부서. 그 밖에는 null' },
    member: { enum: ['planner', 'bm', 'marketer', 'growth', 'uxdesigner', 'brand', 'riskchecker', 'securitychecker', 'operator', 'debugger', 'releaser', null], description: 'mode가 company이고 한 팀원이 혼자 할 만한 일이면 그 팀원, 여러 팀원이 필요하거나 넓은 요청이면 null' },
  },
};

export const COMPANY_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['note', 'assignments'],
  properties: {
    note: { ...str, description: '일을 어떻게 나눴는지 한 줄' },
    assignments: {
      type: 'array',
      maxItems: 3,
      items: { type: 'object', additionalProperties: false, required: ['member', 'brief'], properties: { member: str, brief: { ...str, description: '그 팀원이 만들 것과 집중할 점, 필요한 사실. 2~4문장' } } },
    },
  },
};

export const SURVEY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'text', 'sources'],
        properties: { area: str, text: { ...str, maxLength: 300 }, sources: strList },
      },
    },
  },
};

export const WRITER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'files'],
  properties: {
    summary: { ...str, description: '무엇을 어디서 읽어 무엇을 만들었는지, 사용자가 읽을 짧은 보고' },
    files: { ...strList, description: '만들거나 고친 문서 경로' },
  },
};

export const OPS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'commands'],
  properties: {
    answer: { ...str, description: '무엇을 확인하거나 바꿨는지, 이번에 명령이 출력한 것만으로 쓴 보고' },
    commands: { ...strList, description: '이번에 실행한 명령을 실행한 순서대로, 비밀 값은 지운 채' },
  },
};

export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'files'],
  properties: {
    answer: { ...str, description: '이번에 직접 읽거나 실행해 확인한 것만으로 쓴 보고. 확인하지 못한 것은 확인하지 못했다고 쓴다' },
    files: { ...strList, description: '보고의 근거로 이번에 읽은 파일 경로' },
  },
};

export const ANSWER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'claims'],
  properties: {
    answer: str,
    // 인사나 시각처럼 확인할 사실이 없는 답도 있다. 하나 이상을 강제하면 근거를 만들려고 파일·웹을 쓸데없이 연다.
    claims: {
      type: 'array',
      maxItems: 10,
      items: { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: { text: str, evidence: evidenceList(4) } },
    },
  },
};

/** 여러 저장소 요청 나누기. RepoPlanDto.from()이 같은 모양과 계획 규칙을 검증한다. */
export const REPO_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['parts', 'contract', 'edgeCases', 'decisions'],
  properties: {
    parts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['repo', 'request', 'dependsOn'],
        properties: {
          repo: { ...str, description: '<repos>에 있는 저장소 이름 그대로' },
          request: { ...str, description: '이 저장소에서 할 일. 그 저장소의 접수 팀장이 이것만 보고 일할 수 있게 구체적으로' },
          dependsOn: { ...strList, description: '이 저장소보다 먼저 끝나야 하는 저장소(그 저장소가 만든 것을 이 저장소가 쓸 때만)' },
        },
      },
    },
    contract: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'between', 'shape'],
        properties: {
          what: str,
          between: { ...strList, minItems: 2, description: '이 약속을 지켜야 하는 저장소들' },
          shape: { ...str, description: '정확한 모양: 경로·메서드, 필드 이름과 타입, 이벤트 이름' },
        },
      },
    },
    edgeCases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['case', 'handling', 'repo'],
        properties: { case: str, handling: str, repo: { ...str, description: '이 경우를 테스트로 잠글 저장소' } },
      },
    },
    decisions: { ...strList, description: '요청이 두 가지로 읽힐 수 있어 rauha가 정한 것' },
  },
};

/** 약속 검사. ContractCheckDto.from()이 읽는다. */
export const CONTRACT_CHECK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'ok', 'repo', 'fix', 'evidence'],
        properties: {
          what: { ...str, description: '<contract>의 약속 이름 그대로' },
          ok: { type: 'boolean', description: '양쪽 코드가 약속대로인지' },
          repo: { ...nullableStr, description: '어긋났을 때 고칠 저장소. 맞으면 null' },
          fix: { ...nullableStr, description: '어긋났을 때 고칠 점 한두 문장. 맞으면 null' },
          evidence: { ...str, description: '양쪽 코드의 경로:줄과 그 줄을 그대로 옮긴 것' },
        },
      },
    },
  },
};
