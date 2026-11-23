import { describe, expect, it } from 'vitest';
import { claudeMdImports, expandClaudeMd } from './claude-md.js';

const HOME = '/Users/me';

describe('~/.claude/CLAUDE.md 의 @import', () => {
  it('@경로 줄을 import 로 읽는다(~ · 절대 · 상대 경로)', () => {
    const text = '# 회사 규칙\n@~/repos/backend-engineering-rules/RULES.md\n내 메모 @./notes/a.md 도 봐\n@/opt/rules/B.md';
    expect(claudeMdImports(text)).toEqual(['~/repos/backend-engineering-rules/RULES.md', './notes/a.md', '/opt/rules/B.md']);
  });

  it('메일 주소·코드 블록·인라인 코드 안의 @ 는 import 가 아니다', () => {
    const text = 'me@corp.com 로 연락\n```\n@~/not/this.md\n```\n`@~/nor/this.md` 그리고 @user 멘션';
    expect(claudeMdImports(text)).toEqual([]);
  });

  it('import 한 파일 내용을 출처와 함께 이어 붙이고, 그 안의 import 도 따라간다(깊이 한도 안에서)', () => {
    const files: Record<string, string> = {
      '/Users/me/.claude/CLAUDE.md': '기본 규칙\n@~/repos/rules/RULES.md',
      '/Users/me/repos/rules/RULES.md': 'DDD 로 짠다\n@./more/TESTS.md',
      '/Users/me/repos/rules/more/TESTS.md': '테스트 먼저',
    };
    const out = expandClaudeMd('/Users/me/.claude/CLAUDE.md', (p) => files[p] ?? null, HOME);
    expect(out.files).toEqual(['/Users/me/.claude/CLAUDE.md', '/Users/me/repos/rules/RULES.md', '/Users/me/repos/rules/more/TESTS.md']);
    expect(out.text).toContain('기본 규칙');
    expect(out.text).toContain('DDD 로 짠다');
    expect(out.text).toContain('테스트 먼저');
    expect(out.text).toContain('/Users/me/repos/rules/RULES.md');
  });

  it('같은 파일을 두 번 import 해도(서로 가리켜도) 한 번만 읽는다', () => {
    const files: Record<string, string> = { '/a/A.md': '@/a/B.md', '/a/B.md': '@/a/A.md' };
    expect(expandClaudeMd('/a/A.md', (p) => files[p] ?? null, HOME).files).toEqual(['/a/A.md', '/a/B.md']);
  });

  it('비밀 파일·글이 아닌 파일은 import 해도 읽지 않는다', () => {
    const read: string[] = [];
    expandClaudeMd('/a/CLAUDE.md', (p) => (read.push(p), p === '/a/CLAUDE.md' ? '@/a/.env\n@~/.claude/.credentials.json\n@/a/logo.png\n@/a/ok.md' : 'ok'), HOME);
    expect(read).toEqual(['/a/CLAUDE.md', '/a/ok.md']);
  });

  it('없는 파일이면 빈 결과, 전체 글은 한도에서 자른다', () => {
    expect(expandClaudeMd('/none.md', () => null, HOME)).toEqual({ text: '', files: [] });
    expect(expandClaudeMd('/a.md', () => 'x'.repeat(100), HOME, 50).text.length).toBeLessThanOrEqual(80);
  });

  it('Windows 경로도 같은 규칙으로 푼다', () => {
    const files: Record<string, string> = { 'C:/Users/me/.claude/CLAUDE.md': '@~/repos/r/RULES.md', 'C:/Users/me/repos/r/RULES.md': '규칙' };
    expect(expandClaudeMd('C:/Users/me/.claude/CLAUDE.md', (p) => files[p] ?? null, 'C:/Users/me').files).toEqual(['C:/Users/me/.claude/CLAUDE.md', 'C:/Users/me/repos/r/RULES.md']);
  });
});
