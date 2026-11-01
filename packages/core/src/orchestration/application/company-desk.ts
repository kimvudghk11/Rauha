import { CompanyBook } from '../domain/company-book.js';
import { Department, LAUNCH_ORDER, type DepartmentId, type DepartmentMemberRole } from '../domain/department.js';
import type { MemberRole } from '../domain/member-role.js';
import { SessionBudget } from '../domain/session-budget.js';
import type { ModelTier } from '../domain/team.js';
import { AnalysisReportDto } from './dto/analysis-report.dto.js';
import { CompanyPlanDto } from './dto/company-plan.dto.js';
import { OpsReportDto } from './dto/ops-report.dto.js';
import type { Route } from './dto/route.dto.js';
import { ANALYSIS_SCHEMA, COMPANY_PLAN_SCHEMA, OPS_SCHEMA } from './dto/schemas.js';
import type { CompanyBookPort, MemberResult, ProgressPort } from './ports.js';
import { conversationBlock } from './prompt-blocks.js';
import type { TurnOutcome } from './turn-outcome.js';

/** 팀원 한 번 호출에 붙는 선택 사항 */
export interface MemberOptions {
  readonly signal?: AbortSignal | undefined;
  readonly dirs?: readonly string[];
  readonly canWrite?: (path: string) => boolean;
  /** 역할 기본 모델 대신 쓸 모델(저장소를 나눠 읽는 일은 싼 모델로) */
  readonly tier?: ModelTier;
  /** 진행 줄에 "작업 중…"을 내지 않는다(여러 호출을 묶어 따로 진행을 알릴 때) */
  readonly quiet?: boolean;
}

/** 읽기만 하고 보고하는 팀원(기획·디버깅·위험 점검·회사 부서 팀원, 운영 팀원) */
export type ReportRole = DepartmentMemberRole;

/** 런칭 계획에서 뒤 부서에 넘기는 앞 부서 글, 그리고 장부에 남기는 요약의 글자 수 */
const HANDOFF_CHARS = 700;
/** 런칭 계획에서 부서별로 앞 대화에 남기는 글자 수(다섯 부서를 합쳐도 대화에 남기는 한도 안에 든다) */
const LAUNCH_KEPT_CHARS = 190;
const UNREADABLE = '보고를 읽지 못했어요';

/** 세션이 데스크에 빌려주는 것. 호출 비용·호출 수는 세션이 합산하고, 결과를 기억과 앞 대화에 남기는 일도 세션이 한다. */
export interface DeskHost {
  member(role: MemberRole, parts: readonly string[], outputSchema: Record<string, unknown>, options: MemberOptions): Promise<MemberResult>;
  /** 결과를 기억과 앞 대화에 남기고 답으로 돌려준다 */
  settle(label: string, input: string, answer: string, remembered: string, started: number, costBefore: number): Promise<TurnOutcome>;
  /** 지금까지 쓴 비용(한 입력의 비용을 재려고 앞뒤로 읽는다) */
  spent(): number;
  workspaceBlock(): string;
}

export interface DeskDeps {
  readonly today: () => string;
  readonly now: () => number;
  readonly progress: ProgressPort;
  /** 구독 한도를 얼마나 썼는지. 없으면 넉넉하다고 본다. */
  readonly budget?: (() => SessionBudget) | undefined;
  /** 회사 장부. 있으면 팀원 입력에 이미 정한 것을 싣고, 결과를 요약해 남긴다. */
  readonly company?: CompanyBookPort | undefined;
}

/**
 * 회사 부서가 하는 일: 기획·디버깅·위험 점검처럼 팀원 하나가 읽고 보고하는 일, 부서장이 팀원에게 나눠 주는 넓은 요청, 런칭 계획.
 * 한도가 빠듯하면 부서장을 아끼고, 위험하면 큰 요청을 미룬다. 파일은 아무도 고치지 않는다.
 * 입력 하나 동안만 쓰는 값(장부 글, 부서장 절약 안내)은 호출마다 지역으로 두어 다음 입력에 남지 않는다.
 */
export class CompanyDesk {
  constructor(
    private readonly host: DeskHost,
    private readonly deps: DeskDeps,
  ) {}

  /** 한도가 위험하면 호출이 많은 일을 미루는 안내(호출 없이). 괜찮으면 null. */
  holdNotice(): TurnOutcome | null {
    const budget = this.budget();
    if (!budget.holdsHeavyWork) return null;
    const reset = budget.resetsAt !== null ? ` 한도는 ${new Date(budget.resetsAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}쯤 풀려요.` : '';
    return {
      kind: 'notice',
      message: `세션 한도를 ${Math.round(budget.percent)}% 썼어요. 이 요청은 호출이 많이 들어서 미뤄 뒀어요.${reset} 풀린 뒤에 다시 말씀해 주시거나, 지금 꼭 하려면 "그래도 진행"이라고 말씀해 주세요. (질문과 작은 요청은 지금도 할 수 있어요)`,
    };
  }

