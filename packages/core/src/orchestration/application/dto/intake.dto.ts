import { DomainError } from '../../../shared/domain-error.js';
import { asRecord, readBoolean, readInt, readString, readStringArray } from '../../../shared/validation.js';
import type { ScenarioSummary } from '../../domain/work-order.js';
import { Specialty, type SpecialtyName } from '../../domain/specialty.js';
import { OpenWorkOrderDto } from './open-work-order.dto.js';

export type AcceptanceKind = 'happy' | 'error';

export interface AcceptanceCriterion {
  readonly kind: AcceptanceKind;
  readonly text: string;
}

/** 요청이 두 가지 이상으로 읽히는 지점. 팀장은 하나를 골라 수용 기준에 숫자로 못박고, 여기에 남긴다. */
export interface Assumption {
  readonly question: string;
  readonly chosen: string;
  readonly alternatives: readonly string[];
  /**
   * 사용자가 꼭 정해야 하는 해석인지. 틀리면 되돌리기 어렵거나(돈·데이터 삭제·보안·공개 API·DB 구조),
   * 이 코드베이스의 관례로는 추천을 못 정하는 경우만 true. 아니면 추천대로 진행하고 안내서에만 남긴다.
   */
  readonly needsUser: boolean;
}

export interface SettledAssumptionChoice {
  readonly question: string;
  readonly chosen: string;
  readonly confirmed: boolean;
  /** 사용자가 추천과 다른 해석을 골랐는지. 그러면 접수를 다시 받는다. */
  readonly changed: boolean;
}

const KIND_LABEL: Readonly<Record<AcceptanceKind, string>> = { happy: '정상', error: '예외' };
const MAX_ASSUMPTIONS = 3;
const MAX_READ_FIRST = 5;

function readAssumptions(obj: Record<string, unknown>): Assumption[] {
  const raw = obj['assumptions'] ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_ASSUMPTIONS) {
    throw new DomainError('INVALID_INPUT', `Intake.assumptions: ${MAX_ASSUMPTIONS}개 이하의 배열이어야 합니다.`);
  }
  return raw.map((item, i) => {
    const a = asRecord(item, `Intake.assumptions[${i}]`);
    const alternatives = readStringArray(a, 'alternatives', `Intake.assumptions[${i}]`);
    if (alternatives.length === 0) {
      throw new DomainError('INVALID_INPUT', `Intake.assumptions[${i}].alternatives: 다른 해석이 1개 이상 있어야 가정입니다.`);
    }
    return {
      question: readString(a, 'question', `Intake.assumptions[${i}]`),
      chosen: readString(a, 'chosen', `Intake.assumptions[${i}]`),
      alternatives,
      needsUser: readBoolean(a, 'needsUser', `Intake.assumptions[${i}]`, false),
    };
  });
}

/** 팀장 접수 결과(구조화 출력) → 업무 지시서. 1단계에서는 수용 기준이 BDD 시나리오를 대신한다. */
export class IntakeDto {
  private constructor(
    readonly title: string,
    readonly fileCount: number,
    readonly crossModule: boolean,
    readonly sensitive: boolean,
    readonly scope: readonly string[],
    readonly acceptance: readonly AcceptanceCriterion[],
    readonly doneWhen: string,
    readonly forbidden: readonly string[],
    readonly assumptions: readonly Assumption[],
    /** 팀장이 접수하며 읽은 파일 중 팀원도 먼저 봐야 할 것. rauha가 내용을 붙여 넘긴다. */
    readonly readFirst: readonly string[],
    /** 이 업무가 걸친 전문 분야(프론트엔드·백엔드·DB·설계·인프라). 팀원 메시지에 그 분야의 지침이 붙는다. */
    readonly specialties: readonly SpecialtyName[],
  ) {}

