import { describe, expect, it } from 'vitest';
import { HunkRef, findHunk, hunkHash, hunkRevertSummary } from './checkpoint-hunk.js';
import { FileDiff } from './git-diff.js';

const DIFF = [
  'diff --git a/a.txt b/a.txt',
  'index 111..222 100644',
  'old mode 100644',
  'new mode 100755',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,4 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  '+extra',
  ' three',
  ' four',
  '@@ -20,3 +21,3 @@ fn',
  ' twenty',
  '-old',
  '+new',
  ' end',
  '',
].join('\n');

const diff = FileDiff.parse(DIFF);

describe('hunk 내용 해시', () => {
  it('같은 경로의 같은 hunk 는 늘 같은 16자리 16진수다', () => {
    expect(hunkHash('a.txt', diff.hunks[0]!)).toMatch(/^[0-9a-f]{16}$/);
    expect(hunkHash('a.txt', diff.hunks[0]!)).toBe(hunkHash('a.txt', FileDiff.parse(DIFF).hunks[0]!));
  });
  it('hunk 안 한 줄만 달라도 해시가 달라진다', () => {
    const other = FileDiff.parse(DIFF.replace('+TWO', '+Two'));
    expect(hunkHash('a.txt', other.hunks[0]!)).not.toBe(hunkHash('a.txt', diff.hunks[0]!));
  });
  it('줄 끝 CR·마지막 줄 개행 없음 표시도 해시에 들어간다', () => {
    const cr = FileDiff.parse(DIFF.replace('+TWO\n', '+TWO\r\n'));
    expect(hunkHash('a.txt', cr.hunks[0]!)).not.toBe(hunkHash('a.txt', diff.hunks[0]!));
    const noEol = FileDiff.parse(DIFF.replace('+TWO\n', '+TWO\n\ No newline at end of file\n'));
    expect(hunkHash('a.txt', noEol.hunks[0]!)).not.toBe(hunkHash('a.txt', diff.hunks[0]!));
  });
  it('같은 내용이어도 위치(시작 줄)나 파일 경로가 다르면 해시가 다르다', () => {
    expect(hunkHash('a.txt', diff.hunks[0]!)).not.toBe(hunkHash('b.txt', diff.hunks[0]!));
    const moved = FileDiff.parse(DIFF.replace('@@ -1,4 +1,5 @@', '@@ -7,4 +7,5 @@'));
    expect(hunkHash('a.txt', moved.hunks[0]!)).not.toBe(hunkHash('a.txt', diff.hunks[0]!));
  });
});

describe('HunkRef 화면에서 온 hunk 해시 검사', () => {
  it('16자리 16진수만 받는다', () => {
    expect(HunkRef.parse('0123456789abcdef').value).toBe('0123456789abcdef');
    for (const bad of ['', 'xyz', '0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', 3, null, undefined, { a: 1 }]) expect(() => HunkRef.parse(bad)).toThrow();
  });
});

describe('findHunk 해시로 hunk 찾기', () => {
  it('해시가 맞는 hunk 의 번호를 돌려준다(번호가 아니라 내용으로)', () => {
    expect(findHunk('a.txt', diff.hunks, HunkRef.parse(hunkHash('a.txt', diff.hunks[1]!)))).toBe(1);
  });
  it('화면에 보인 hunk 가 지금 diff 에 없으면 null 이다', () => {
    const stale = hunkHash('a.txt', FileDiff.parse(DIFF.replace('+new', '+newer')).hunks[1]!);
    expect(findHunk('a.txt', diff.hunks, HunkRef.parse(stale))).toBeNull();
  });
  it('해시가 겹치는 hunk 가 둘 이상이면 어느 쪽인지 알 수 없어 null 이다', () => {
    expect(findHunk('a.txt', [diff.hunks[0]!, diff.hunks[0]!], HunkRef.parse(hunkHash('a.txt', diff.hunks[0]!)))).toBeNull();
  });
});

describe('FileDiff.hunkPatch 되돌릴 hunk 하나만 담은 패치', () => {
  it('고른 hunk 하나만, 원래 줄 번호 그대로 담는다', () => {
    const p = diff.hunkPatch(1);
    expect(p).toContain('@@ -20,3 +21,3 @@ fn\n twenty\n-old\n+new\n end\n');
    expect(p).not.toContain('extra');
  });
  it('index·mode 줄은 빼서 되돌려도 파일 권한이 바뀌지 않는다', () => {
    const p = diff.hunkPatch(0);
    expect(p).toMatch(/^diff --git a\/a.txt b\/a.txt\n--- a\/a.txt\n\+\+\+ b\/a.txt\n@@ /);
    expect(p).not.toMatch(/mode|index /);
  });
  it('CRLF 줄은 \r 을 살리고 개행 없음 표시를 유지한다', () => {
    const crlf = FileDiff.parse(['diff --git a/c b/c', '--- a/c', '+++ b/c', '@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+B\r', '\ No newline at end of file', ''].join('\n'));
    expect(crlf.hunkPatch(0)).toBe(['diff --git a/c b/c', '--- a/c', '+++ b/c', '@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+B\r', '\ No newline at end of file', ''].join('\n'));
  });
  it('없는 번호면 빈 문자열이다', () => {
    expect(diff.hunkPatch(5)).toBe('');
    expect(diff.hunkPatch(-1)).toBe('');
  });
});

describe('hunkRevertSummary 확인 창 글', () => {
  it('지워질 줄·돌아올 줄·백업을 말한다', () => {
    const s = hunkRevertSummary('a.txt', diff.hunks[0]!);
    expect(s.title).toBe('Revert this change in a.txt?');
    expect(s.body).toContain('Removes 2 lines the job added and brings back 1 line it deleted');
    expect(s.body).toContain('backup');
    expect(s.okLabel).toBe('Revert hunk');
  });
});
