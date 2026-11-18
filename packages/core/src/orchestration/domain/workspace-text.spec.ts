import { describe, expect, it } from 'vitest';
import { WorkspaceText, type RepoState } from './workspace-text.js';

const state = (name: string, more: Partial<RepoState> = {}): RepoState => ({ name, root: `E:/w/${name}`, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, changed: [], stashes: 0, branches: [], ...more });

describe('작업 공간 도구 글', () => {
  it('상태: 할 것이 있는 저장소는 자세히, 깨끗한 저장소는 이름만 모아 빠짐없이 보인다', () => {
    const text = WorkspaceText.status([state('shop', { ahead: 2, changed: [' M src/a.ts'] }), state('admin'), state('blog')]);
    expect(text).toContain('저장소 3개 상태');
    expect(text).toContain('push 안 한 커밋 2개, 커밋 안 한 파일 1개');
    expect(text).toContain('  M src/a.ts');
    expect(text).toContain('깨끗한 저장소 2개(push·pull·커밋할 것 없음): admin, blog');
  });

  it('상태: 커밋 안 한 파일이 많으면 앞의 것만 보이고 몇 개 더 있는지 적는다', () => {
    const changed = Array.from({ length: 25 }, (_, i) => `?? f${i}`);
    expect(WorkspaceText.status([state('a', { changed })])).toContain('…(5개 더)');
  });

  it('검색: 저장소/경로:줄 로 보이고, 넘치면 넘친 줄 수와 좁히는 법을 적는다', () => {
    const hits = Array.from({ length: 3 }, (_, i) => ({ repo: i === 2 ? 'b' : 'a', path: 'src/x.ts', line: i + 1, text: `  refund(${i})` }));
    const text = WorkspaceText.hits('refund', hits, 5, 2);
    expect(text).toContain('저장소 5개 중 2개에서 3줄 찾음(a, b)');
    expect(text).toContain('a/src/x.ts:1: refund(0)');
    expect(text).toContain('…(1줄 더 있음');
  });

  it('검색: 못 찾으면 몇 개 저장소에서 찾았는지 알린다', () => {
    expect(WorkspaceText.hits('zzz', [], 4, 100)).toBe('저장소 4개에서 "zzz"을(를) 찾지 못했어요.');
  });

  it('CI: 저장소별 실행과, GitHub 이 아닌 저장소·로그인 없음을 적는다', () => {
    const text = WorkspaceText.ci([{ repo: 'shop', id: 7, workflow: 'ci', title: '결제', branch: 'main', sha: 'abcdef123', verdict: 'failure', startedAt: '2026-11-18 10:00', url: '' }], ['local-only'], false);
    expect(text).toContain('- ✗ failure #7 ci · main · abcdef1');
    expect(text).toContain('GitHub 저장소가 아니라 보지 못함: local-only');
    expect(text).toContain('로그인이 없어');
  });

  it('커밋 보기: 길면 앞부분만 싣고 줄인 양을 적는다', () => {
    expect(WorkspaceText.commit('a', 'x'.repeat(13_000))).toContain('1000자 생략');
  });
});
