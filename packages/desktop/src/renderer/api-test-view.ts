import type { ApiApi } from '../shared/api-ipc.js';
import type { ApiRequestProps } from '../shared/api-request.js';
import type { CaseCategory } from '../shared/api-test.js';
import type { CaseView, PlanView, ReportRow, ReportView } from '../shared/api-test-dto.js';
import { el } from './dom.js';
import { methodBadge } from './api-parts.js';
import { button, confirmDialog } from './todo-parts.js';

/** 분류마다 칩 색(같은 분류는 미리보기·리포트에서 같은 색) */
const CATEGORY_CHIP: Readonly<Record<CaseCategory, string>> = { happy: 'green', validation: 'blue', auth: 'purple', data: 'yellow', list: 'blue', security: 'red', concurrency: 'purple' };
const OUTCOME_CHIP = { pass: ['green', 'Pass'], fail: ['red', 'Fail'], error: ['yellow', 'Not run'] } as const;

/** 상태 코드 색: 2xx 초록, 3xx 파랑, 4xx 노랑, 5xx·응답 없음 빨강 */
export const statusChip = (s: number | null): string => (s === null || s >= 500 ? 'red' : s >= 400 ? 'yellow' : s >= 300 ? 'blue' : s >= 200 ? 'green' : 'blue');

export interface TestPanelDeps {
  readonly api: ApiApi['tests'];
  readonly say: (text: string) => void;
  /** 채팅으로 보내기(고쳐 달라고 맡기기) */
  readonly toChat?: (text: string) => void;
  /** 패널을 닫았다(응답 칸으로 돌아간다) */
  readonly closed: () => void;
}

/**
 * AI API 시험 칸: 케이스 만들기(모델 1번) → 미리보기(고르기·확인) → 실행(로컬 서버, 모델 없음) → 리포트(실패면 수정 제안 1번).
 * 화면은 비밀 값을 모른다(요청은 {{변수}} 이름 그대로 보인다).
 */
