import { describe, expect, it } from 'vitest';
import { CoverageReport } from './coverage.js';

/** istanbul coverage-final.json 한 파일 몫: 문장 id → 시작 줄, 지나간 횟수 */
const file = (path: string, statements: [line: number, hits: number][]) => ({
  [path]: {
    path,
    statementMap: Object.fromEntries(statements.map(([line], i) => [String(i), { start: { line, column: 0 }, end: { line, column: 10 } }])),
    s: Object.fromEntries(statements.map(([, hits], i) => [String(i), hits])),
  },
});

describe('CoverageReport', () => {
  it('바뀐 파일만 골라 문장 몇 개 중 몇 개를 테스트가 지나갔는지와 안 지나간 줄을 뽑는다', () => {
    const json = { ...file('E:/w/app/src/money.ts', [[3, 2], [5, 0], [9, 1], [12, 0]]), ...file('E:/w/app/src/other.ts', [[1, 0]]) };
    const report = CoverageReport.fromIstanbul(json, 'E:/w/app', ['src/money.ts']);
    expect(report.files).toEqual([{ path: 'src/money.ts', covered: 2, total: 4, uncoveredLines: [5, 12] }]);
    expect(report.percent()).toBe(50);
  });

  it('경로 표기(\\, 대소문자, 상대 경로)가 달라도 같은 파일로 본다', () => {
    const json = file('e:\\w\\app\\SRC\\money.ts', [[3, 1]]);
    expect(CoverageReport.fromIstanbul(json, 'E:/w/app', ['src/money.ts']).files[0]).toMatchObject({ path: 'src/money.ts', covered: 1, total: 1 });
    expect(CoverageReport.fromIstanbul(file('src/money.ts', [[3, 1]]), 'E:/w/app', ['src/money.ts']).files).toHaveLength(1);
  });

  it('커버리지에 아예 없는 바뀐 파일은 "이 파일을 실행하는 테스트가 없음"으로 남긴다', () => {
    const report = CoverageReport.fromIstanbul({}, 'E:/w/app', ['src/new.ts']);
    expect(report.missing).toEqual(['src/new.ts']);
    expect(report.toBlock()).toContain('src/new.ts: 이 파일을 실행하는 테스트가 없음');
  });

  it('리뷰어에게 줄 묶음: 파일마다 비율과 안 지나간 줄(많으면 앞 20개만)', () => {
    const many: [number, number][] = Array.from({ length: 30 }, (_, i) => [i + 1, 0]);
    const report = CoverageReport.fromIstanbul({ ...file('E:/w/app/src/a.ts', [[1, 1], [2, 0]]), ...file('E:/w/app/src/b.ts', many) }, 'E:/w/app', ['src/a.ts', 'src/b.ts']);
    const block = report.toBlock();
    expect(block).toContain('<coverage>');
    expect(block).toContain('src/a.ts: 문장 1/2 (50%), 테스트가 닿지 않는 줄: 2');
    expect(block).toMatch(/src\/b\.ts: 문장 0\/30 \(0%\), 테스트가 닿지 않는 줄: 1, 2, .*20 외 10줄/);
  });

  it('깨진 내용은 던지지 않고 그 파일을 없는 것으로 본다', () => {
    const report = CoverageReport.fromIstanbul({ 'E:/w/app/src/a.ts': { statementMap: 'x', s: null } } as never, 'E:/w/app', ['src/a.ts']);
    expect(report.missing).toEqual(['src/a.ts']);
    expect(CoverageReport.fromIstanbul(null, 'E:/w/app', ['src/a.ts']).missing).toEqual(['src/a.ts']);
  });

  it('잴 파일이 없으면 빈 보고서(묶음 없음)', () => {
    expect(CoverageReport.fromIstanbul({}, 'E:/w/app', []).toBlock()).toBe('');
    expect(CoverageReport.fromIstanbul({}, 'E:/w/app', []).percent()).toBeNull();
  });
});
