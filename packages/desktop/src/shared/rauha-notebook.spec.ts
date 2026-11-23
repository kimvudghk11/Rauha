import { describe, expect, it } from 'vitest';
import { NotebookError, RauhaNotebook } from './rauha-notebook.js';

const at = '2026-11-24T01:00:00.000Z';

describe('rauha 기억 노트', () => {
  it('"라우하에 저장해줘"로 받은 글을 제목과 함께 남긴다', () => {
    const book = RauhaNotebook.empty().remember({ id: 'n1', title: 'memory.md 요약', text: '회사 VPN 은 ...', source: '/Users/me/memory.md', at });
    expect(book.notes).toEqual([{ id: 'n1', title: 'memory.md 요약', text: '회사 VPN 은 ...', source: '/Users/me/memory.md', at }]);
  });

  it('같은 제목으로 다시 저장하면 새 글로 바꾼다(같은 기억이 두 번 쌓이지 않게)', () => {
    const book = RauhaNotebook.empty()
      .remember({ id: 'n1', title: '배포 순서', text: 'A', source: null, at })
      .remember({ id: 'n2', title: ' 배포 순서 ', text: 'B', source: null, at });
    expect(book.notes.map((n) => [n.id, n.text])).toEqual([['n1', 'B']]);
  });

  it('빈 제목·빈 글·너무 긴 글은 받지 않는다', () => {
    expect(() => RauhaNotebook.empty().remember({ id: 'n', title: ' ', text: 'x', source: null, at })).toThrow(NotebookError);
    expect(() => RauhaNotebook.empty().remember({ id: 'n', title: 't', text: '  ', source: null, at })).toThrow(NotebookError);
    expect(() => RauhaNotebook.empty().remember({ id: 'n', title: 't', text: 'x'.repeat(40_001), source: null, at })).toThrow(NotebookError);
  });

  it('항상 따를 룰 파일은 절대 경로로 한 번만 남긴다(경로 표기가 달라도 같은 파일)', () => {
    const book = RauhaNotebook.empty().keepRule({ id: 'r1', path: '/Users/me/repos/backend-engineering-rules/RULES.md', at }).keepRule({ id: 'r2', path: '/Users/me/repos/backend-engineering-rules//RULES.md', at });
    expect(book.rules.map((r) => r.id)).toEqual(['r1']);
  });

  it('상대 경로나 비밀 파일(키·토큰·자격 증명)은 룰 파일로 받지 않는다', () => {
    for (const path of ['RULES.md', '../x/RULES.md', '/Users/me/.claude/.credentials.json', '/Users/me/app/.env', 'C:\\keys\\id_rsa', '/Users/me/a/server.pem']) {
      expect(() => RauhaNotebook.empty().keepRule({ id: 'r', path, at }), path).toThrow(NotebookError);
    }
    expect(RauhaNotebook.empty().keepRule({ id: 'r', path: 'C:\\repos\\rules\\RULES.md', at }).rules).toHaveLength(1);
  });

  it('지우면 그 노트·룰만 빠진다', () => {
    const book = RauhaNotebook.empty().remember({ id: 'n1', title: 'a', text: 'x', source: null, at }).keepRule({ id: 'r1', path: '/a/RULES.md', at });
    expect(book.forget('n1').notes).toEqual([]);
    expect(book.forget('r1').rules).toEqual([]);
    expect(book.forget('없음')).toBe(book);
  });

  it('팀원에게 붙일 기억 글은 최근 것부터 글자 수 한도 안에서 담는다', () => {
    const book = RauhaNotebook.empty()
      .remember({ id: 'old', title: '옛것', text: 'o'.repeat(50), source: null, at: '2026-11-01T00:00:00.000Z' })
      .remember({ id: 'new', title: '새것', text: 'n'.repeat(50), source: '/m.md', at: '2026-11-20T00:00:00.000Z' });
    const block = book.memoryBlock(120);
    expect(block).toContain('새것');
    expect(block).toContain('/m.md');
    expect(block).not.toContain('옛것');
    expect(RauhaNotebook.empty().memoryBlock(1000)).toBe('');
  });

  it('저장본을 읽을 때 모양이 틀린 칸은 버리고 나머지는 살린다', () => {
    const book = RauhaNotebook.fromJSON({ notes: [{ id: 'n1', title: 'a', text: 'x', source: null, at }, { id: 3 }], rules: [{ id: 'r1', path: '/a/R.md', at }, null] });
    expect(book.notes).toHaveLength(1);
    expect(book.rules).toHaveLength(1);
    expect(RauhaNotebook.fromJSON('깨짐').notes).toEqual([]);
    expect(RauhaNotebook.fromJSON(book.toJSON()).toJSON()).toEqual(book.toJSON());
  });
});
