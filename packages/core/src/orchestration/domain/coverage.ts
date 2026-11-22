/** 바뀐 파일 하나의 줄 커버리지(문장 기준) */
export interface FileCoverage {
  readonly path: string;
  readonly covered: number;
  readonly total: number;
  /** 테스트가 한 번도 지나가지 않은 문장의 시작 줄(작은 순, 겹치지 않게) */
  readonly uncoveredLines: readonly number[];
}

/** 리뷰어 묶음에 보일 안 지나간 줄 수 상한 */
const LINES_SHOWN = 20;

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * rauha 가 직접 잰 바뀐 파일의 커버리지(istanbul coverage-final.json: vitest·jest 공통). 리뷰어가 "테스트가 닿지 않는 바뀐 줄"을 근거로 짚게 한다.
 * 파일은 읽지 않는 순수 규칙이다. 모양이 틀린 항목은 던지지 않고 그 파일을 없는 것으로 본다.
 */
export class CoverageReport {
  private constructor(
    readonly files: readonly FileCoverage[],
    /** 커버리지에 아예 없는 바뀐 파일(이 파일을 실행하는 테스트가 없음) */
    readonly missing: readonly string[],
  ) {}

  static fromIstanbul(json: unknown, root: string, wanted: readonly string[]): CoverageReport {
    const base = norm(root);
    const byPath = new Map<string, Obj>();
    if (isObj(json)) {
      for (const [key, value] of Object.entries(json)) {
        if (!isObj(value)) continue;
        const p = norm(typeof value['path'] === 'string' ? value['path'] : key);
        byPath.set(p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p, value);
      }
    }
    const files: FileCoverage[] = [];
    const missing: string[] = [];
    for (const path of wanted) {
      const entry = byPath.get(norm(path));
      const read = entry === undefined ? null : CoverageReport.read(path, entry);
      if (read === null) missing.push(path);
      else files.push(read);
    }
    return new CoverageReport(files, missing);
  }

  private static read(path: string, entry: Obj): FileCoverage | null {
    const map = entry['statementMap'];
    const hits = entry['s'];
    if (!isObj(map) || !isObj(hits)) return null;
    let covered = 0;
    let total = 0;
    const uncovered = new Set<number>();
    for (const [id, loc] of Object.entries(map)) {
      const count = hits[id];
      const line = isObj(loc) && isObj(loc['start']) && typeof loc['start']['line'] === 'number' ? loc['start']['line'] : null;
      if (typeof count !== 'number' || line === null) continue;
      total += 1;
      if (count > 0) covered += 1;
      else uncovered.add(line);
    }
    return { path, covered, total, uncoveredLines: [...uncovered].sort((a, b) => a - b) };
  }

  /** 패키지마다 잰 보고서를 하나로 */
  static combine(reports: readonly CoverageReport[]): CoverageReport {
    return new CoverageReport(
      reports.flatMap((r) => r.files),
      reports.flatMap((r) => r.missing),
    );
  }

  /** 바뀐 파일 전체의 문장 커버리지(%). 잴 문장이 없으면 null */
  percent(): number | null {
    const total = this.files.reduce((n, f) => n + f.total, 0);
    if (total === 0) return null;
    return Math.round((this.files.reduce((n, f) => n + f.covered, 0) / total) * 100);
  }

  /** 리뷰어에게 줄 묶음. 잰 파일이 하나도 없으면 빈 글 */
  toBlock(): string {
    if (this.files.length === 0 && this.missing.length === 0) return '';
    const lines = [
      ...this.files.map((f) => {
        const pct = f.total === 0 ? 100 : Math.round((f.covered / f.total) * 100);
        const shown = f.uncoveredLines.slice(0, LINES_SHOWN).join(', ');
        const more = f.uncoveredLines.length > LINES_SHOWN ? ` 외 ${f.uncoveredLines.length - LINES_SHOWN}줄` : '';
        return `- ${f.path}: 문장 ${f.covered}/${f.total} (${pct}%)${f.uncoveredLines.length > 0 ? `, 테스트가 닿지 않는 줄: ${shown}${more}` : ''}`;
      }),
      ...this.missing.map((p) => `- ${p}: 이 파일을 실행하는 테스트가 없음`),
    ];
    return `<coverage>\nrauha 가 바뀐 파일과 관련된 테스트를 직접 돌려 잰 커버리지입니다.\n${lines.join('\n')}\n</coverage>`;
  }
}