  /**
   * 원인을 찾아 달라(debug)거나 바꾸기 전에 위험을 짚어 달라(risk), 아이디어를 달라(ideate)는 요청처럼 팀원 하나가 혼자 하는 일.
   * 지금 저장소를 읽고 보고만 하며 파일은 고치지 않는다. 고치는 일은 사용자가 이어서 시키면 작업 흐름으로 간다.
   */
  async analyze(role: ReportRole, label: string, input: string, conversation: string | null, started: number, department: DepartmentId | null = null): Promise<TurnOutcome> {
    const costBefore = this.host.spent();
    const book = await this.loadBook();
    const done = await this.report(role, label, this.reportParts(input, conversation, book));
    if ('blocked' in done) return { kind: 'blocked', ...done.blocked };
    const answer = AnalysisReportDto.read({ answer: done.answer, files: done.files }, label).toAnswer();
    if (department !== null) await this.record(department, answer);
    return this.host.settle(label, input, answer, answer, started, costBefore);
  }

  /**
   * 마케팅·사업 모델·디자인·보안·릴리스처럼 회사 부서가 맡는 일. 한 팀원이 하면 될 일은 그 팀원만 부른다(호출 하나).
   * 넓은 요청은 부서장이 팀원을 최대 셋까지 골라 나눠 주고(계획), 팀원들이 동시에 일한 뒤, 둘 이상이면 부서장이 하나로 모은다(종합).
   * 한 명만 골랐으면 종합은 건너뛴다.
   */
  async company(input: string, conversation: string | null, route: Route, started: number): Promise<TurnOutcome> {
    const department = Department.of(route.department ?? 'planning');
    const label = (role: ReportRole) => department.member(role)?.label ?? role;
    if (route.member !== null) return this.analyze(route.member, label(route.member), input, conversation, started, department.id);

    const costBefore = this.host.spent();
    const book = await this.loadBook();
    const known = [`<department>\n${department.persona}\n</department>`, book, conversationBlock(conversation), `<request>\n${input}\n</request>`];
    const members = `<members>\n${department.members.map((m) => `- ${m.role}: ${m.does}`).join('\n')}\n</members>`;
    // 계획은 짧은 분배라 sonnet이면 충분하다. 부서장의 상위 모델은 팀원 보고를 모으는 종합과 런칭 섹션에 쓴다.
    const planned = await this.host.member('chief', ['<job>plan</job>', members, ...known], COMPANY_PLAN_SCHEMA, { tier: 'sonnet' });
    if (planned.blocked) return { kind: 'blocked', ...planned.blocked };
    const { assignments } = CompanyPlanDto.read(planned.output, department);

    const reports = await Promise.all(assignments.map((a) => this.report(a.role, label(a.role), this.reportParts(input, conversation, book, a.brief))));
    const done: { role: ReportRole; answer: string; files: readonly string[] }[] = [];
    for (const [i, r] of reports.entries()) {
      if ('blocked' in r) return { kind: 'blocked', ...r.blocked };
      done.push({ role: assignments[i]!.role, answer: r.answer, files: r.files });
    }
    if (done.length === 1) {
      const only = done[0]!;
      const answer = AnalysisReportDto.read({ answer: only.answer, files: only.files }, label(only.role)).toAnswer();
      await this.record(department.id, answer);
      return this.host.settle(department.label, input, answer, answer, started, costBefore);
    }

    const body = done.map((d) => `<report member="${d.role}">\n${d.answer}\n</report>`).join('\n');
    const merged = await this.host.member('chief', ['<job>merge</job>', ...known, `<reports>\n${body}\n</reports>`], ANALYSIS_SCHEMA, this.chiefPace()());
    if (merged.blocked) return { kind: 'blocked', ...merged.blocked };
    const read = AnalysisReportDto.read(merged.output, department.label);
    // 팀원이 읽은 파일은 부서장이 빠뜨려도 사라지지 않게 합친다.
    const files = [...new Set([...read.files, ...done.flatMap((d) => d.files)])];
    const answer = AnalysisReportDto.read({ answer: read.answer, files }, department.label).toAnswer();
    await this.record(department.id, answer);
    return this.host.settle(department.label, input, answer, answer, started, costBefore);
  }

