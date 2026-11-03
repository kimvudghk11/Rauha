import { DomainError } from '../../../shared/domain-error.js';
import { asRecord, readOptionalString, readString, readStringArray } from '../../../shared/validation.js';
import { Design, type DesignAlternative, type DesignArchitecture, type DesignComponent, type DesignDecision, type DesignEdgeCase, type DesignScenario, type DesignTask } from '../../domain/design.js';

/** 설계 팀원의 한 번의 답: 사용자에게 물을 질문 하나, 또는 승인받을 설계안. */
export type DesignReply =
  | { readonly kind: 'ask'; readonly question: string; readonly suggestion: string | null }
  | { readonly kind: 'draft'; readonly design: Design };

const BY: readonly DesignDecision['by'][] = ['user', 'rauha'];

function list<T>(value: unknown, what: string, read: (item: Record<string, unknown>, at: string) => T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DomainError('INVALID_INPUT', `${what}: 배열이 필요합니다.`);
  return value.map((item, i) => read(asRecord(item, `${what}[${i}]`), `${what}[${i}]`));
}

function architectureOf(value: unknown): DesignArchitecture {
  const a = asRecord(value, '설계.architecture');
  return {
    overview: readString(a, 'overview', '설계.architecture'),
    components: list<DesignComponent>(a['components'], '설계.architecture.components', (c, at) => ({ name: readString(c, 'name', at), responsibility: readString(c, 'responsibility', at), location: readString(c, 'location', at) })),
    flow: readStringArray(a, 'flow', '설계.architecture'),
    alternatives: list<DesignAlternative>(a['alternatives'], '설계.architecture.alternatives', (c, at) => ({ option: readString(c, 'option', at), whyNot: readString(c, 'whyNot', at) })),
  };
}

/** 설계 팀원 출력 → 질문 또는 검증된 설계. 모양이 틀리거나 설계 규칙을 어기면 DomainError. */
export class DesignReplyDto {
  private constructor() {}

  static from(input: unknown): DesignReply {
    const o = asRecord(input, '설계 답');
    if (o['status'] === 'ask') {
      const suggestion = readOptionalString({ s: typeof o['suggestion'] === 'string' && o['suggestion'].trim() === '' ? null : o['suggestion'] }, 's', '설계 답');
      return { kind: 'ask', question: readString(o, 'question', '설계 답'), suggestion };
    }
    if (o['status'] !== 'draft') throw new DomainError('INVALID_INPUT', "설계 답.status: 'ask' 또는 'draft'여야 합니다.");
    const d = asRecord(o['design'], '설계 답.design');
    return {
      kind: 'draft',
      design: Design.of({
        title: readString(d, 'title', '설계'),
        purpose: readString(d, 'purpose', '설계'),
        goals: readStringArray(d, 'goals', '설계'),
        nonGoals: readStringArray(d, 'nonGoals', '설계'),
        scenarios: list<DesignScenario>(d['scenarios'], '설계.scenarios', (s, at) => ({ given: readString(s, 'given', at), when: readString(s, 'when', at), then: readString(s, 'then', at) })),
        decisions: list<DesignDecision>(d['decisions'], '설계.decisions', (s, at) => {
          const by = s['by'];
          if (!BY.includes(by as DesignDecision['by'])) throw new DomainError('INVALID_INPUT', `${at}.by: user 또는 rauha여야 합니다.`);
          return { what: readString(s, 'what', at), by: by as DesignDecision['by'] };
        }),
        tasks: list<DesignTask>(d['tasks'], '설계.tasks', (s, at) => ({
          id: readString(s, 'id', at),
          title: readString(s, 'title', at),
          scope: readStringArray(s, 'scope', at),
          acceptance: readStringArray(s, 'acceptance', at),
          dependsOn: readStringArray(s, 'dependsOn', at),
        })),
        risks: readStringArray(d, 'risks', '설계'),
        architecture: architectureOf(d['architecture']),
        edgeCases: list<DesignEdgeCase>(d['edgeCases'], '설계.edgeCases', (e, at) => ({ case: readString(e, 'case', at), handling: readString(e, 'handling', at), task: readString(e, 'task', at) })),
      }),
    };
  }
}

export interface DesignDocMeta {
  readonly repo: string;
  /** 읽은 기준(`main (a1b2c3d)`). 모르면 null */
  readonly basis: string | null;
  readonly date: string;
  readonly request: string;
}

const scenarioLine = (s: DesignScenario) => `- Given ${s.given}\n  When ${s.when}\n  Then ${s.then}`;
const bullets = (items: readonly string[], empty = '없음') => (items.length === 0 ? [`- ${empty}`] : items.map((i) => `- ${i}`));
const edgeLine = (e: DesignEdgeCase) => `- ${e.case} → ${e.handling} (${e.task})`;
const componentLine = (c: DesignComponent) => `- ${c.name}: ${c.responsibility} (${c.location})`;
const whoDecided = (d: DesignDecision) => `- ${d.what} (${d.by === 'user' ? '사용자가 정함' : 'rauha가 정함'})`;

