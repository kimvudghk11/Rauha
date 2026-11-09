import { describe, expect, it } from 'vitest';
import { repoNodeMark, repoNodeText, syncText } from './repo-node.js';

describe('syncText', () => {
  it('앞섬·뒤처짐을 화살표로 쓴다', () => {
    expect(syncText(2, 1)).toBe('↑2 ↓1');
    expect(syncText(0, 3)).toBe('↓3');
    expect(syncText(4, 0)).toBe('↑4');
  });

  it('같으면 같다고, 원격이 없으면 없다고 쓴다', () => {
    expect(syncText(0, 0)).toBe('원격과 같음');
    expect(syncText(null, null)).toBe('원격 없음');
  });
});

describe('탐색기 레포 노드 글', () => {
  const row = (over: Partial<{ kind: 'repo' | 'docs' | 'other'; status: { branch: string | null; ahead: number | null; behind: number | null; changed: number } | null; working: number; worktrees: number }> = {}) => ({
    name: 'api',
    kind: 'repo' as const,
    status: { branch: 'main', ahead: 1, behind: 2, changed: 3 },
    working: 0,
    worktrees: 0,
    ...over,
  });

  it('브랜치·앞섬뒤처짐·바뀐 파일 수를 글로 만든다', () => {
    expect(repoNodeText(row())).toMatchObject({ branch: 'main', sync: '↑1 ↓2', changed: '변경 3', working: null });
  });
  it('깨끗하면 "깨끗함", 원격이 없으면 sync는 "원격 없음"이다', () => {
    expect(repoNodeText(row({ status: { branch: 'dev', ahead: null, behind: null, changed: 0 } }))).toMatchObject({ sync: '원격 없음', changed: '깨끗함' });
  });
  it('분리된 HEAD는 그렇게 쓴다', () => {
    expect(repoNodeText(row({ status: { branch: null, ahead: 0, behind: 0, changed: 0 } })).branch).toBe('(분리된 HEAD)');
  });
  it('git 상태를 못 읽으면 모른다고 쓴다(지어내지 않는다)', () => {
    expect(repoNodeText(row({ status: null }))).toMatchObject({ branch: '모름', sync: '모름', changed: '모름' });
  });
  it('문서 폴더는 git 정보 없이 "문서 폴더"만 쓴다', () => {
    expect(repoNodeText(row({ kind: 'docs', status: null }))).toMatchObject({ branch: '', sync: '', changed: '', kind: '문서 폴더' });
  });
  it('worktree에서 일하는 작업이 있으면 그것을 먼저, 아니면 작업 중 수를 쓴다', () => {
    expect(repoNodeText(row({ working: 2, worktrees: 1 })).working).toBe('worktree 작업 중 1');
    expect(repoNodeText(row({ working: 2 })).working).toBe('작업 중 2');
  });
});

describe('탐색기 폴더 줄 표시(이름만 보이고 색으로만 구분)', () => {
  const base = { kind: 'repo' as const, status: { branch: 'main', ahead: 0, behind: 0, changed: 0 }, working: 0, worktrees: 0 };

  it('변경이 있는 레포만 바뀜으로 표시하고 상태 글은 이름 옆에 붙이지 않는다', () => {
    expect(repoNodeMark({ ...base, status: { ...base.status, changed: 2 } }).dirty).toBe(true);
    expect(repoNodeMark(base).dirty).toBe(false);
  });

  it('상태 글은 마우스를 올렸을 때의 툴팁에만 담는다', () => {
    expect(repoNodeMark({ ...base, status: { branch: 'dev', ahead: 1, behind: 0, changed: 2 } }).title).toBe('레포 · dev · ↑1 · 변경 2');
  });

  it('문서 폴더이거나 상태를 못 읽었으면 바뀜으로 보지 않는다', () => {
    expect(repoNodeMark({ ...base, kind: 'docs', status: null }).dirty).toBe(false);
    expect(repoNodeMark({ ...base, status: null }).dirty).toBe(false);
  });
});
