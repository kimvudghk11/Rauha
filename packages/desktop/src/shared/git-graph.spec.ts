import { describe, expect, it } from 'vitest';
import { GRAPH_COLORS, GRAPH_LIMIT, laneColor, layoutGraph, type GraphCommit } from './git-graph.js';

const c = (hash: string, parents: string[] = [], refs: string[] = []): GraphCommit => ({ hash, parents, refs });

describe('layoutGraph', () => {
  it('일직선 이력은 한 칸(0)에 점이 이어지고 맨 위·맨 아래 선만 비어 있다', () => {
    const rows = layoutGraph([c('c', ['b']), c('b', ['a']), c('a')]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows[0]!.top).toEqual([]);
    expect(rows[1]!.top).toEqual([{ from: 0, to: 0, color: rows[0]!.color }]);
    expect(rows[2]!.bottom).toEqual([]);
    expect(rows.every((r) => r.cols === 1)).toBe(true);
  });

  it('병합 커밋은 두 번째 부모 쪽으로 가지를 뻗고 merge 로 표시된다', () => {
    // m = merge(b, f); b와 f는 둘 다 a에서 갈라졌다
    const rows = layoutGraph([c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')]);
    expect(rows[0]!.merge).toBe(true);
    expect(rows[0]!.bottom.map((e) => [e.from, e.to])).toEqual([[0, 0], [0, 1]]);
    expect(rows[1]!.col).toBe(1); // f 는 두 번째 칸
    expect(rows[2]!.col).toBe(0);
    expect(rows[1]!.merge).toBe(false);
  });

  it('갈라진 두 줄기가 공통 조상에서 만나면 먼저 오는 줄기의 선이 조상이 기다리는 칸으로 휜다', () => {
    const rows = layoutGraph([c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')]);
    expect(rows[2]!.bottom.map((e) => [e.from, e.to])).toEqual([[0, 1], [1, 1]]);
    const a = rows[3]!;
    expect(a.col).toBe(1);
    expect(a.top.map((e) => [e.from, e.to])).toEqual([[1, 1]]);
    expect(a.cols).toBe(2);
  });

  it('브랜치 끝이 둘이면(--all) 서로 다른 칸을 쓰고, 끝난 칸은 다음 새 줄기가 다시 쓴다', () => {
    const rows = layoutGraph([c('x', ['a']), c('y', ['a']), c('a', ['r']), c('r'), c('z')]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0, 0]);
    expect(rows[4]!.top).toEqual([]);
  });

  it('첫 부모가 이미 다른 칸에서 기다리고 있으면 그 칸으로 선이 휘고 이 칸은 비워진다', () => {
    const rows = layoutGraph([c('x', ['a']), c('y', ['a']), c('a')]);
    expect(rows[1]!.col).toBe(1);
    expect(rows[1]!.bottom.map((e) => [e.from, e.to])).toContainEqual([1, 0]);
    expect(rows[2]!.top.map((e) => [e.from, e.to])).toEqual([[0, 0]]);
  });

  it('목록 밖(잘린) 부모를 가리켜도 선이 끝까지 이어지고 터지지 않는다', () => {
    const rows = layoutGraph([c('b', ['gone']), c('c', ['gone2'])]);
    expect(rows[1]!.top).toEqual([{ from: 0, to: 0, color: rows[0]!.color }]);
    expect(rows[1]!.col).toBe(1);
  });

  it('상한(500)을 넘는 커밋은 그리지 않는다', () => {
    const list: GraphCommit[] = [];
    for (let i = 0; i < GRAPH_LIMIT + 50; i++) list.push(c(`h${i}`, [`h${i + 1}`]));
    expect(layoutGraph(list)).toHaveLength(GRAPH_LIMIT);
    expect(GRAPH_LIMIT).toBe(500);
    expect(layoutGraph(list, 10)).toHaveLength(10);
  });

  it('같은 입력이면 항상 같은 결과다', () => {
    const list = [c('m', ['b', 'f'], ['HEAD -> main']), c('f', ['a'], ['feature/x']), c('b', ['a']), c('a')];
    expect(layoutGraph(list)).toEqual(layoutGraph(list));
  });

  it('가장자리 번호는 항상 0 이상이고 cols 안이다', () => {
    const list: GraphCommit[] = [];
    // 병합이 겹겹이 쌓인 모양
    for (let i = 0; i < 40; i++) list.push(c(`m${i}`, [`m${i + 1}`, `s${i}`]), c(`s${i}`, [`m${i + 2}`]));
    for (const r of layoutGraph(list)) {
      for (const e of [...r.top, ...r.bottom]) {
        expect(e.from).toBeGreaterThanOrEqual(0);
        expect(e.to).toBeGreaterThanOrEqual(0);
        expect(Math.max(e.from, e.to)).toBeLessThan(r.cols);
      }
      expect(r.col).toBeLessThan(r.cols);
    }
  });
});

describe('laneColor', () => {
  it('같은 이름은 같은 색이고 색 번호는 팔레트 안이다', () => {
    expect(laneColor('feature/x')).toBe(laneColor('feature/x'));
    for (const k of ['main', 'dev', 'feature/a', 'x'.repeat(200), '']) {
      expect(laneColor(k)).toBeGreaterThanOrEqual(0);
      expect(laneColor(k)).toBeLessThan(GRAPH_COLORS);
    }
  });

  it('브랜치 끝 커밋의 색은 지역 브랜치 이름으로 정해져 원격 이름(origin/)과 같다', () => {
    const a = layoutGraph([c('x', [], ['HEAD -> main', 'origin/main'])])[0]!;
    const b = layoutGraph([c('y', [], ['origin/main'])])[0]!;
    expect(a.color).toBe(b.color);
    expect(a.color).toBe(laneColor('main'));
  });

  it('태그만 있는 커밋은 해시로 색을 정한다(태그 이름을 브랜치로 보지 않는다)', () => {
    const r = layoutGraph([c('abc123', [], ['tag: v1'])])[0]!;
    expect(r.color).toBe(laneColor('abc123'));
  });

  it('옆 칸에서 이미 쓰는 색은 새 줄기가 피한다', () => {
    const rows = layoutGraph([c('m', ['a', 'b']), c('a', ['r']), c('b', ['r']), c('r')]);
    const colors = rows[0]!.bottom.map((e) => e.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
