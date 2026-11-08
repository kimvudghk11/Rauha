import { DomainError } from '../../../shared/domain-error.js';
import { asRecord, readString, readStringArray } from '../../../shared/validation.js';
import { Blueprint, type BlueprintInput } from '../../domain/blueprint.js';
import { DirectionSet, type DirectionChoice, type DirectionOptionInput, type Reversibility } from '../../domain/direction.js';
import { Investigation, type Confidence, type InvestigationInput } from '../../domain/investigation.js';

const HIDDEN = '[값 가림]';

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, HIDDEN],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, HIDDEN],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, HIDDEN],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, HIDDEN],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, HIDDEN],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, HIDDEN],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${HIDDEN}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${HIDDEN}@`],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/gi, `$1$2${HIDDEN}`],
  // 섞인 글자로 길게 이어진 값(키·해시 비슷한 것). 순수 16진수(git 커밋 번호 등)는 비밀이 아니라서 남긴다.
  [/\b(?![0-9a-f]{40,64}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, HIDDEN],
];

/** 저장소에 남는 분석 문서에 비밀이 섞이지 않게 흔한 비밀 모양을 가린다. 몇 번 거쳐도 결과가 같다. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

const records = (value: unknown, what: string): Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new DomainError('INVALID_INPUT', `${what}: 배열이 필요합니다.`);
  return value.map((v) => asRecord(v, what));
};

const bullets = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');

const bulletsOrNone = (items: readonly string[]): string => (items.length === 0 ? '- 없음' : bullets(items));

const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = { high: '높음', medium: '중간', low: '낮음' };
const REVERSIBILITY_LABEL: Readonly<Record<Reversibility, string>> = { easy: '쉬움', medium: '보통', hard: '어려움' };

/** 분석 1단계 팀원 출력 ↔ 조사 결과 */
export class InvestigationDto {
  private constructor(private readonly input: InvestigationInput) {}

  static from(output: unknown): InvestigationDto {
    const o = asRecord(output, '조사 보고');
    return new InvestigationDto({
      symptom: readString(o, 'symptom', '조사 보고'),
      facts: records(o['facts'], '조사 보고.facts').map((f) => ({ text: readString(f, 'text', 'facts'), evidence: readString(f, 'evidence', 'facts') })),
      causes: records(o['causes'], '조사 보고.causes').map((c) => ({ text: readString(c, 'text', 'causes'), confidence: readString(c, 'confidence', 'causes') as Confidence, check: readString(c, 'check', 'causes') })),
      unknowns: readStringArray(o, 'unknowns', '조사 보고'),
    });
  }

  toEntity(): Investigation {
    return Investigation.of(this.input);
  }

  static toMarkdown(inv: Investigation): string {
    const parts = [`**증상**: ${inv.symptom}`];
    parts.push('### 확인한 사실', inv.facts.length === 0 ? '- 확인한 사실이 없어요.' : bullets(inv.facts.map((f) => `${f.text} (근거: \`${f.evidence}\`)`)));
    if (inv.causes.length > 0) parts.push('### 원인 후보', bullets(inv.causes.map((c) => `${c.text} — 확신도 ${CONFIDENCE_LABEL[c.confidence]}, 확인 방법: ${c.check}`)));
    if (inv.unknowns.length > 0) parts.push('### 아직 모르는 것', bullets(inv.unknowns));
    return parts.join('\n\n');
  }
}

/** 분석 2단계 팀원 출력 ↔ 방향 비교 */
export class DirectionsDto {
  private constructor(
    private readonly options: DirectionOptionInput[],
    private readonly recommendedId: string,
    private readonly recommendedReason: string,
  ) {}

  static from(output: unknown): DirectionsDto {
    const o = asRecord(output, '방향 비교');
    const options = records(o['options'], '방향 비교.options').map(
      (d): DirectionOptionInput => ({
        id: readString(d, 'id', 'options'),
        title: readString(d, 'title', 'options'),
        summary: readString(d, 'summary', 'options'),
        pros: readStringArray(d, 'pros', 'options'),
        cons: readStringArray(d, 'cons', 'options'),
        risk: readString(d, 'risk', 'options'),
        reversibility: readString(d, 'reversibility', 'options') as Reversibility,
        touches: readStringArray(d, 'touches', 'options'),
      }),
    );
    return new DirectionsDto(options, readString(o, 'recommendedId', '방향 비교'), readString(o, 'recommendedReason', '방향 비교'));
  }

  toEntity(): DirectionSet {
    return DirectionSet.of(this.options, this.recommendedId, this.recommendedReason);
  }

