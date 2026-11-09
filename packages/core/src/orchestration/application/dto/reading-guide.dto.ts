import { toPosixPath } from '../../../shared/path-pattern.js';
import type { CheckedClaim, Evidence } from '../../domain/fact-check.js';
import type { StopReason } from '../../domain/run-scope.js';
import type { ModelTier } from '../../domain/team.js';
import type { CheckVerdict, VerificationVerdict } from '../../domain/verification.js';
import type { FileChange } from '../ports.js';
import type { ExplanationDto } from './explanation.dto.js';

export type RunStopReason = StopReason | 'intake-failed' | 'usage-limit' | 'login-required' | 'cancelled';

export interface ReadingGuideProps {
  readonly badge: string;
  readonly title: string;
  readonly status: 'complete' | 'stopped';
  readonly stopReason: RunStopReason | null;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly tierCalls: Readonly<Record<ModelTier, number>>;
  readonly explanation: ExplanationDto | null;
  readonly verdict: VerificationVerdict | null;
  readonly changes: readonly FileChange[];
  readonly logDir: string | null;
  /** 작업을 시작할 때 본 기준(`main (a1b2c3d)`). 저장소 지식이 없으면 없음. */
  readonly basis?: string | null;
  /** 해석이 갈린 지점과 실제로 따른 해석. confirmed = 사용자가 직접 확인했는지. */
  readonly assumptions: readonly SettledAssumption[];
  /** 사실 점검 결과. 3단 작업이 아니면 없음. */
  readonly facts?: FactsSummary;
  /** 마지막 팀원 호출이 한도·도구 거절로 멈춘 이유 문장(MemberStop.sentence). 멈춘 작업에만 보인다. */
  readonly memberStop?: string | null;
}

/** 사실 점검 결과. 3단 작업이 아니면(--quick) 비어 있다. */
export interface FactsSummary {
  /** 구현 보고의 결정·외부 사실과 확인 결과(마지막 리뷰 기준) */
  readonly checked: readonly CheckedClaim[];
  /** 근거 없는 리뷰 지적 */
  readonly reviewerGuesses: readonly CheckedClaim[];
  /** 코드에 들어간 추측인데 물어볼 화면이 없어 확인받지 못한 것 */
  readonly unconfirmed: readonly CheckedClaim[];
  readonly reviewRounds: number;
  /** 리뷰어 보고를 읽지 못한 리뷰가 있었는지 */
  readonly reviewMissing: boolean;
}

function evidenceLabel(e: Evidence): string {
  switch (e.kind) {
    case 'code':
      return e.line !== null ? `${e.path}:${e.line}` : e.path;
    case 'test':
      return `테스트 "${e.name}"`;
    case 'web':
      return e.url;
    case 'user':
      return e.text === '사용자가 맞다고 확인함' ? '사용자가 확인' : '정한 해석';
    case 'record':
      return '기억된 결정';
  }
}

export interface SettledAssumption {
  readonly question: string;
  readonly chosen: string;
  readonly confirmed: boolean;
}

const STOP_MESSAGE: Readonly<Record<RunStopReason, string>> = {
  'too-large': 'L급 작업입니다. 설계·시니어가 필요해서 아직 시작하지 않습니다. 작업을 더 작게 나눠 다시 요청해 주세요.',
  'needs-senior': '구현 팀원이 sonnet으로 올라가야 하는데 이번 실행 범위에서 막혔습니다.',
  'needs-support': '구현 시니어(sonnet)까지 실패했습니다. 디버깅·설계 자문은 다음 단계에서 붙입니다. 아래 기록의 실패 요약을 참고하세요.',
  halted: '올바른 이유로 실패하는 테스트를 만들지 못하거나 리뷰가 반복돼 작업을 멈췄습니다. 코드를 바꾸는 요청이 아니라면 질문이나 문서 요청으로 다시 말씀해 주세요.',
  'usage-limit': 'Claude 구독 사용 한도에 걸려 멈췄습니다. 진행 표시에 나온 시각에 한도가 풀리면 다시 요청해 주세요.',
  'login-required': '이 프로필의 Claude 로그인이 필요해서 멈췄습니다. 앱에서는 설정의 계정 칸에서 로그인하고, 터미널에서는 `rauha login`을 실행한 뒤 다시 요청해 주세요.',
  cancelled: '직접 멈췄습니다. 바뀐 파일은 그대로 남아 있으니, 아래 목록을 보고 되돌리거나 이어서 요청해 주세요.',
  'unsupported-stage': '지금 범위에서 다루지 않는 단계에 도달했습니다.',
  'intake-failed': '요청을 업무 지시서로 바꾸지 못했습니다. 요청을 더 구체적으로 적어 주세요.',
};

