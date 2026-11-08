import { describe, expect, it } from 'vitest';
import { absolutePath, checkName, copyName, deleteImpact, inProtectedZone, joinPath, moveChoices, movedPath, parentOf, planMove, remapOpen, stemEnd, tooLongPath, workingRepoFor } from './code-ops.js';

const ci = { siblings: [] as string[], caseInsensitive: true };
const cs = { siblings: [] as string[], caseInsensitive: false };

describe('파일 이름 검사', () => {
  it('보통 이름은 통과한다', () => {
    expect(checkName('main.ts', ci)).toEqual({ ok: true, name: 'main.ts' });
    expect(checkName('한글 이름.md', ci)).toEqual({ ok: true, name: '한글 이름.md' });
    expect(checkName('.env.local', ci).ok).toBe(true);
  });
  it('빈 이름은 거절한다', () => {
    expect(checkName('', ci)).toMatchObject({ ok: false, problem: 'empty' });
  });
  it('경로 구분자와 윈도우에서 못 쓰는 글자는 이유와 함께 거절한다', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b']) expect(checkName(bad, ci), bad).toMatchObject({ ok: false, problem: 'bad-char' });
  });
  it('"." ".." 과 ../ 같은 경로 조각은 이름이 될 수 없다', () => {
    expect(checkName('.', ci)).toMatchObject({ ok: false, problem: 'dots' });
    expect(checkName('..', ci)).toMatchObject({ ok: false, problem: 'dots' });
    expect(checkName('../x', ci)).toMatchObject({ ok: false });
  });
  it('끝의 점·빈칸과 앞의 빈칸은 거절한다', () => {
    expect(checkName('a.', ci)).toMatchObject({ ok: false, problem: 'trailing' });
    expect(checkName('a ', ci)).toMatchObject({ ok: false, problem: 'trailing' });
    expect(checkName(' a', ci)).toMatchObject({ ok: false, problem: 'trailing' });
  });
  it('윈도우 예약 이름은 확장자가 붙어도 거절한다', () => {
    for (const bad of ['CON', 'nul', 'Aux.txt', 'COM1', 'lpt9.log', 'prn']) expect(checkName(bad, ci), bad).toMatchObject({ ok: false, problem: 'reserved' });
    expect(checkName('console.ts', ci).ok).toBe(true);
    expect(checkName('com10', ci).ok).toBe(true);
  });
  it('.git 이름은 대소문자 상관없이 거절한다', () => {
    expect(checkName('.git', ci)).toMatchObject({ ok: false, problem: 'git' });
    expect(checkName('.GIT', cs)).toMatchObject({ ok: false, problem: 'git' });
    expect(checkName('.gitignore', ci).ok).toBe(true);
  });
  it('255바이트를 넘는 이름은 거절한다', () => {
    expect(checkName('a'.repeat(256), ci)).toMatchObject({ ok: false, problem: 'too-long' });
    expect(checkName('가'.repeat(90), ci)).toMatchObject({ ok: false, problem: 'too-long' });
    expect(checkName('a'.repeat(255), ci).ok).toBe(true);
  });
  it('같은 폴더에 이미 있는 이름은 거절한다(대소문자는 파일 시스템에 따라)', () => {
    expect(checkName('a.ts', { siblings: ['a.ts'], caseInsensitive: false })).toMatchObject({ ok: false, problem: 'exists' });
    expect(checkName('A.ts', { siblings: ['a.ts'], caseInsensitive: true })).toMatchObject({ ok: false, problem: 'exists' });
    expect(checkName('A.ts', { siblings: ['a.ts'], caseInsensitive: false }).ok).toBe(true);
  });
  it('이름 바꾸기에서 원래 이름 그대로면 "그대로"이고, 대소문자만 바꾸는 것은 겹침이 아니다', () => {
    expect(checkName('a.ts', { siblings: ['a.ts', 'b.ts'], self: 'a.ts', caseInsensitive: true })).toMatchObject({ ok: false, problem: 'same' });
    expect(checkName('A.ts', { siblings: ['a.ts', 'b.ts'], self: 'a.ts', caseInsensitive: true })).toEqual({ ok: true, name: 'A.ts' });
    expect(checkName('b.ts', { siblings: ['a.ts', 'b.ts'], self: 'a.ts', caseInsensitive: true })).toMatchObject({ ok: false, problem: 'exists' });
  });
});

