import { DomainError } from '../../shared/domain-error.js';

export type Confidence = 'high' | 'medium' | 'low';
const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

export interface Fact {
  readonly text: string;
  /** 근거 파일(`경로` 또는 `경로:줄`). 읽은 것만 적는다. */
  readonly evidence: string;
}

export interface Cause {
  readonly text: string;
  readonly confidence: Confidence;
  /** 이 후보가 맞는지 확인하는 방법 */
  readonly check: string;
}

export interface InvestigationInput {
  readonly symptom: string;
  readonly facts: readonly Fact[];
  readonly causes: readonly Cause[];
  readonly unknowns: readonly string[];
}

/** 모노레포 최상위 폴더: 이 아래는 앞 두 칸(`packages/api`)이 한 영역이다 */
const MONOREPO_ROOTS: ReadonlySet<string> = new Set(['packages', 'apps', 'services', 'libs', 'modules']);
const ROOT_AREA = '(루트)';

/** `경로:줄`에서 경로만, 구분자는 `/`로 */
function pathOf(evidence: string): string {
  return evidence.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/:\d+(?:-\d+)?$/, '');
}

function areaOf(path: string): string {
  const parts = path.split('/').filter((p) => p !== '');
  if (parts.length <= 1) return ROOT_AREA;
  if (MONOREPO_ROOTS.has(parts[0]!) && parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

/**
 * 분석 1단계 결과: 증상, 확인한 사실(근거 필수), 원인 후보(확신도·확인 방법), 모르는 것.
 * 근거 없는 사실은 받지 않는다: 추측은 사실이 아니라 원인 후보로 적는다.
 */
export class Investigation {
  private constructor(
    readonly symptom: string,
    readonly facts: readonly Fact[],
    readonly causes: readonly Cause[],
    readonly unknowns: readonly string[],
  ) {}

  static of(input: InvestigationInput): Investigation {
    const symptom = input.symptom.trim();
    if (symptom === '') throw new DomainError('INVALID_INPUT', '증상이 비어 있습니다.');
    const facts = input.facts.map((f) => ({ text: f.text.trim(), evidence: f.evidence.trim() }));
    if (facts.some((f) => f.text === '' || f.evidence === '')) throw new DomainError('FACT_WITHOUT_EVIDENCE', '확인한 사실에는 근거 파일이 있어야 합니다. 추측은 원인 후보에 적으세요.');
    const causes = input.causes.map((c) => ({ text: c.text.trim(), confidence: c.confidence, check: c.check.trim() }));
    const badConfidence = causes.find((c) => !CONFIDENCES.includes(c.confidence));
    if (badConfidence !== undefined) throw new DomainError('INVALID_INPUT', `원인 후보의 확신도는 ${CONFIDENCES.join('·')} 중 하나여야 합니다.`);
    if (causes.some((c) => c.text === '')) throw new DomainError('INVALID_INPUT', '원인 후보가 비어 있습니다.');
    const unknowns = input.unknowns.map((u) => u.trim()).filter((u) => u !== '');
    if (facts.length === 0 && unknowns.length === 0) throw new DomainError('NOTHING_FOUND', '확인한 사실이 없으면 무엇을 모르는지 적어야 합니다.');
    return new Investigation(symptom, facts, causes, unknowns);
  }

  /** 근거 파일 경로(줄 번호 없이, 한 번씩) */
  evidencePaths(): string[] {
    return [...new Set(this.facts.map((f) => pathOf(f.evidence)))];
  }

  /** 짚은 영역들(근거 파일이 속한 곳). 셋 이상이면 큰 변경으로 본다. */
  areas(): string[] {
    return [...new Set(this.evidencePaths().map(areaOf))];
  }
}
