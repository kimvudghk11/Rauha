import type { AnalysisRun } from '../../domain/analysis-run.js';
import type { ApprovalCard, DirectionCard } from '../ports.js';
import { BlueprintDto, DirectionsDto, InvestigationDto, redactSecrets } from './analysis-dtos.js';

const TITLE_LIMIT = 60;
const MARKER = /^<!-- rauha-analysis:([^\s>]+) -->/;

const titleOf = (run: AnalysisRun): string => run.request.replace(/\s+/g, ' ').slice(0, TITLE_LIMIT);

/** 분석 한 번의 문서·요약·작업 넘기기·카드를 만든다(경계에서 일하는 객체). 문서에는 비밀 모양을 가려서 쓴다. */
export class AnalysisDocDto {
  private constructor() {}

  /** 문서 맨 위 표지. 이어 쓸 때 "내가 만든 문서인지" 확인하는 데 쓴다. */
  static marker(runId: string): string {
    return `<!-- rauha-analysis:${runId} -->`;
  }

  /** 문서 내용에서 표지의 분석 번호를 읽는다. 없으면 null. */
  static markerOf(content: string): string | null {
    return MARKER.exec(content)?.[1] ?? null;
  }

  /** 지금까지의 단계 산출물을 하나의 문서로. 단계가 늘 때마다 같은 문서를 이어 쓴다. */
  static toMarkdown(run: AnalysisRun, ctx: { repo: string; basis: string | null }): string {
    const parts = [
      AnalysisDocDto.marker(run.id),
      `# ${titleOf(run)}`,
      [`- 날짜: ${run.date}`, `- 요청: ${run.request.replace(/\s+/g, ' ')}`, `- 저장소: ${ctx.repo}${ctx.basis === null ? '' : ` (${ctx.basis} 기준)`}`, `- 진행: ${AnalysisDocDto.status(run)}`].join('\n'),
    ];
    if (run.investigation !== null) parts.push('## 1. 조사', InvestigationDto.toMarkdown(run.investigation));
    if (run.directions !== null) parts.push('## 2. 방향 비교', DirectionsDto.toMarkdown(run.directions, run.choice));
    if (run.blueprint !== null) {
      const md = BlueprintDto.toMarkdown(run.blueprint);
      parts.push('## 3. 설계', md.design, '## 4. 단계별 계획', md.plan);
    }
    const note = run.stopNote();
    if (note !== null) parts.push('## 멈춘 이유', note);
    return `${redactSecrets(parts.join('\n\n'))}\n`;
  }

  /** 한 줄 진행 상태 */
  static status(run: AnalysisRun): string {
    const next = run.next();
    if (run.stopped !== null) return `여기서 멈춤 (${run.stopNote()})`;
    if (next === 'choose') return '방향 선택을 기다리는 중';
    if (next === 'approve') return '계획 승인을 기다리는 중';
    if (next === 'implement') return '승인됨, 구현을 넘기는 중';
    if (run.wasImplemented) return '승인되어 구현 작업으로 넘김';
    const reach = run.reachValue.value;
    return reach === 'investigate' ? '조사까지 마침' : reach === 'compare' ? '방향 비교까지 마침' : '설계와 계획까지 마침';
  }

  /** 사용자에게 보일 결과 글(채팅 칸·작업 결과) */
  static toSummary(run: AnalysisRun, path: string | null, docProblem: string | null): string {
    const lines: string[] = [`분석: ${titleOf(run)}`, `상태: ${AnalysisDocDto.status(run)}`];
    const inv = run.investigation;
    if (inv !== null) {
      lines.push('', `■ 조사: ${inv.symptom}`);
      for (const c of inv.causes.slice(0, 3)) lines.push(`- 원인 후보: ${c.text}`);
      if (inv.unknowns.length > 0) lines.push(`- 아직 모르는 것: ${inv.unknowns.join(' / ')}`);
    }
    if (run.directions !== null) {
      lines.push('', `■ 방향 비교: ${run.directions.options.map((d) => `${d.title}${d.id === run.directions!.recommendedId ? '(AI 추천)' : ''}`).join(' · ')}`);
      if (run.choice !== null) lines.push(`- 내 선택: ${run.choice.chosen}${run.choice.divergedFromAi() ? ' (AI 추천과 다르게 골랐어요)' : ''}`);
    }
    if (run.blueprint !== null) lines.push('', `■ 계획 ${run.blueprint.steps.length}단계`, ...run.blueprint.steps.map((s) => `- ${s.number}. ${s.title}`));
    const note = run.stopNote();
    if (note !== null) lines.push('', note);
    lines.push('', path === null ? `문서를 쓰지 못했어요${docProblem === null ? '' : `: ${docProblem}`}` : `문서: ${path}`);
    return redactSecrets(lines.join('\n'));
  }

  /** 승인된 계획을 작업 루프에 넘길 요청과 설계 블록으로. 접수 팀장은 이 블록이 답하는 지점을 다시 묻지 않는다. */
  static workBrief(run: AnalysisRun, path: string | null): { request: string; block: string } {
    const bp = run.blueprint!;
    const request = [bp.goal, ...bp.steps.map((s) => `- ${s.number}단계 ${s.title}: ${s.testFirst}`)].join('\n');
    const block = [
      `<design title="${titleOf(run).replace(/"/g, "'")}"${path === null ? '' : ` file="${path}"`}>`,
      '사용자가 분석 결과를 보고 방향을 고르고 승인한 설계와 계획입니다. 이 계획이 답하는 지점은 다시 묻지 말고 그대로 따르세요. 계획이 답하지 않는 지점 중 되돌리기 어려운 것(돈, 데이터 삭제, 보안·권한, 공개 API, DB 구조)만 사용자에게 물어도 됩니다.',
      `증상: ${run.investigation?.symptom ?? run.request}`,
      `고른 방향: ${run.choice?.chosen ?? '없음'}`,
      `목표: ${bp.goal}`,
      '바뀌는 지점:',
      ...bp.changes.map((c) => `- ${c.where}: ${c.what}`),
      ...(bp.edgeCases.length > 0 ? ['엣지 케이스(테스트로 먼저 잠근다):', ...bp.edgeCases.map((e) => `- ${e}`)] : []),
      ...(bp.nonGoals.length > 0 ? ['이번에 하지 않을 것:', ...bp.nonGoals.map((n) => `- ${n}`)] : []),
      '단계별 계획(순서대로):',
      ...bp.steps.flatMap((s) => [`${s.number}. ${s.title}`, `   먼저 쓸 테스트: ${s.testFirst}`, `   바꿀 파일: ${s.files.join(', ')}`, `   확인: ${s.verify}`]),
      '</design>',
    ].join('\n');
    return { request: redactSecrets(request), block: redactSecrets(block) };
  }

  static directionCard(run: AnalysisRun, path: string | null): DirectionCard {
    const set = run.directions!;
    return {
      runId: run.id,
      title: titleOf(run),
      symptom: run.investigation?.symptom ?? run.request,
      options: set.options,
      recommendedId: set.recommendedId,
      recommendedReason: set.recommendedReason,
      canGoOn: !run.reachValue.includes('plan'),
      docPath: path,
    };
  }

  static approvalCard(run: AnalysisRun, path: string | null): ApprovalCard {
    const bp = run.blueprint!;
    return { runId: run.id, title: titleOf(run), chosen: run.choice?.chosen ?? '', goal: bp.goal, steps: bp.steps.map((s) => ({ number: s.number, title: s.title })), risks: bp.risks, docPath: path };
  }
}