describe('이름 바꾸기 입력의 선택 범위', () => {
  it('확장자를 뺀 이름 부분까지만 고른다', () => {
    expect(stemEnd('main.ts')).toBe(4);
    expect(stemEnd('a.test.ts')).toBe(6);
    expect(stemEnd('README')).toBe(6);
    expect(stemEnd('.env')).toBe(4);
    expect(stemEnd('끝.')).toBe(2);
  });
});

describe('복제 이름', () => {
  it('"이름 복사본.확장자"로 만든다', () => {
    expect(copyName('a.ts', [], true)).toBe('a 복사본.ts');
    expect(copyName('docs', [], true)).toBe('docs 복사본');
    expect(copyName('.env', [], true)).toBe('.env 복사본');
  });
  it('이미 있으면 번호를 붙인다', () => {
    expect(copyName('a.ts', ['a 복사본.ts'], true)).toBe('a 복사본 2.ts');
    expect(copyName('a.ts', ['a 복사본.ts', 'a 복사본 2.ts'], true)).toBe('a 복사본 3.ts');
    expect(copyName('a.ts', ['A 복사본.ts'], true)).toBe('a 복사본 2.ts');
    expect(copyName('a.ts', ['A 복사본.ts'], false)).toBe('a 복사본.ts');
  });
});

describe('경로 다루기', () => {
  it('폴더와 이름을 합치고 위 폴더를 구한다', () => {
    expect(joinPath('', 'a.ts')).toBe('a.ts');
    expect(joinPath('src', 'a.ts')).toBe('src/a.ts');
    expect(parentOf('src/a/b.ts')).toBe('src/a');
    expect(parentOf('a.ts')).toBe('');
  });
  it('너무 긴 경로(240자 초과)는 거절 대상이다', () => {
    expect(tooLongPath('a/'.repeat(121))).toBe(true);
    expect(tooLongPath('src/a.ts')).toBe(false);
  });
  it('node_modules·.git 안은 조작 금지 구역이다', () => {
    expect(inProtectedZone('node_modules')).toBe(true);
    expect(inProtectedZone('app/node_modules/x/index.js')).toBe(true);
    expect(inProtectedZone('app/NODE_MODULES/x')).toBe(true);
    expect(inProtectedZone('app/.git/config')).toBe(true);
    expect(inProtectedZone('app/src/node_modules_notes.md')).toBe(false);
  });
  it('절대 경로는 작업 폴더에 구분자를 맞춰 붙인다', () => {
    expect(absolutePath('E:\\work', 'src/a.ts', '\\')).toBe('E:\\work\\src\\a.ts');
    expect(absolutePath('/Users/me/work/', 'src/a.ts', '/')).toBe('/Users/me/work/src/a.ts');
    expect(absolutePath('/Users/me/work', '', '/')).toBe('/Users/me/work');
  });
});

describe('옮기기 대상 계산', () => {
  it('다른 폴더로 옮기면 그 폴더 아래 같은 이름이 된다', () => {
    expect(planMove({ path: 'src/a.ts', kind: 'file', destDir: 'lib', destNames: [], caseInsensitive: true })).toEqual({ ok: true, target: 'lib/a.ts' });
    expect(planMove({ path: 'src/a.ts', kind: 'file', destDir: '', destNames: [], caseInsensitive: true })).toEqual({ ok: true, target: 'a.ts' });
  });
  it('이미 그 폴더에 있으면 옮길 일이 없다', () => {
    expect(planMove({ path: 'src/a.ts', kind: 'file', destDir: 'src', destNames: ['a.ts'], caseInsensitive: true })).toMatchObject({ ok: false, reason: 'same-folder' });
  });
  it('폴더를 자기 자신이나 자기 안으로 옮길 수 없다', () => {
    expect(planMove({ path: 'src', kind: 'dir', destDir: 'src', destNames: [], caseInsensitive: true })).toMatchObject({ ok: false, reason: 'into-self' });
    expect(planMove({ path: 'src', kind: 'dir', destDir: 'src/deep', destNames: [], caseInsensitive: true })).toMatchObject({ ok: false, reason: 'into-self' });
    expect(planMove({ path: 'src', kind: 'dir', destDir: 'src2', destNames: [], caseInsensitive: true }).ok).toBe(true);
  });
  it('가는 곳에 같은 이름이 있으면 덮어쓰지 않고 거절한다', () => {
    expect(planMove({ path: 'src/a.ts', kind: 'file', destDir: 'lib', destNames: ['A.ts'], caseInsensitive: true })).toMatchObject({ ok: false, reason: 'exists' });
    expect(planMove({ path: 'src/a.ts', kind: 'file', destDir: 'lib', destNames: ['A.ts'], caseInsensitive: false }).ok).toBe(true);
  });
  it('조작 금지 구역으로는 옮기지 않는다', () => {
    expect(planMove({ path: 'a.ts', kind: 'file', destDir: 'app/node_modules/x', destNames: [], caseInsensitive: true })).toMatchObject({ ok: false, reason: 'protected' });
  });
  it('옮길 곳 목록은 지금 위치와 자기 자신·그 아래, 금지 구역을 뺀다', () => {
    const dirs = ['src', 'src/deep', 'lib', 'app/node_modules', 'app'];
    expect(moveChoices('src/a.ts', 'file', dirs)).toEqual(['', 'app', 'lib', 'src/deep']);
    expect(moveChoices('src', 'dir', dirs)).toEqual(['app', 'lib']);
  });
});