/** 설계 → 문서, 승인 화면 요약, 작업별 요청. 모델을 부르지 않는다. */
export class DesignDocDto {
  private constructor() {}

  /** 사용자가 읽고 고칠 수 있는 설계 문서(Markdown) */
  static toMarkdown(design: Design, meta: DesignDocMeta): string {
    return [
      `# ${design.title}`,
      '',
      `- 저장소: ${meta.repo}${meta.basis !== null ? ` · 읽은 기준: ${meta.basis}` : ''}`,
      `- 날짜: ${meta.date}`,
      `- 요청: ${meta.request}`,
      '',
      '## 의도와 이유',
      design.purpose,
      '',
      '## 목표',
      ...bullets(design.goals),
      '',
      '## 하지 않을 것',
      ...bullets(design.nonGoals),
      '',
      '## 구조',
      design.architecture.overview,
      '',
      '### 구성 요소',
      ...design.architecture.components.map(componentLine),
      '',
      '### 흐름',
      ...(design.architecture.flow.length === 0 ? ['- 없음'] : design.architecture.flow.map((f, i) => `${i + 1}. ${f}`)),
      '',
      '### 검토하고 버린 안',
      ...(design.architecture.alternatives.length === 0 ? ['- 없음'] : design.architecture.alternatives.map((a) => `- ${a.option}: ${a.whyNot}`)),
      '',
      '## 동작 시나리오',
      ...design.scenarios.map(scenarioLine),
      '',
      '## 엣지 케이스',
      ...design.edgeCases.map(edgeLine),
      '',
      '## 정한 해석',
      ...(design.decisions.length === 0 ? ['- 없음'] : design.decisions.map(whoDecided)),
      '',
      '## 작업 목록',
      ...design.runOrder().flatMap((t, i) => [
        `### ${i + 1}. ${t.title} (${t.id})`,
        `- 범위: ${t.scope.join(', ')}`,
        ...(t.dependsOn.length > 0 ? [`- 의존: ${t.dependsOn.join(', ')}`] : []),
        '- 수용 기준:',
        ...t.acceptance.map((a) => `  - ${a}`),
        '',
      ]),
      '## 위험과 확인하지 못한 것',
      ...bullets(design.risks),
      '',
    ].join('\n');
  }

  /** 승인 화면에 보일 요약 줄들. 전체는 설계 문서에서 본다. */
  static summary(design: Design): string[] {
    const byRauha = design.decidedBy('rauha');
    return [
      `  설계: ${design.title}`,
      `  목적: ${design.purpose}`,
      `  구조: ${design.architecture.overview}`,
      ...(byRauha.length > 0 ? ['  rauha가 정한 것 (다르면 고칠 점으로 말해 주세요)', ...byRauha.map((d) => `    - ${d.what}`)] : []),
      `  엣지 케이스 ${design.edgeCases.length}개 · 작업 ${design.tasks.length}개`,
      ...design.runOrder().map((t, i) => `    ${i + 1}. ${t.title}${t.dependsOn.length > 0 ? `  (앞 작업: ${t.dependsOn.join(', ')})` : ''}`),
    ];
  }

  /**
   * 승인된 설계의 작업 하나 → 최소 루프에 넣을 요청과 접수 팀장에게 넘길 <design> 블록.
   * 접수 팀장은 이 블록을 기준으로 범위와 파일만 확인하고, 설계가 답한 지점은 다시 묻지 않는다.
   */
  static taskRequest(design: Design, task: DesignTask, path: string): { request: string; block: string } {
    const edges = design.edgeCasesOf(task.id);
    const request = [task.title, ...task.acceptance.map((a) => `- ${a}`), ...edges.map((e) => `- 엣지 케이스: ${e.case} → ${e.handling}`)].join('\n');
    const block = [
      `<design title="${design.title}" file="${path}">`,
      '사용자가 승인한 설계입니다. 이 설계가 답하는 지점은 다시 묻지 말고 그대로 따르세요. 설계가 답하지 않는 지점 중 되돌리기 어려운 것(돈, 데이터 삭제, 보안·권한, 공개 API, DB 구조)만 사용자에게 물어도 됩니다.',
      `목적: ${design.purpose}`,
      `구조: ${design.architecture.overview}`,
      ...design.architecture.components.map(componentLine),
      '동작 시나리오:',
      ...design.scenarios.map(scenarioLine),
      '정한 해석:',
      ...(design.decisions.length === 0 ? ['- 없음'] : design.decisions.map(whoDecided)),
      `이번 작업(${task.id}): ${task.title}`,
      `범위: ${task.scope.join(', ')}`,
      '수용 기준:',
      ...task.acceptance.map((a) => `- ${a}`),
      ...(edges.length > 0 ? ['이 작업이 맡은 엣지 케이스(수용 기준과 함께 테스트로 먼저 잠근다):', ...edges.map(edgeLine)] : []),
      '</design>',
    ].join('\n');
    return { request, block };
  }
}
