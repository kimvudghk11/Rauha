import { DomainError } from '../../shared/domain-error.js';

const MIN_STEPS = 1;
const MAX_STEPS = 8;

export interface PlanStepInput {
  readonly title: string;
  /** 먼저 쓸 테스트(실패해야 하는 것) */
  readonly testFirst: string;
  /** 이 단계에서 바꿀 파일 */
  readonly files: readonly string[];
  /** 끝났는지 확인하는 명령이나 방법 */
  readonly verify: string;
}

export interface PlanStep extends PlanStepInput {
  readonly number: number;
}

export interface BlueprintInput {
  readonly goal: string;
  readonly nonGoals: readonly string[];
  /** 바뀌는 지점: 어디를 어떻게 */
  readonly changes: readonly { readonly where: string; readonly what: string }[];
  /** 데이터 흐름 */
  readonly flow: readonly string[];
  readonly edgeCases: readonly string[];
  /** 버린 안과 이유 */
  readonly rejected: readonly { readonly option: string; readonly whyNot: string }[];
  readonly testStrategy: string;
  readonly steps: readonly PlanStepInput[];
  readonly risks: readonly string[];
}

const trimmed = (list: readonly string[]): string[] => list.map((s) => s.trim()).filter((s) => s !== '');

/**
 * 분석 3·4단계 결과: 고른 방향의 설계(목표·비목표·변경 지점·데이터 흐름·엣지 케이스·버린 안·테스트 전략)와
 * 작업을 작은 단계로 나눈 계획. 단계마다 먼저 쓸 테스트·바꿀 파일·확인 방법이 없으면 만들 수 없다.
 */
export class Blueprint {
  private constructor(
    readonly goal: string,
    readonly nonGoals: readonly string[],
    readonly changes: readonly { readonly where: string; readonly what: string }[],
    readonly flow: readonly string[],
    readonly edgeCases: readonly string[],
    readonly rejected: readonly { readonly option: string; readonly whyNot: string }[],
    readonly testStrategy: string,
    readonly steps: readonly PlanStep[],
    readonly risks: readonly string[],
  ) {}

  static of(input: BlueprintInput): Blueprint {
    const goal = input.goal.trim();
    if (goal === '') throw new DomainError('INVALID_INPUT', '설계의 목표가 비어 있습니다.');
    const changes = input.changes.map((c) => ({ where: c.where.trim(), what: c.what.trim() })).filter((c) => c.where !== '' && c.what !== '');
    if (changes.length === 0) throw new DomainError('INVALID_INPUT', '설계에는 바뀌는 곳이 하나 이상 있어야 합니다.');
    if (input.steps.length < MIN_STEPS || input.steps.length > MAX_STEPS) throw new DomainError('INVALID_INPUT', `계획은 ${MIN_STEPS}단계에서 ${MAX_STEPS}단계까지여야 합니다.`);
    const steps = input.steps.map((s, i): PlanStep => {
      const title = s.title.trim();
      const files = trimmed(s.files);
      if (title === '' || s.testFirst.trim() === '' || files.length === 0 || s.verify.trim() === '') {
        throw new DomainError('INCOMPLETE_STEP', `${i + 1}단계(${title === '' ? '이름 없음' : title})에는 먼저 쓸 테스트, 바꿀 파일, 확인 방법이 모두 있어야 합니다.`);
      }
      return { number: i + 1, title, testFirst: s.testFirst.trim(), files, verify: s.verify.trim() };
    });
    return new Blueprint(
      goal,
      trimmed(input.nonGoals),
      changes,
      trimmed(input.flow),
      trimmed(input.edgeCases),
      input.rejected.map((r) => ({ option: r.option.trim(), whyNot: r.whyNot.trim() })).filter((r) => r.option !== ''),
      input.testStrategy.trim(),
      steps,
      trimmed(input.risks),
    );
  }

  /** 계획이 손대는 파일(한 번씩, 처음 나온 순서) */
  filesTouched(): string[] {
    return [...new Set(this.steps.flatMap((s) => s.files))];
  }
}