describe('열려 있는 편집기 탭과 이어지는 규칙', () => {
  it('파일 이름을 바꾸면 그 탭이 새 경로로 이어진다', () => {
    expect(movedPath('src/a.ts', 'src/a.ts', 'src/b.ts')).toBe('src/b.ts');
    expect(movedPath('src/c.ts', 'src/a.ts', 'src/b.ts')).toBeNull();
  });
  it('폴더를 바꾸거나 옮기면 안에 열린 탭이 모두 새 경로로 이어진다', () => {
    expect(movedPath('src/deep/x.ts', 'src', 'lib/src')).toBe('lib/src/deep/x.ts');
    expect(movedPath('src2/x.ts', 'src', 'lib')).toBeNull();
    expect(remapOpen(['src/a.ts', 'src/b/c.ts', 'other.ts'], 'src', 'lib')).toEqual([
      { from: 'src/a.ts', to: 'lib/a.ts' },
      { from: 'src/b/c.ts', to: 'lib/b/c.ts' },
    ]);
  });
  it('삭제하면 그 파일(또는 폴더 안)의 탭을 닫고, 저장 안 한 수정이 있는 탭은 따로 알려 준다', () => {
    expect(deleteImpact(['src/a.ts', 'src/b.ts', 'x.ts'], ['src/b.ts', 'x.ts'], 'src')).toEqual({ closing: ['src/a.ts', 'src/b.ts'], unsaved: ['src/b.ts'] });
    expect(deleteImpact(['a.ts'], [], 'b.ts')).toEqual({ closing: [], unsaved: [] });
  });
});

describe('팀이 쓰고 있는 레포 경고', () => {
  const repos = [
    { name: 'api', relative: 'api', working: 1, worktrees: 0 },
    { name: 'web', relative: 'web', working: 0, worktrees: 0 },
    { name: 'docs', relative: 'web/docs', working: 0, worktrees: 2 },
  ];
  it('일하는 작업이 있는 레포 안의 파일이면 그 레포를 돌려준다', () => {
    expect(workingRepoFor('api/src/a.ts', repos)?.name).toBe('api');
    expect(workingRepoFor('api', repos)?.name).toBe('api');
  });
  it('일하는 작업이 없거나 레포 밖이면 null이다', () => {
    expect(workingRepoFor('web/src/a.ts', repos)).toBeNull();
    expect(workingRepoFor('apis/a.ts', repos)).toBeNull();
    expect(workingRepoFor('loose.txt', repos)).toBeNull();
  });
  it('가장 깊은 레포 기준이다 (worktree 작업도 일하는 것이다)', () => {
    expect(workingRepoFor('web/docs/a.md', repos)?.name).toBe('docs');
  });
  it('작업 폴더 자체가 레포면 모든 파일이 그 레포 것이다', () => {
    expect(workingRepoFor('a.ts', [{ name: 'me', relative: '.', working: 1, worktrees: 0 }])?.name).toBe('me');
  });
});
