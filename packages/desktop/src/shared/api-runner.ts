import type { CheckResult } from './api-after.js';

/**
 * 폴더 일괄 실행(Postman Collection Runner · APIdog 테스트 시나리오)의 결과. 요청을 순서대로 보냈고,
 * 각 요청의 After response 규칙(변수 저장·검증)이 그대로 돌아 앞 요청에서 저장한 값을 다음 요청이 쓴다.
 */
export interface RunStep {
  readonly id: string;
  readonly name: string;
  readonly method: string;
  /** 요청에 적힌 주소({{변수}} 그대로: 비밀이 들지 않게) */
  readonly url: string;
  /** 응답 상태(응답이 없으면 null) */
  readonly status: number | null;
  readonly ms: number;
  /** 보내지 못한 이유(빠진 변수, 연결 실패 등) */
  readonly error: string | null;
  readonly checks: readonly CheckResult[];
  /** 환경에 저장한 변수 이름 */
  readonly saved: readonly string[];
  /** 앞에서 멈춰(실패 시 멈춤·취소) 보내지 않았다 */
  readonly skipped: boolean;
}

export interface RunSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly ms: number;
}

export class RunReport {
  private constructor(
    readonly folder: string,
    readonly steps: readonly RunStep[],
    readonly at: string,
  ) {}

  static of(folder: string, steps: readonly RunStep[], at: string): RunReport {
    return new RunReport(folder, steps, at);
  }

  /** 한 요청이 통과했나: 검증이 있으면 모두 통과, 없으면 응답이 4xx·5xx 가 아님 */
  static passed(s: RunStep): boolean {
    if (s.skipped || s.error !== null || s.status === null) return false;
    return s.checks.length > 0 ? s.checks.every((c) => c.pass) : s.status < 400;
  }

  summary(): RunSummary {
    const skipped = this.steps.filter((s) => s.skipped).length;
    const passed = this.steps.filter((s) => RunReport.passed(s)).length;
    return { total: this.steps.length, passed, failed: this.steps.length - passed - skipped, skipped, ms: this.steps.reduce((a, s) => a + s.ms, 0) };
  }

  toMarkdown(): string {
    const s = this.summary();
    const head = s.failed === 0 && s.skipped === 0 ? `> ✅ **All ${s.passed} passed** — ${s.ms} ms` : `> ❌ **${s.failed} failed** · ${s.passed} passed${s.skipped > 0 ? ` · ${s.skipped} not run` : ''} — ${s.total} requests, ${s.ms} ms`;
    const out = [`# Run: ${this.folder}`, '', head, '', `Run at ${this.at}`, ''];
    const failed = this.steps.filter((x) => !x.skipped && !RunReport.passed(x));
    if (failed.length > 0) {
      out.push(`## Failed (${failed.length})`, '');
      for (const f of failed) {
        out.push(`### ${f.method} ${f.name}`, '', `\`${f.url}\` → ${f.status ?? 'no response'}${f.error !== null ? ` — ${f.error}` : ''}`, '');
        for (const c of f.checks.filter((c) => !c.pass)) out.push(`- ✗ ${c.label} — actual: ${c.actual}`);
        if (f.checks.length === 0 && f.status !== null) out.push(`- ✗ Status ${f.status} (no checks, so 4xx/5xx counts as failed)`);
        out.push('');
      }
    }
    out.push('## All requests', '', '| | Method | Name | Status | Time | Notes |', '| --- | --- | --- | --- | --- | --- |');
    for (const x of this.steps) {
      const mark = x.skipped ? '⏭️' : RunReport.passed(x) ? '✅' : '❌';
      const checks = x.checks.length > 0 ? `${x.checks.filter((c) => c.pass).length}/${x.checks.length} checks` : '';
      const saved = x.saved.length > 0 ? `saved ${x.saved.map((n) => `{{${n}}}`).join(', ')}` : '';
      const notes = [checks, saved, x.skipped ? 'not run' : ''].filter((t) => t !== '').join(' · ');
      out.push(`| ${mark} | ${x.method} | ${x.name.replace(/\|/g, '\\|')} | ${x.status ?? '—'} | ${x.ms} ms | ${notes} |`);
    }
    return `${out.join('\n')}\n`;
  }
}