  /**
   * 앱·웹을 기획해 오픈하고 운영하기까지의 런칭 계획. 부서장이 부서마다 한 번씩(팀원을 따로 부르지 않고) 순서대로 자기 부서의 몫을 쓰고,
   * 뒤 부서는 앞 부서의 글을 받아 이어 쓴다. 호출은 부서 수(5)만큼이다. 개발은 계획이 정해진 뒤 설계 대화로 이어 간다.
   */
  async launch(input: string, conversation: string | null, started: number): Promise<TurnOutcome> {
    const costBefore = this.host.spent();
    const book = await this.loadBook();
    const pace = this.chiefPace();
    const sections: { label: string; answer: string }[] = [];
    for (const id of LAUNCH_ORDER) {
      const department = Department.of(id);
      this.deps.progress.step(`런칭 계획: ${department.label}`);
      // 뒤 부서에는 앞 부서 글 전문이 아니라 요약만 넘긴다(전문은 호출마다 입력을 불린다).
      const earlier = sections.map((s) => `[${s.label}]\n${CompanyBook.summaryOf(s.answer, HANDOFF_CHARS)}`).join('\n\n');
      const result = await this.host.member(
        'chief',
        [
          `<department>\n${department.persona}\n</department>`,
          '<job>section</job>',
          conversationBlock(conversation),
          `<today>${this.deps.today()}</today>`,
          this.host.workspaceBlock(),
          book,
          earlier !== '' ? `<earlier>\n${earlier}\n</earlier>` : '',
          `<request>\n${input}\n</request>`,
        ],
        ANALYSIS_SCHEMA,
        pace(),
      );
      if (result.blocked) return { kind: 'blocked', ...result.blocked };
      const section = AnalysisReportDto.read(result.output, department.label).answer;
      sections.push({ label: department.label, answer: section });
      await this.record(id, section);
    }
    const answer = [...sections.map((s) => `━━ ${s.label} ━━\n${s.answer}`), '개발은 이 계획이 정해진 뒤에 시작해요. "이 계획으로 설계 시작해줘"라고 하시면 설계 대화로 이어지고, "런칭 계획 문서로 남겨줘"라고 하시면 파일로 써요.'].join('\n\n');
    // 앞 대화에는 부서별 핵심만 남긴다(전문은 기억에 있다). 다음 말이 이 계획을 가리켜도 이어지게.
    const remembered = sections.map((s) => `${s.label}: ${s.answer.replace(/\s+/g, ' ').slice(0, LAUNCH_KEPT_CHARS)}`).join(' / ');
    return this.host.settle('런칭 계획', input, answer, remembered, started, costBefore);
  }

  /** 운영 팀원만 명령을 실행해 보고 모양이 달라 그것만 따로 읽는다. 나머지는 읽기 보고다. */
  private async report(role: ReportRole, label: string, parts: readonly string[]): Promise<{ blocked: NonNullable<MemberResult['blocked']> } | { answer: string; files: readonly string[] }> {
    if (role === 'operator') {
      const result = await this.host.member(role, parts, OPS_SCHEMA, {});
      return result.blocked ? { blocked: result.blocked } : { answer: OpsReportDto.read(result.output).toAnswer(), files: [] };
    }
    const result = await this.host.member(role, parts, ANALYSIS_SCHEMA, {});
    if (result.blocked) return { blocked: result.blocked };
    const read = AnalysisReportDto.read(result.output, label);
    return { answer: read.answer, files: read.files };
  }

  /** 팀원에게 보내는 공통 입력. brief가 있으면 부서장이 이 팀원에게 준 지시다. */
  private reportParts(input: string, conversation: string | null, book: string, brief: string | null = null): string[] {
    return [
      conversationBlock(conversation),
      `<today>${this.deps.today()}</today>`,
      this.host.workspaceBlock(),
      book,
      brief !== null && brief !== '' ? `<assignment>\n${brief}\n</assignment>` : '',
      `<request>\n${input}\n</request>`,
    ];
  }

  private budget(): SessionBudget {
    return this.deps.budget?.() ?? SessionBudget.ample();
  }

  /** 부서장 호출 설정을 돌려주는 함수. 한도가 빠듯하면 상위 모델 대신 sonnet을 쓰고, 이 함수를 쓰는 동안 한 번만 알린다. */
  private chiefPace(): () => MemberOptions {
    let noted = false;
    return () => {
      const budget = this.budget();
      if (!budget.saving) return {};
      if (!noted) {
        noted = true;
        this.deps.progress.step(`세션 한도를 ${Math.round(budget.percent)}% 썼어서 부서장도 sonnet으로 돌려요`);
      }
      return { tier: 'sonnet' };
    };
  }

  /** 부서 팀원 입력에 싣을 회사 장부 글. 읽지 못하면 없는 것으로 한다. */
  private async loadBook(): Promise<string> {
    try {
      return (await this.deps.company?.load())?.block() ?? '';
    } catch {
      return '';
    }
  }

  /** 부서의 결과를 요약해 장부에 남긴다. 읽지 못한 보고는 남기지 않고, 저장에 실패해도 대화는 막지 않는다. */
  private async record(department: DepartmentId, answer: string): Promise<void> {
    if (this.deps.company === undefined || answer.includes(UNREADABLE)) return;
    try {
      const book = (await this.deps.company.load()).with({ department, summary: CompanyBook.summaryOf(answer, HANDOFF_CHARS), at: new Date(this.deps.now()).toISOString() });
      await this.deps.company.save(book);
    } catch {
      // 장부는 다음 일을 돕는 참고라서, 남기지 못해도 이번 답은 그대로 보인다.
    }
  }
}
