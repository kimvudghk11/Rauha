import type { RunFolderResult } from '../shared/api-ipc.js';
import { RunReport } from '../shared/api-runner.js';
import { el } from './dom.js';
import { methodBadge } from './api-parts.js';
import { button } from './todo-parts.js';

export interface RunPanelDeps {
  copy(text: string): Promise<boolean>;
  say(text: string): void;
  cancel(): void;
  close(): void;
  /** 결과 줄을 누르면 그 요청을 연다 */
  open(id: string): void;
}

/** 폴더 일괄 실행 칸: 실행 중(취소) → 결과(요약·실패 먼저·줄마다 상태·검증·저장한 변수) */
export function buildRunPanel(deps: RunPanelDeps) {
  const root = el('div', 'api-run');

  const running = (folder: string, count: number): void => {
    const box = el('div', 'empty-state api-res-empty');
    box.append(el('span', 'api-test-spin'), el('b', undefined, `Running ${folder}…`), el('span', 'dim', `${count} request${count === 1 ? '' : 's'}, top to bottom. Variables saved by one request are used by the next.`), button('Stop', 'btn danger', () => deps.cancel()));
    root.replaceChildren(box);
  };

  const show = (r: RunFolderResult): void => {
    if (!r.ok) {
      const box = el('div', 'empty-state api-res-empty failed');
      box.append(el('b', undefined, 'Could not run the folder'), el('span', 'dim', r.error), button('Close', 'btn', () => deps.close()));
      root.replaceChildren(box);
      return;
    }
    const s = r.summary;
    const head = el('div', 'bar api-res-head');
    const allOk = s.failed === 0 && s.skipped === 0;
    head.append(
      el('b', undefined, `Run: ${r.report.folder}`),
      el('span', `chip ${allOk ? 'green' : 'red'}`, allOk ? `All ${s.passed} passed` : `${s.failed} failed · ${s.passed} passed${s.skipped > 0 ? ` · ${s.skipped} not run` : ''}`),
      el('span', 'dim', `${s.ms} ms`),
      el('span', 'grow'),
      button('Copy report', 'btn sm', async () => deps.say((await deps.copy(r.markdown)) ? 'Copied the run report (Markdown).' : 'Could not copy to the clipboard.')),
      button('Close', 'btn sm', () => deps.close()),
    );
    const list = el('div', 'api-run-list');
    // 실패를 먼저, 그다음 통과, 건너뜀은 끝에
    const order = (x: (typeof r.report.steps)[number]): number => (x.skipped ? 2 : RunReport.passed(x) ? 1 : 0);
    for (const step of [...r.report.steps].sort((a, b) => order(a) - order(b))) {
      const ok = RunReport.passed(step);
      const row = el('div', `api-run-row ${step.skipped ? 'skipped' : ok ? 'pass' : 'fail'}`);
      row.tabIndex = 0;
      row.title = 'Open this request';
      row.addEventListener('click', () => deps.open(step.id));
      const line = el('div', 'bar');
      line.append(
        el('span', 'api-check-mark', step.skipped ? '⏭' : ok ? '✓' : '✗'),
        methodBadge(step.method),
        el('span', 'api-name grow', step.name),
        el('span', `chip ${step.status === null ? '' : step.status >= 400 ? 'red' : 'green'}`, step.skipped ? 'not run' : step.status === null ? 'no response' : String(step.status)),
        el('span', 'dim', `${step.ms} ms`),
      );
      row.append(line);
      const notes: string[] = [];
      if (step.error !== null) notes.push(step.error);
      for (const c of step.checks.filter((c) => !c.pass)) notes.push(`✗ ${c.label} — actual: ${c.actual}`);
      if (step.checks.length > 0 && step.checks.every((c) => c.pass)) notes.push(`${step.checks.length} check${step.checks.length === 1 ? '' : 's'} passed`);
      if (step.saved.length > 0) notes.push(`saved ${step.saved.map((n) => `{{${n}}}`).join(', ')}`);
      if (!step.skipped && step.checks.length === 0 && step.status !== null && step.status >= 400) notes.push('No checks, so a 4xx/5xx status counts as failed. Add checks in After response.');
      for (const n of notes) row.append(el('div', 'hint mono api-run-note', n));
      list.append(row);
    }
    root.replaceChildren(head, list);
  };

  return { root, running, show };
}
