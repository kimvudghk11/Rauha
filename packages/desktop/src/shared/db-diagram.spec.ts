import { describe, expect, it } from 'vitest';
import { DIAGRAM, DiagramLayout, SchemaGraph, type DbSchemaGraph } from './db-diagram.js';

const shop = (): DbSchemaGraph =>
  SchemaGraph.fromRows({
    tables: [['users', 'table'], ['orders', 'table'], ['order_items', 'table'], ['products', 'table'], ['adults', 'view']],
    columns: [
      ['users', 'id', 'integer'], ['users', 'name', 'text'],
      ['orders', 'id', 'integer'], ['orders', 'user_id', 'integer'],
      ['order_items', 'order_id', 'integer'], ['order_items', 'product_id', 'integer'],
      ['products', 'id', 'integer'], ['adults', 'name', 'text'],
    ],
    keys: [['users', 'id', 1], ['orders', 'id', 1], ['products', 'id', 1], ['order_items', 'order_id', 1], ['order_items', 'product_id', 2]],
    links: [['fk1', 'orders', 'user_id', 'users', 'id'], ['fk2', 'order_items', 'order_id', 'orders', 'id'], ['fk3', 'order_items', 'product_id', 'products', 'id']],
  }).toJSON();

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('스키마 그림 재료(테이블·열·PK·FK)', () => {
  it('카탈로그 행을 테이블별 열·PK 순번·FK 로 묶는다', () => {
    const g = shop();
    expect(g.tables.map((t) => t.name)).toEqual(['users', 'orders', 'order_items', 'products', 'adults']);
    expect(g.tables.find((t) => t.name === 'order_items')?.columns.map((c) => [c.name, c.pk])).toEqual([['order_id', 1], ['product_id', 2]]);
    expect(g.links).toContainEqual({ from: 'orders', fromColumns: ['user_id'], to: 'users', toColumns: ['id'] });
  });
  it('여러 열로 된 FK 는 이름별로 한 줄로 묶는다', () => {
    const g = SchemaGraph.fromRows({ tables: [['a', 'table'], ['b', 'table']], columns: [], keys: [], links: [['fk', 'a', 'x', 'b', 'p'], ['fk', 'a', 'y', 'b', 'q']] }).toJSON();
    expect(g.links).toEqual([{ from: 'a', fromColumns: ['x', 'y'], to: 'b', toColumns: ['p', 'q'] }]);
  });
  it('목록에 없는 테이블의 열·키는 버린다', () => {
    const g = SchemaGraph.fromRows({ tables: [['a', 'table']], columns: [['ghost', 'c', 'int']], keys: [['ghost', 'c', 1]], links: [] }).toJSON();
    expect(g.tables).toEqual([{ name: 'a', kind: 'table', columns: [] }]);
  });
});

describe('ERD 배치', () => {
  it('작은 스키마는 모든 테이블을 겹치지 않게 놓는다', () => {
    const l = DiagramLayout.of(shop(), null);
    expect(l.boxes).toHaveLength(5);
    expect(l.partial).toBe(false);
    for (const a of l.boxes) for (const b of l.boxes) if (a !== b) expect(overlap(a, b), `${a.name}/${b.name}`).toBe(false);
    for (const b of l.boxes) {
      expect(b.x + b.w).toBeLessThanOrEqual(l.width);
      expect(b.y + b.h).toBeLessThanOrEqual(l.height);
    }
  });
  it('FK 마다 선을 하나 긋고, 자식 열 줄 높이에서 나가 부모 열 줄 높이로 들어간다', () => {
    const l = DiagramLayout.of(shop(), null);
    expect(l.edges).toHaveLength(3);
    const e = l.edges.find((x) => x.from === 'orders' && x.to === 'users')!;
    const orders = l.boxes.find((b) => b.name === 'orders')!;
    const users = l.boxes.find((b) => b.name === 'users')!;
    expect(e.y1).toBe(orders.y + DIAGRAM.header + DIAGRAM.row * 1 + DIAGRAM.row / 2);
    expect(e.y2).toBe(users.y + DIAGRAM.header + DIAGRAM.row / 2);
    expect(e.path.startsWith(`M ${e.x1} ${e.y1} C`)).toBe(true);
  });
  it('열 줄에 PK·FK 표시를 단다', () => {
    const items = DiagramLayout.of(shop(), null).boxes.find((b) => b.name === 'order_items')!;
    expect(items.columns.map((c) => [c.name, c.pk, c.fk])).toEqual([['order_id', true, true], ['product_id', true, true]]);
  });
  it('열이 많으면 앞의 일부만 그리고 "+N more" 를 단다', () => {
    const cols = Array.from({ length: DIAGRAM.maxColumns + 5 }, (_, i) => ['wide', `c${i}`, 'int'] as const);
    const l = DiagramLayout.of(SchemaGraph.fromRows({ tables: [['wide', 'table']], columns: cols, keys: [], links: [] }).toJSON(), null);
    expect(l.boxes[0]?.columns).toHaveLength(DIAGRAM.maxColumns);
    expect(l.boxes[0]?.more).toBe(5);
  });
  it('큰 스키마는 고른 테이블과 FK 로 이어진 이웃만 그리고, 고른 테이블이 가운데 칸이다', () => {
    const tables = Array.from({ length: DIAGRAM.fullMax + 10 }, (_, i) => [`t${i}`, 'table'] as const);
    const links = [['f1', 't1', 'a', 't0', 'id'], ['f2', 't0', 'b', 't2', 'id']] as const;
    const l = DiagramLayout.of(SchemaGraph.fromRows({ tables, columns: [], keys: [], links }).toJSON(), 't0');
    expect(l.partial).toBe(true);
    expect(l.boxes.map((b) => b.name).sort()).toEqual(['t0', 't1', 't2']);
    const x = (n: string) => l.boxes.find((b) => b.name === n)!.x;
    expect(x('t2')).toBeLessThan(x('t0'));
    expect(x('t1')).toBeGreaterThan(x('t0'));
    expect(l.focus).toBe('t0');
  });
  it('큰 스키마에서 고른 테이블이 없으면 가장 많이 이어진 테이블을 가운데에 둔다', () => {
    const tables = Array.from({ length: DIAGRAM.fullMax + 1 }, (_, i) => [`t${i}`, 'table'] as const);
    const links = [['f1', 't1', 'a', 't5', 'id'], ['f2', 't2', 'a', 't5', 'id'], ['f3', 't3', 'a', 't4', 'id']] as const;
    expect(DiagramLayout.of(SchemaGraph.fromRows({ tables, columns: [], keys: [], links }).toJSON(), null).focus).toBe('t5');
  });
  it('자기 자신을 가리키는 FK 는 상자 오른쪽에 고리로 그린다', () => {
    const l = DiagramLayout.of(SchemaGraph.fromRows({ tables: [['tree', 'table']], columns: [['tree', 'id', 'int'], ['tree', 'parent_id', 'int']], keys: [['tree', 'id', 1]], links: [['fk', 'tree', 'parent_id', 'tree', 'id']] }).toJSON(), null);
    const box = l.boxes[0]!;
    expect(l.edges[0]?.x1).toBe(box.x + box.w);
    expect(l.edges[0]?.x2).toBe(box.x + box.w);
    expect(l.width).toBeGreaterThan(box.x + box.w);
  });
});
