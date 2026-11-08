/** 분석 단계별 구조화 출력(Agent SDK outputFormat)용 JSON Schema. DTO의 from()이 같은 모양을 검증한다. */

const str = { type: 'string', minLength: 1 } as const;
const strList = { type: 'array', items: str } as const;

export const INVESTIGATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['symptom', 'facts', 'causes', 'unknowns'],
  properties: {
    symptom: { ...str, description: '사용자가 겪는 증상을 한두 문장으로' },
    facts: {
      type: 'array',
      description: '이번에 직접 읽거나 실행해 확인한 사실만. 추측은 넣지 않는다',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidence'],
        properties: { text: str, evidence: { ...str, description: '근거 파일. 경로나 경로:줄 (이번에 연 파일)' } },
      },
    },
    causes: {
      type: 'array',
      description: '원인 후보. 가능성이 높은 것부터',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'confidence', 'check'],
        properties: { text: str, confidence: { enum: ['high', 'medium', 'low'] }, check: { ...str, description: '이 후보가 맞는지 확인하는 방법' } },
      },
    },
    unknowns: { ...{ type: 'array', items: str }, description: '확인하지 못했거나 알 수 없는 것' },
  },
};

export const DIRECTIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['options', 'recommendedId', 'recommendedReason'],
  properties: {
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      description: '고치는 방향 2~4개. 서로 정말 다른 접근이어야 한다',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'summary', 'pros', 'cons', 'risk', 'reversibility', 'touches'],
        properties: {
          id: { ...str, description: 'a, b, c처럼 짧은 번호' },
          title: str,
          summary: { ...str, description: '무엇을 어떻게 바꾸는지 두세 문장' },
          pros: strList,
          cons: strList,
          risk: { ...str, description: '이 방향에서 깨질 수 있는 것' },
          reversibility: { enum: ['easy', 'medium', 'hard'], description: '나중에 되돌리기 쉬운 정도' },
          touches: { ...strList, description: '손댈 파일이나 영역' },
        },
      },
    },
    recommendedId: { ...str, description: 'options 중 AI가 추천하는 방향의 id 하나' },
    recommendedReason: { ...str, description: '왜 그 방향을 추천하는지 한두 문장' },
  },
};

export const BLUEPRINT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'nonGoals', 'changes', 'flow', 'edgeCases', 'rejected', 'testStrategy', 'steps', 'risks'],
  properties: {
    goal: { ...str, description: '고른 방향으로 이루려는 것' },
    nonGoals: { ...{ type: 'array', items: str }, description: '이번에 하지 않을 것' },
    changes: {
      type: 'array',
      description: '바뀌는 지점: 어디를 어떻게',
      items: { type: 'object', additionalProperties: false, required: ['where', 'what'], properties: { where: { ...str, description: '파일이나 영역' }, what: str } },
    },
    flow: { ...{ type: 'array', items: str }, description: '데이터가 흐르는 순서' },
    edgeCases: { ...{ type: 'array', items: str }, description: '빈 값, 경계값, 동시 요청, 실패 같은 엣지 케이스와 기대 결과' },
    rejected: {
      type: 'array',
      description: '버린 안과 이유(방향 비교에서 고르지 않은 것 포함)',
      items: { type: 'object', additionalProperties: false, required: ['option', 'whyNot'], properties: { option: str, whyNot: str } },
    },
    testStrategy: { ...str, description: '어떤 테스트로 무엇을 잠그는지' },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      description: '작은 단계. 한 단계는 한 가지 동작',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'testFirst', 'files', 'verify'],
        properties: {
          title: str,
          testFirst: { ...str, description: '먼저 쓸 실패하는 테스트(무엇을 확인하는지)' },
          files: { ...strList, description: '이 단계에서 바꿀 파일' },
          verify: { ...str, description: '끝났는지 확인하는 명령' },
        },
      },
    },
    risks: { ...{ type: 'array', items: str }, description: '확인하지 못했거나 잘못될 수 있는 것' },
  },
};