type Link = (path: string, label: string) => string;

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}분 ${sec}초` : `${sec}초`;
}

/** 끝에 마침표가 없을 때만 붙인다. */
function sentence(text: string): string {
  return /[.!?。]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

function checkLine(c: CheckVerdict): string[] {
  if (c.status === 'skip') return [`  - ${c.name}: ${c.summary}, 건너뜀`];
  // 작업 전부터 실패하던 검사(환경 문제·원래 깨진 테스트)는 통과처럼 ✓를 붙이지 않는다.
  const head =
    c.ok && c.status === 'fail'
      ? `  · ${c.command ?? c.name}   작업 전부터 실패, 이번 변경으로 늘어난 실패 없음 (${c.summary})`
      : `  ${c.ok ? '✓' : '✗'} ${c.command ?? c.name}   ${c.summary}`;
  return [
    head,
    ...(c.newFailures.length > 0 && !c.ok ? [`      새 실패: ${c.newFailures.slice(0, 5).join(', ')}`] : []),
    ...(c.preexisting.length > 0 ? [`      원래 깨져 있던 것: ${c.preexisting.slice(0, 5).join(', ')}`] : []),
  ];
}

/**
 * 실행이 끝난 뒤 사용자가 코드를 읽고 남에게 설명할 수 있게 돕는 읽기 안내서.
 * 모델을 다시 부르지 않고, 구현 팀원의 설명과 rauha가 실행한 검증 결과로 조립한다.
 */
export class ReadingGuideDto {
  private constructor(private readonly props: ReadingGuideProps) {}

  static create(props: ReadingGuideProps): ReadingGuideDto {
    return new ReadingGuideDto(props);
  }

  /** 멈췄으면 그 이유 문장, 아니면 null */
  stopMessage(): string | null {
    if (this.props.status !== 'stopped' || this.props.stopReason === null) return null;
    return [STOP_MESSAGE[this.props.stopReason], this.props.memberStop ?? ''].filter((t) => t !== '').join(' ');
  }

  toMarkdown(): string {
    return this.render((_path, label) => label);
  }

  /** `파일:줄`을 OSC 8 하이퍼링크로 감싼다. VS Code 터미널에서 클릭하면 열린다. */
  toTerminal(root: string): string {
    const base = toPosixPath(root);
    const prefix = base.startsWith('/') ? 'file://' : 'file:///';
    return this.render((path, label) => `\u001b]8;;${prefix}${base}/${toPosixPath(path)}\u001b\\${label}\u001b]8;;\u001b\\`);
  }

  private render(link: Link): string {
    const p = this.props;
    const tiers = (Object.entries(p.tierCalls) as [ModelTier, number][])
      .filter(([, n]) => n > 0)
      .map(([tier, n]) => `${tier} ${n}회`)
      .join(', ');
    const facts = p.facts ?? null;
    const reviewed = facts !== null && facts.reviewRounds > 0;
    const state = p.status === 'complete' ? (reviewed ? `완료(리뷰 ${facts.reviewRounds}회)` : '완료(리뷰 전)') : '멈춤';
    const lines: string[] = [
      `${p.badge} ${p.title} · ${state} · ${formatDuration(p.durationMs)} · ${tiers}`,
      ...(p.basis ? [`작업 기준: ${p.basis} · 고친 곳: 작업 트리(커밋 안 함)`] : []),
    ];

    // 가정은 맨 위에: 해석이 다르면 코드를 읽기 전에 알아야 한다.
    const unconfirmed = p.assumptions.filter((a) => !a.confirmed);
    const confirmed = p.assumptions.filter((a) => a.confirmed);
    if (unconfirmed.length > 0) {
      lines.push('', '알아서 정한 해석 (추천대로 진행했어요. 다르면 다시 요청해 주세요)');
      for (const a of unconfirmed) lines.push(`  - ${a.question} → ${a.chosen}`);
    }
    if (confirmed.length > 0) {
      lines.push('', '확인한 가정');
      for (const a of confirmed) lines.push(`  - ${a.question} → ${a.chosen} (직접 확인함)`);
    }

    // 코드에 들어갔는데 확인 못 한 사실도 맨 위에: 코드를 믿기 전에 사용자가 직접 확인해야 한다.
    if (facts !== null && facts.unconfirmed.length > 0) {
      lines.push('', '⚠ 확인 필요 (코드에 들어갔는데 근거를 찾지 못함)');
      for (const c of facts.unconfirmed) lines.push(`  - ${c.text}`);
    }

    if (p.status === 'stopped' && p.stopReason !== null) {
      lines.push('', `멈춘 이유: ${this.stopMessage()}`);
    }

    const verifiedBy = new Map((facts?.checked ?? []).filter((c) => !c.isGuess).map((c) => [c.text, c.verified[0] as Evidence]));
    const e = p.explanation;
    if (e !== null) {
      lines.push('', '읽는 순서');
      e.readingOrder.forEach((stop, i) => {
        const label = stop.line !== null ? `${stop.path}:${stop.line}` : stop.path;
        lines.push(`  ${i + 1}. ${link(stop.path, label)}   ${stop.note}`);
      });
      lines.push('', '결정과 이유');
      for (const d of e.decisions) {
        const evidence = verifiedBy.get(`${d.what} — ${d.why}`);
        lines.push(
          `  - ${sentence(d.what)} ${d.why}${d.rejected !== null ? ` (버린 안: ${d.rejected.replace(/\.\s*$/, '')})` : ''}${evidence !== undefined ? ` (근거: ${evidenceLabel(evidence)})` : ''}`,
        );
      }
      lines.push('', '직접 해 볼 것');
      for (const check of e.manualChecks) lines.push(`  - ${check}`);
      if (e.untested.length > 0) lines.push(`  - 자동 테스트가 못 잡는 부분: ${e.untested.join(', ')}`);
    }

    // 근거 없는 추측·리뷰어 지적 목록은 읽는 데 방해만 돼서 쓰지 않는다(사용자 결정). 코드에 들어간 것은 위 '확인 필요'에 남는다.
    if (facts !== null) {
      if (facts.reviewMissing) lines.push('', '리뷰어 보고를 읽지 못한 리뷰가 있었습니다. 그 리뷰는 지적 없음으로 처리했습니다.');
    }

    if (p.verdict !== null) {
      lines.push('', '검증 (rauha가 직접 실행)');
      for (const c of p.verdict.checks) lines.push(...checkLine(c));
    }

    if (p.changes.length > 0) {
      lines.push('', '바뀐 파일 (커밋은 직접 하세요)');
      for (const c of p.changes) lines.push(`  ${c.kind === 'added' ? '+' : c.kind === 'deleted' ? '-' : '~'} ${link(c.path, c.path)}`);
      if (p.status === 'stopped') {
        lines.push('', '되돌리려면');
        for (const c of p.changes) {
          lines.push(c.kind === 'added' ? `  git clean -f -- ${c.path}` : `  git checkout -- ${c.path}`);
        }
      }
    }

    if (p.logDir !== null) lines.push('', `기록: ${p.logDir}`);
    return lines.join('\n');
  }
}