  static from(input: unknown): IntakeDto {
    const obj = asRecord(input, 'Intake');
    const scope = readStringArray(obj, 'scope', 'Intake');
    if (scope.length === 0) {
      throw new DomainError('INVALID_INPUT', 'Intake.scope: 건드려도 되는 경로를 하나 이상 지정해야 합니다.');
    }
    const rawAcceptance = obj['acceptance'];
    if (!Array.isArray(rawAcceptance)) {
      throw new DomainError('INVALID_INPUT', 'Intake.acceptance: 배열이 필요합니다.');
    }
    const acceptance = rawAcceptance.map((raw, i): AcceptanceCriterion => {
      const item = asRecord(raw, `Intake.acceptance[${i}]`);
      const kind = item['kind'];
      if (kind !== 'happy' && kind !== 'error') {
        throw new DomainError('INVALID_INPUT', `Intake.acceptance[${i}].kind: happy 또는 error여야 합니다.`);
      }
      return { kind, text: readString(item, 'text', `Intake.acceptance[${i}]`) };
    });
    return new IntakeDto(
      readString(obj, 'title', 'Intake'),
      readInt(obj, 'fileCount', 'Intake'),
      readBoolean(obj, 'crossModule', 'Intake', false),
      readBoolean(obj, 'sensitive', 'Intake', false),
      scope,
      acceptance,
      readString(obj, 'doneWhen', 'Intake'),
      readStringArray(obj, 'forbidden', 'Intake'),
      readAssumptions(obj),
      obj['readFirst'] === undefined ? [] : readStringArray(obj, 'readFirst', 'Intake').slice(0, MAX_READ_FIRST),
      Specialty.readAll(obj['specialties']),
    );
  }

  /**
   * 팀장이 업무 지시서를 끝내 만들지 못했을 때 쓰는 지시서: 요청 글 그대로를 수용 기준으로 삼는다.
   * 접수 실패로 작업을 멈추면 사용자는 아무것도 못 받으므로, 범위를 저장소 전체로 두고 팀원이 요청을 직접 읽고 일하게 한다.
   */
  static fallback(request: string): IntakeDto {
    const text = request.trim();
    const title = (text.split('\n')[0] ?? '').trim().slice(0, 60) || '요청한 작업';
    return new IntakeDto(
      title,
      3,
      false,
      false,
      ['**'],
      [
        { kind: 'happy', text: `사용자의 요청을 그대로 해낸다: ${text}` },
        { kind: 'error', text: '기존 동작과 기존 검사(테스트·타입·린트)가 깨지지 않는다' },
      ],
      '요청한 변경이 반영되고 기존 검사가 통과한다',
      [],
      [],
      [],
      [],
    );
  }

  toOpenWorkOrder(): OpenWorkOrderDto {
    return OpenWorkOrderDto.from({
      title: this.title,
      fileCount: this.fileCount,
      crossModule: this.crossModule,
      sensitive: this.sensitive,
      scope: this.scope,
    });
  }

  toScenarioSummary(): ScenarioSummary {
    return {
      happyPaths: this.acceptance.filter((a) => a.kind === 'happy').length,
      errorPaths: this.acceptance.filter((a) => a.kind === 'error').length,
    };
  }

  /**
   * 사용자의 선택(0 = 추천, 1.. = 다른 후보)을 반영한 가정 목록.
   * picks[i]가 null이면 그 가정은 묻지 않은 것이고(꼭 물을 필요가 없었거나 물을 화면이 없었다), 추천대로 정한다.
   */
  settleAssumptions(picks: readonly (number | null)[] | null): SettledAssumptionChoice[] {
    return this.assumptions.map((a, i) => {
      const pick = picks?.[i] ?? null;
      const alternative = pick !== null && pick > 0 ? a.alternatives[pick - 1] : undefined;
      return {
        question: a.question,
        chosen: alternative ?? a.chosen,
        confirmed: pick !== null,
        changed: alternative !== undefined,
      };
    });
  }

  /** 상위 설계의 「업무 지시서 양식」. 팀원에게 넘기는 사용자 메시지의 앞부분이 된다. */
  toBrief(grade: string): string {
    return [
      `## 업무: ${this.title}`,
      `- 등급: ${grade}`,
      `- 범위: ${this.scope.join(', ')}`,
      `- 완료 조건: ${this.doneWhen}`,
      `- 금지: ${this.forbidden.length > 0 ? this.forbidden.join(', ') : '없음'}`,
      '',
      '수용 기준',
      ...this.acceptance.map((a) => `- [${KIND_LABEL[a.kind]}] ${a.text}`),
      ...(this.assumptions.length > 0
        ? ['', '정해 둔 해석 (이대로 따른다)', ...this.assumptions.map((a) => `- ${a.question} → ${a.chosen}`)]
        : []),
      ...(this.specialties.length > 0 ? ['', Specialty.block(this.specialties)] : []),
    ].join('\n');
  }
}
