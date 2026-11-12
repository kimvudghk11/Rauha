import { describe, expect, it } from 'vitest';
import { PublishReportDto } from './publish-report.dto.js';

describe('PublishReportDto', () => {
  it('보고 뒤에 실행한 git·gh 명령을 ■ 제목 아래 목록으로 붙인다', () => {
    const report = PublishReportDto.read({ answer: '커밋하고 PR을 열었어요: https://github.com/a/b/pull/3', commands: ['git commit -m x -- a.ts', ' gh pr create --fill '], finished: true });
    expect(report.finished).toBe(true);
    expect(report.toAnswer()).toBe('커밋하고 PR을 열었어요: https://github.com/a/b/pull/3\n\n■ 실행한 명령\n- git commit -m x -- a.ts\n- gh pr create --fill');
  });

  it('막혔다고 보고하면 끝내지 못한 것으로 본다', () => {
    const report = PublishReportDto.read({ answer: 'gh 로그인이 안 돼 있어 PR을 못 열었어요.', commands: ['gh auth status'], finished: false });
    expect(report.finished).toBe(false);
  });

  it('깨진 보고는 끝내지 못한 것으로 보고, 읽지 못했다고 알린다', () => {
    const report = PublishReportDto.read(null);
    expect(report.finished).toBe(false);
    expect(report.toAnswer()).toContain('읽지 못했어요');
    expect(PublishReportDto.read({ answer: '했어요', commands: [], finished: 'yes' }).finished).toBe(false);
  });
});
