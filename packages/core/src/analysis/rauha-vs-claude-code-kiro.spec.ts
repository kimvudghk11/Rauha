import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 이 파일은 packages/core/src/analysis/ 에 있으므로 저장소 루트까지 네 단계 올라간다.
const DOC = fileURLToPath(
  new URL('../../../../docs/analysis/rauha-vs-claude-code-kiro.md', import.meta.url),
);

// 문서가 없으면 빈 문자열로 읽어서, 각 테스트가 ENOENT 가 아니라 자기 기준의 검증에서 실패하게 한다.
function readDoc(): string {
  return existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
}

// 부족한 점 항목은 3~4단계 제목으로 적는다고 본다.
function itemHeadings(doc: string): string[] {
  return doc.split(/\r?\n/).filter((line) => /^#{3,4}\s/.test(line));
}

function countOf(doc: string, pattern: RegExp): number {
  return (doc.match(pattern) ?? []).length;
}

describe('rauha vs Claude Code·Kiro 분석 문서', () => {
  it('docs/analysis 에 문서가 생기고 비어 있지 않다', () => {
    expect(existsSync(DOC)).toBe(true);
    expect(readDoc().trim().length).toBeGreaterThan(0);
  });

  it('문서는 한국어로 쓰였다', () => {
    expect(countOf(readDoc(), /[가-힣]/g)).toBeGreaterThanOrEqual(200);
  });

  it('디자인 축과 기능 축으로 나뉜 비교 섹션이 있다', () => {
    const headings = readDoc()
      .split(/\r?\n/)
      .filter((line) => /^#{1,4}\s/.test(line));
    expect(headings.some((h) => h.includes('디자인'))).toBe(true);
    expect(headings.some((h) => h.includes('기능'))).toBe(true);
  });

  it('부족한 점 항목이 최소 두 개 있다', () => {
    expect(itemHeadings(readDoc()).length).toBeGreaterThanOrEqual(2);
  });

  it('각 부족한 점은 비교 대상(Claude Code 또는 Kiro)을 밝힌다', () => {
    const doc = readDoc();
    const items = itemHeadings(doc).length;
    expect(items).toBeGreaterThanOrEqual(2);
    expect(countOf(doc, /Claude Code|Kiro/g)).toBeGreaterThanOrEqual(items);
  });

  it('각 부족한 점은 근거(rauha 파일 경로 또는 설계서 문단)를 든다', () => {
    const doc = readDoc();
    const items = itemHeadings(doc).length;
    expect(items).toBeGreaterThanOrEqual(2);
    expect(countOf(doc, /(packages|docs|prompts|examples)\/[\w.\-/]+|설계서/g)).toBeGreaterThanOrEqual(items);
  });

  it('각 부족한 점에는 영향과 개선 방향이 들어 있다', () => {
    const doc = readDoc();
    const items = itemHeadings(doc).length;
    expect(items).toBeGreaterThanOrEqual(2);
    expect(countOf(doc, /영향/g)).toBeGreaterThanOrEqual(items);
    expect(countOf(doc, /개선 방향/g)).toBeGreaterThanOrEqual(items);
  });

  it('확인하지 못한 Claude Code·Kiro 기능 설명은 확인하지 못한 추정으로 표시한다', () => {
    expect(readDoc()).toMatch(/확인하지\s*못한\s*추정/);
  });

  it('문서 끝부분에 항목·영향도·난이도 열을 가진 우선순위 요약 표가 있다', () => {
    const lines = readDoc().split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => {
      if (!line.trimStart().startsWith('|')) return false;
      const cells = line.split('|').map((c) => c.trim());
      const at = (name: string) => cells.findIndex((c) => c === name);
      const i = at('항목');
      const j = at('영향도');
      const k = at('난이도');
      return i >= 0 && j > i && k > j;
    });
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    // 표는 문서의 뒤쪽(끝부분)에 있어야 한다.
    expect(headerIndex).toBeGreaterThanOrEqual(Math.floor(lines.length * 0.6));
    // 헤더 다음 줄은 구분선, 그 다음에 데이터 행이 있어야 한다.
    expect(lines[headerIndex + 1]).toMatch(/^\s*\|\s*:?-{2,}/);
    expect(lines[headerIndex + 2]?.trimStart().startsWith('|')).toBe(true);
  });
});
