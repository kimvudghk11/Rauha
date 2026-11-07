import { describe, expect, it } from 'vitest';
import { FileDiff } from './git-diff.js';

const DIFF = [
  'diff --git a/a.txt b/a.txt',
  'index 111..222 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,4 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  '+extra',
  ' three',
  ' four',
  '@@ -10,2 +11,2 @@ fn',
  ' ten',
  '-eleven',
  '+ELEVEN',
  '',
].join('\n');

describe('FileDiff.parse', () => {
  const d = FileDiff.parse(DIFF);

  it('hunk마다 줄 번호(왼쪽·오른쪽)와 종류를 읽는다', () => {
    expect(d.hunks).toHaveLength(2);
    const h = d.hunks[0]!;
    expect(h.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['ctx', 1, 1], ['del', 2, null], ['add', null, 2], ['add', null, 3], ['ctx', 3, 4], ['ctx', 4, 5],
    ]);
    expect(d.hunks[1]!.lines[1]).toMatchObject({ kind: 'del', oldNo: 11, text: 'eleven' });
  });

  it('추가·삭제 줄 수를 센다', () => {
    expect(d.added()).toBe(3);
    expect(d.deleted()).toBe(2);
  });

  it('바이너리 파일은 hunk가 없고 binary로 표시한다', () => {
    const b = FileDiff.parse('diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n');
    expect(b.isBinary()).toBe(true);
    expect(b.hunks).toHaveLength(0);
  });

  it('hunk 하나만 고르면 그 hunk만 담은 패치를 만든다', () => {
    const patch = d.patchFor({ hunks: [1] }, 'stage');
    expect(patch).toContain('@@ -10,2 +10,2 @@');
    expect(patch).not.toContain('TWO');
    expect(patch.startsWith('diff --git a/a.txt b/a.txt\n')).toBe(true);
  });

  it('줄 단위: 고르지 않은 추가 줄은 빼고 고르지 않은 삭제 줄은 문맥으로 남긴다', () => {
    // hunk 0에서 -two, +TWO만 고르고 +extra는 뺀다
    const patch = d.patchFor({ lines: { 0: [1, 2] } }, 'stage');
    expect(patch).toContain('@@ -1,4 +1,4 @@');
    expect(patch).toContain('-two\n+TWO\n three');
    expect(patch).not.toContain('extra');
    const keepDel = d.patchFor({ lines: { 0: [2] } }, 'stage');
    expect(keepDel).toContain(' two\n+TWO');
    expect(keepDel).toContain('@@ -1,4 +1,5 @@'.replace('+1,5', '+1,5'));
  });

  it('스테이지 해제(reverse)에서는 고르지 않은 추가 줄이 문맥이 되고 삭제 줄은 빠진다', () => {
    const patch = d.patchFor({ lines: { 0: [1] } }, 'unstage');
    expect(patch).toContain(' TWO'.replace(' TWO', '-two'));
    expect(patch).toContain(' extra');
    expect(patch).not.toContain('+TWO');
  });

  it('고른 것이 없으면 빈 문자열이다', () => {
    expect(d.patchFor({ hunks: [] }, 'stage')).toBe('');
    expect(d.patchFor({ lines: { 0: [] } }, 'stage')).toBe('');
  });

  it('CRLF 줄끝은 지우지 않고 패치에 그대로 넣는다', () => {
    const crlf = FileDiff.parse(['diff --git a/c b/c', '--- a/c', '+++ b/c', '@@ -1 +1 @@', '-a\r', '+b\r', ''].join('\n'));
    expect(crlf.patchFor({ hunks: [0] }, 'stage')).toContain('-a\r\n+b\r\n');
  });
});