export function buildTestPanel(deps: TestPanelDeps) {
  const root = el('div', 'api-test');
  let plan: PlanView | null = null;
  let picked = new Set<string>();
  let lastStart: { requestId: string; request: ApiRequestProps } | null = null;

  const head = (title: string, ...extra: HTMLElement[]): HTMLElement => {
    const h = el('div', 'bar api-test-head');
    const close = button('×', 'btn icon sm ghost', () => deps.closed());
    close.title = 'Close the AI test';
    close.setAttribute('aria-label', 'Close the AI test');
    h.append(el('b', 'api-test-title', title), el('span', 'grow'), ...extra, close);
    return h;
  };

  const waiting = (title: string, note: string): void => {
    const box = el('div', 'empty-state api-test-wait');
    box.append(el('b', undefined, title), el('span', 'dim', note));
    root.replaceChildren(head('AI test'), box);
  };

  const failed = (error: string): void => {
    const box = el('div', 'empty-state failed api-test-wait');
    box.append(el('b', undefined, 'AI test stopped'), el('span', 'dim', error));
    if (lastStart !== null) box.append(button('Try again', 'btn', () => void start(lastStart!.requestId, lastStart!.request)));
    root.replaceChildren(head('AI test'), box);
  };

  // ── 미리보기 ──

  const caseRow = (c: CaseView): HTMLElement => {
    const row = el('label', `api-case${c.risky ? ' risky' : ''}`);
    const box = el('input');
    box.type = 'checkbox';
    box.checked = picked.has(c.id);
    box.setAttribute('aria-label', `Run ${c.title}`);
    box.addEventListener('change', () => {
      if (box.checked) picked.add(c.id);
      else picked.delete(c.id);
      paintRunButton();
    });
    const text = el('div', 'api-case-text');
    const top = el('div', 'api-case-top');
    top.append(el('span', `chip ${CATEGORY_CHIP[c.category]}`, c.categoryLabel), el('span', 'api-case-title', c.title));
    if (c.risky) top.append(el('span', `chip ${c.request.method === 'DELETE' ? 'red' : 'yellow'}`, c.request.method === 'DELETE' ? 'Deletes data' : 'Changes data'));
    if (c.repeat > 1) top.append(el('span', 'chip', `×${c.repeat} in a row`));
    if (c.parallel > 1) top.append(el('span', 'chip', `${c.parallel} at once`));
    const req = el('div', 'api-case-req mono');
    req.append(methodBadge(c.request.method), el('span', 'api-case-url', `${c.request.url}${c.request.query === '' ? '' : `?${c.request.query}`}`));
    if (c.request.auth !== 'default') req.append(el('span', 'chip yellow', c.request.auth === 'none' ? 'No token' : 'Bad token'));
    text.append(top, req);
    if (c.request.body !== null) text.append(el('div', 'api-case-body mono', c.request.body.length > 240 ? `${c.request.body.slice(0, 240)}…` : c.request.body));
    const expect = el('div', 'api-case-expect');
    expect.append(el('span', 'dim', 'Expect'), ...c.statuses.map((s) => el('span', `chip ${statusChip(s)}`, String(s))));
    if (c.expectNote !== '') expect.append(el('span', 'dim api-case-note', c.expectNote));
    text.append(expect);
    if (c.evidence !== '') text.append(el('div', 'api-case-evidence mono', c.evidence));
    row.append(box, text);
    return row;
  };

  let runBtn: HTMLButtonElement | null = null;
  const paintRunButton = (): void => {
    if (runBtn === null) return;
    runBtn.textContent = `Run ${picked.size} ${picked.size === 1 ? 'case' : 'cases'}`;
    runBtn.disabled = picked.size === 0;
  };

  const paintPlan = (p: PlanView): void => {
    plan = p;
    picked = new Set(p.cases.map((c) => c.id));
    runBtn = button('Run cases', 'btn run api-test-run', () => void run());
    runBtn.setAttribute('data-repeat-ok', '');
    paintRunButton();
    const all = button('All', 'btn sm', () => ((picked = new Set(p.cases.map((c) => c.id))), paintPlan2()));
    const none = button('None', 'btn sm', () => ((picked = new Set()), paintPlan2()));
    const safe = button('Read-only only', 'btn sm', () => ((picked = new Set(p.cases.filter((c) => !c.risky).map((c) => c.id))), paintPlan2()));
    safe.title = 'Pick only the cases that do not change data';
    const paintPlan2 = (): void => {
      list.replaceChildren(...p.cases.map(caseRow));
      paintRunButton();
    };
    const counts = el('div', 'bar api-test-counts');
    const byCat = new Map<CaseCategory, number>();
    for (const c of p.cases) byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
    for (const c of p.cases) if (byCat.has(c.category)) {
      counts.append(el('span', `chip ${CATEGORY_CHIP[c.category]}`, `${c.categoryLabel} ${byCat.get(c.category)}`));
      byCat.delete(c.category);
    }
    const risky = p.cases.filter((c) => c.risky).length;
    counts.append(el('span', 'grow'), el('span', 'dim', `${p.cases.length} cases${risky > 0 ? ` · ${risky} change data` : ''}`));
    const tools = el('div', 'bar api-test-tools');
    tools.append(el('span', 'dim', 'Pick'), all, none, safe, el('span', 'grow'), runBtn);
    const list = el('div', 'api-case-list');
    list.replaceChildren(...p.cases.map(caseRow));
    const parts: HTMLElement[] = [head(`AI test cases · ${p.label}`), counts, tools, list];
    if (p.notes.trim() !== '') parts.push(el('div', 'hint api-test-notes', p.notes));
    root.replaceChildren(...parts);
  };

  // ── 리포트 ──

  const reportRow = (r: ReportRow): HTMLElement => {
    const row = el('div', `api-result ${r.outcome}`);
    const line = el('button', 'api-result-line');
    line.type = 'button';
    const [chipColor, label] = OUTCOME_CHIP[r.outcome];
    line.append(el('span', `chip ${chipColor}`, label), el('span', `chip ${CATEGORY_CHIP[r.category]}`, r.categoryLabel), el('span', 'api-result-title', r.title));
    const codes = el('span', 'api-result-codes');
    codes.append(el('span', 'dim', 'want'), ...r.expected.map((s) => el('span', `chip ${statusChip(s)}`, String(s))), el('span', 'dim', 'got'), ...(r.actual.length === 0 ? [el('span', 'chip red', '—')] : r.actual.map((s) => el('span', `chip ${statusChip(s)}`, s === null ? 'none' : String(s)))));
    line.append(codes, el('span', `api-ms${r.slow ? ' slow' : ''}`, `${r.ms} ms`));
    const detail = el('div', 'api-result-detail');
    detail.hidden = r.outcome === 'pass';
    line.setAttribute('aria-expanded', String(!detail.hidden));
    line.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      line.setAttribute('aria-expanded', String(!detail.hidden));
    });
    detail.append(el('div', 'api-result-reason', r.reason), el('div', 'mono dim api-result-sent', r.sent));
    if (r.evidence !== '') detail.append(el('div', 'mono api-case-evidence', `Evidence: ${r.evidence}`));
    if (r.fix !== null) {
      const fix = el('div', 'api-fix');
      fix.append(el('b', undefined, 'How to fix'), el('div', undefined, r.fix.cause));
      if (r.fix.where !== '') fix.append(el('div', 'mono api-fix-where', r.fix.where));
      fix.append(el('div', undefined, r.fix.fix));
      detail.append(fix);
    }
    if (r.excerpt !== '') detail.append(el('pre', 'api-code mono api-result-body', r.excerpt));
    if (r.fixRequest !== null && deps.toChat !== undefined) {
      const text = r.fixRequest;
      detail.append(button('Ask the team to fix this', 'btn sm', () => deps.toChat?.(text)));
    }
    row.append(line, detail);
    return row;
  };

  const paintReport = (v: ReportView): void => {
    const sum = el('div', 'bar api-test-counts');
    sum.append(el('span', 'chip green', `${v.counts.pass} passed`), el('span', `chip ${v.counts.fail > 0 ? 'red' : 'green'}`, `${v.counts.fail} failed`));
    if (v.counts.error > 0) sum.append(el('span', 'chip yellow', `${v.counts.error} not run`));
    const meter = el('div', 'api-meter');
    meter.setAttribute('role', 'img');
    meter.setAttribute('aria-label', `${v.counts.pass} of ${v.counts.total} passed`);
    for (const [cls, n] of [['pass', v.counts.pass], ['fail', v.counts.fail], ['error', v.counts.error]] as const) {
      if (n === 0) continue;
      const part = el('span', `api-meter-part ${cls}`);
      part.style.flexGrow = String(n);
      meter.append(part);
    }
    sum.append(meter);
    const tools = el('div', 'bar api-test-tools');
    if (v.fixRequest !== null && deps.toChat !== undefined) {
      const text = v.fixRequest;
      tools.append(button('Ask the team to fix all', 'btn primary', () => deps.toChat?.(text)));
    }
    tools.append(
      button('Save report (.md)', 'btn', async () => {
        const r = await deps.api.save(v.planId);
        deps.say(!r.ok ? r.error : r.saved === null ? 'Save cancelled.' : `Saved ${r.saved}.`);
      }),
      el('span', 'grow'),
      button('Back to cases', 'btn', () => (plan !== null ? paintPlan(plan) : undefined)),
    );
    const list = el('div', 'api-case-list');
    list.append(...v.rows.map(reportRow));
    const parts: HTMLElement[] = [head(`AI test report · ${v.label}`), sum];
    if (v.summary !== '') parts.push(el('div', 'api-test-summary', v.summary));
    parts.push(tools, list);
    root.replaceChildren(...parts);
  };

  // ── 흐름 ──

  async function start(requestId: string, request: ApiRequestProps): Promise<void> {
    lastStart = { requestId, request };
    waiting('Reading the code and making test cases…', 'One AI call. Controllers, DTOs, services and guards are read; secret values are not sent.');
    const r = await deps.api.plan({ requestId, request });
    if (!r.ok) return failed(r.error);
    paintPlan(r.plan);
  }

  async function run(): Promise<void> {
    if (plan === null || picked.size === 0) return;
    const p = plan;
    const ids = p.cases.filter((c) => picked.has(c.id)).map((c) => c.id);
    const risky = p.cases.filter((c) => picked.has(c.id) && c.risky);
    const go = async (confirmed: boolean): Promise<void> => {
      waiting(`Running ${ids.length} ${ids.length === 1 ? 'case' : 'cases'} on your local server…`, 'Requests go to this computer only. If some fail, the AI suggests fixes (one more call).');
      const r = await deps.api.run({ planId: p.id, caseIds: ids, confirmed });
      if (!r.ok) return failed(r.error);
      paintReport(r.report);
    };
    if (risky.length === 0) return go(false);
    confirmDialog(
      'Run cases that change data?',
      `${risky.length} of the picked cases create, change or delete data on your local server${risky.some((c) => c.request.method === 'DELETE') ? ' (including DELETE)' : ''}. Use a local or test database.`,
      [{ label: 'Run them', cls: 'btn danger', pick: () => void go(true) }],
    );
  }

  return { root, start };
}
