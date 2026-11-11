import { describe, expect, it } from 'vitest';
import { diagnosticsWanted, MAX_DIAGNOSTIC_TEXT, ProblemBook, problemCountText } from './problems.js';
import type { NavDiagnostic } from './ts-nav.js';

const d = (line: number, severity: 'error' | 'warning' = 'error', message = 'm'): NavDiagnostic => ({ line, column: 1, endLine: line, endColumn: 4, severity, code: 2322, message });

describe('Problems 목록', () => {
  it('파일마다 진단을 넣고 빼며, 원본은 바뀌지 않는다', () => {
    const empty = ProblemBook.empty();
    const one = empty.with('a.ts', [d(2)]);
    expect(empty.total()).toBe(0);
    expect(one.total()).toBe(1);
    expect(one.without('a.ts').total()).toBe(0);
  });

  it('진단이 없는 파일은 목록에 넣지 않는다', () => {
    expect(ProblemBook.empty().with('a.ts', []).files()).toEqual([]);
    expect(ProblemBook.empty().with('a.ts', [d(1)]).with('a.ts', []).files()).toEqual([]);
  });

  it('오류와 경고를 따로 센다', () => {
    const book = ProblemBook.empty().with('a.ts', [d(1), d(2, 'warning')]).with('b.ts', [d(5)]);
    expect(book.counts()).toEqual({ errors: 2, warnings: 1 });
  });

  it('목록은 오류 많은 파일이 아니라 파일 이름순이고 줄 순서로 나온다', () => {
    const book = ProblemBook.empty().with('b.ts', [d(9), d(3)]).with('a.ts', [d(4, 'warning')]);
    expect(book.rows().map((r) => `${r.path}:${r.item.line}`)).toEqual(['a.ts:4', 'b.ts:3', 'b.ts:9']);
  });

  it('파일 이름이 바뀌면 진단도 새 이름으로 옮긴다(폴더 이름 바꾸기 포함)', () => {
    const book = ProblemBook.empty().with('src/a.ts', [d(1)]).with('src/b.ts', [d(2)]).with('x.ts', [d(3)]);
    const moved = book.renamed('src', 'lib');
    expect(moved.files()).toEqual(['lib/a.ts', 'lib/b.ts', 'x.ts']);
  });

  it('폴더를 지우면 그 아래 파일의 진단도 지운다', () => {
    const book = ProblemBook.empty().with('src/a.ts', [d(1)]).with('srcx/b.ts', [d(2)]);
    expect(book.removedUnder('src').files()).toEqual(['srcx/b.ts']);
  });

  it('개수 글은 오류·경고를 영어로 한 줄에 적는다', () => {
    expect(problemCountText({ errors: 0, warnings: 0 })).toBe('No problems');
    expect(problemCountText({ errors: 1, warnings: 0 })).toBe('1 error');
    expect(problemCountText({ errors: 2, warnings: 1 })).toBe('2 errors, 1 warning');
    expect(problemCountText({ errors: 0, warnings: 3 })).toBe('3 warnings');
  });

  it('TS/JS 파일이고 너무 크지 않을 때만 진단을 부른다', () => {
    expect(diagnosticsWanted('a.ts', 100)).toBe(true);
    expect(diagnosticsWanted('a.tsx', MAX_DIAGNOSTIC_TEXT)).toBe(true);
    expect(diagnosticsWanted('a.ts', MAX_DIAGNOSTIC_TEXT + 1)).toBe(false);
    expect(diagnosticsWanted('a.py', 100)).toBe(false);
    expect(diagnosticsWanted('a.d.ts', 100)).toBe(true);
  });
});