  /** 방향 비교 절 본문. choice가 있으면 AI 추천과 내 선택을 함께 남긴다. */
  static toMarkdown(set: DirectionSet, choice: DirectionChoice | null): string {
    const blocks = set.options.map((d) => {
      const lines = [`#### 방향 ${d.id}. ${d.title}${d.id === set.recommendedId ? ' (AI 추천)' : ''}`, d.summary];
      if (d.pros.length > 0) lines.push(`- 장점: ${d.pros.join(' / ')}`);
      if (d.cons.length > 0) lines.push(`- 단점: ${d.cons.join(' / ')}`);
      lines.push(`- 위험: ${d.risk}`, `- 되돌리기: ${REVERSIBILITY_LABEL[d.reversibility]}`);
      if (d.touches.length > 0) lines.push(`- 손댈 곳: ${d.touches.map((t) => `\`${t}\``).join(', ')}`);
      return lines.join('\n');
    });
    const picked =
      choice === null
        ? '아직 고르지 않았어요.'
        : [
            `- AI 추천: ${choice.recommended}`,
            `- 내 선택: ${choice.chosen} (${choice.custom ? '직접 쓴 방향, AI 추천과 다르게 골랐어요' : choice.divergedFromAi() ? 'AI 추천과 다르게 골랐어요' : 'AI 추천과 같아요'})`,
            ...(choice.reason === null ? [] : [`- 이유: ${choice.reason}`]),
          ].join('\n');
    return [...blocks, `**추천 이유**: ${set.recommendedReason}`, '### 선택 기록', picked].join('\n\n');
  }
}

/** 분석 3·4단계 팀원 출력 ↔ 설계와 계획 */
export class BlueprintDto {
  private constructor(private readonly input: BlueprintInput) {}

  static from(output: unknown): BlueprintDto {
    const o = asRecord(output, '설계');
    return new BlueprintDto({
      goal: readString(o, 'goal', '설계'),
      nonGoals: readStringArray(o, 'nonGoals', '설계'),
      changes: records(o['changes'], '설계.changes').map((c) => ({ where: readString(c, 'where', 'changes'), what: readString(c, 'what', 'changes') })),
      flow: readStringArray(o, 'flow', '설계'),
      edgeCases: readStringArray(o, 'edgeCases', '설계'),
      rejected: records(o['rejected'] ?? [], '설계.rejected').map((r) => ({ option: readString(r, 'option', 'rejected'), whyNot: readString(r, 'whyNot', 'rejected') })),
      testStrategy: readString(o, 'testStrategy', '설계'),
      steps: records(o['steps'], '설계.steps').map((s) => ({
        title: typeof s['title'] === 'string' ? s['title'] : '',
        testFirst: typeof s['testFirst'] === 'string' ? s['testFirst'] : '',
        files: readStringArray(s, 'files', 'steps'),
        verify: typeof s['verify'] === 'string' ? s['verify'] : '',
      })),
      risks: readStringArray(o, 'risks', '설계'),
    });
  }

  toEntity(): Blueprint {
    return Blueprint.of(this.input);
  }

  /** design: 설계 절 본문(목표·비목표·바뀌는 지점·흐름·엣지 케이스·버린 안·테스트 전략), plan: 단계별 계획 절 본문 */
  static toMarkdown(bp: Blueprint): { design: string; plan: string } {
    const design = ['### 목표', bp.goal];
    design.push('### 비목표', bulletsOrNone(bp.nonGoals));
    design.push('### 바뀌는 지점', bullets(bp.changes.map((c) => `\`${c.where}\`: ${c.what}`)));
    if (bp.flow.length > 0) design.push('### 데이터 흐름', bp.flow.map((f, i) => `${i + 1}. ${f}`).join('\n'));
    design.push('### 엣지 케이스', bulletsOrNone(bp.edgeCases));
    design.push('### 버린 안', bulletsOrNone(bp.rejected.map((r) => `${r.option}: ${r.whyNot}`)));
    design.push('### 테스트 전략', bp.testStrategy === '' ? '- 없음' : bp.testStrategy);
    if (bp.risks.length > 0) design.push('### 위험·확인하지 못한 것', bullets(bp.risks));
    const plan = bp.steps.map((s) => [`### ${s.number}. ${s.title}`, `- 먼저 쓸 테스트: ${s.testFirst}`, `- 바꿀 파일: ${s.files.map((f) => `\`${f}\``).join(', ')}`, `- 확인: \`${s.verify}\``].join('\n'));
    return { design: design.join('\n\n'), plan: plan.join('\n\n') };
  }
}
