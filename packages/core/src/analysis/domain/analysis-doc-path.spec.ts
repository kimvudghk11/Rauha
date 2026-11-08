import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { AnalysisDocPath, AnalysisFolder } from './analysis-doc-path.js';

describe('AnalysisFolder', () => {
  it('저장소에 분석 문서 폴더가 이미 있으면 그 방식을 따른다', () => {
    expect(AnalysisFolder.choose(['docs', 'docs/investigations'])).toBe('docs/investigations');
    expect(AnalysisFolder.choose(['docs/analyses'])).toBe('docs/analyses');
  });

  it('여럿이면 docs/analysis를 먼저 쓰고, 없으면 docs/analysis를 새로 만든다', () => {
    expect(AnalysisFolder.choose(['docs/investigations', 'docs/analysis'])).toBe('docs/analysis');
    expect(AnalysisFolder.choose([])).toBe('docs/analysis');
  });

  it('윈도우 경로 구분자로 들어와도 같게 본다', () => {
    expect(AnalysisFolder.choose([String.raw`docs\analyses`])).toBe('docs/analyses');
  });
});

describe('AnalysisDocPath', () => {
  const none = () => false;

  it('날짜-주제.md 이름을 만든다', () => {
    expect(AnalysisDocPath.plan({ folder: 'docs/analysis', date: '2026-11-08', topic: '결제가 왜 두 번 깎여?', isTaken: none })).toBe('docs/analysis/2026-11-08-결제가-왜-두-번-깎여.md');
  });

  it('주제가 40자를 넘으면 자르고, 기호만 있으면 analysis로 한다', () => {
    const long = AnalysisDocPath.plan({ folder: 'docs/analysis', date: '2026-11-08', topic: 'a'.repeat(100), isTaken: none });
    expect(long).toBe(`docs/analysis/2026-11-08-${'a'.repeat(40)}.md`);
    expect(AnalysisDocPath.plan({ folder: 'docs/analysis', date: '2026-11-08', topic: '???', isTaken: none })).toBe('docs/analysis/2026-11-08-analysis.md');
  });

  it('같은 이름이 이미 있으면 덮어쓰지 않고 -2, -3을 붙인다', () => {
    const taken = new Set(['docs/analysis/2026-11-08-결제.md', 'docs/analysis/2026-11-08-결제-2.md']);
    expect(AnalysisDocPath.plan({ folder: 'docs/analysis', date: '2026-11-08', topic: '결제', isTaken: (p) => taken.has(p) })).toBe('docs/analysis/2026-11-08-결제-3.md');
  });

  it('이름을 99번 넘게 바꿔도 겹치면 거절한다', () => {
    expect(() => AnalysisDocPath.plan({ folder: 'docs/analysis', date: '2026-11-08', topic: 'x', isTaken: () => true })).toThrow(DomainError);
  });

  it('쓸 수 있는 곳은 docs 아래 마크다운뿐이다', () => {
    expect(() => AnalysisDocPath.assertWritable('docs/analysis/a.md')).not.toThrow();
    expect(() => AnalysisDocPath.assertWritable('src/a.md')).toThrow(DomainError);
    expect(() => AnalysisDocPath.assertWritable('docs/analysis/a.ts')).toThrow(DomainError);
    expect(() => AnalysisDocPath.assertWritable('docs/../src/a.md')).toThrow(DomainError);
    expect(() => AnalysisDocPath.assertWritable('/etc/docs/a.md')).toThrow(DomainError);
    expect(() => AnalysisDocPath.assertWritable('C:/docs/a.md')).toThrow(DomainError);
  });
});
