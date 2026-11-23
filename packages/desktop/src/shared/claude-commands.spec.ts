import { describe, expect, it } from 'vitest';
import { claudeCommandPath, expandClaudeCommand } from './claude-commands.js';

describe('Claude Code 명령(~/.claude/commands) 쓰기', () => {
  it('/이름 은 이름.md, /폴더:이름 은 폴더/이름.md 다', () => {
    expect(claudeCommandPath('review-pr')).toBe('review-pr.md');
    expect(claudeCommandPath('backend:api-check')).toBe('backend/api-check.md');
  });

  it('경로를 벗어나거나 이상한 이름은 명령 파일로 보지 않는다', () => {
    for (const bad of ['../x', 'a/b', 'a\\b', '', ':x', 'x:', 'a b', '.hidden']) expect(claudeCommandPath(bad), bad).toBeNull();
  });

  it('앞머리(---)를 떼고 $ARGUMENTS·$1… 에 친 글을 넣는다', () => {
    const body = '---\ndescription: API 점검\nargument-hint: <서비스>\n---\n$1 서비스의 API 를 규칙대로 점검해줘. 전체 요청: $ARGUMENTS';
    expect(expandClaudeCommand(body, 'payment 결제 타임아웃')).toBe('payment 서비스의 API 를 규칙대로 점검해줘. 전체 요청: payment 결제 타임아웃');
  });

  it('$ARGUMENTS 가 없는 명령에 글을 치면 끝에 덧붙인다', () => {
    expect(expandClaudeCommand('규칙대로 리뷰해줘', '결제 모듈만')).toBe('규칙대로 리뷰해줘\n\n결제 모듈만');
    expect(expandClaudeCommand('규칙대로 리뷰해줘', '')).toBe('규칙대로 리뷰해줘');
  });
});
