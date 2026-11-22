import { describe, expect, it } from 'vitest';
import { AnalysisReportDto } from './analysis-report.dto.js';

describe('AnalysisReportDto', () => {
  it('살펴본 파일이 있어도 답 밑에 목록 꼬리를 붙이지 않고 답만 보인다', () => {
    const dto = AnalysisReportDto.read({ answer: '원인은 할인 계산 순서예요.', files: ['src/money.ts', ' src/cart.ts '] }, '디버깅');
    expect(dto.toAnswer()).toBe('원인은 할인 계산 순서예요.');
    expect(dto.files).toEqual(['src/money.ts', 'src/cart.ts']);
  });

  it('깨진 보고는 어떤 팀원의 보고인지 밝혀 읽지 못했다고 알린다', () => {
    expect(AnalysisReportDto.read(null, '위험 점검').toAnswer()).toContain('위험 점검');
    expect(AnalysisReportDto.read({ answer: '  ', files: [3] }, '위험 점검').toAnswer()).toContain('읽지 못했어요');
  });
});
