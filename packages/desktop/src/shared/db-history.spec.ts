import { describe, expect, it } from 'vitest';
import { HISTORY_MAX, QueryHistory } from './db-history.js';

describe('최근 쿼리 기록', () => {
  it('돌린 쿼리를 맨 위에 쌓고, 같은 쿼리(앞뒤 공백 무시)는 한 번만 남겨 맨 위로 올린다', () => {
    const h = QueryHistory.empty().add('SELECT 1', 'c1', 10).add('SELECT 2', 'c1', 20).add('  SELECT 1 ', 'c1', 30);
    expect(h.items().map((i) => i.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(h.items()[0]?.at).toBe(30);
  });
  it(`${HISTORY_MAX}개를 넘으면 오래된 것부터 버린다`, () => {
    let h = QueryHistory.empty();
    for (let i = 0; i < HISTORY_MAX + 5; i += 1) h = h.add(`SELECT ${i}`, 'c1', i);
    expect(h.items()).toHaveLength(HISTORY_MAX);
    expect(h.items()[0]?.sql).toBe(`SELECT ${HISTORY_MAX + 4}`);
  });
  it('빈 쿼리·아주 긴 쿼리는 남기지 않는다', () => {
    expect(QueryHistory.empty().add('   ', 'c1', 1).items()).toEqual([]);
    expect(QueryHistory.empty().add('x'.repeat(20_001), 'c1', 1).items()).toEqual([]);
  });
  it('연결마다 따로 본다', () => {
    const h = QueryHistory.empty().add('A', 'c1', 1).add('B', 'c2', 2);
    expect(h.forConnection('c1').map((i) => i.sql)).toEqual(['A']);
  });
  it('저장했다 읽으면 같고, 깨진 항목은 버린다', () => {
    const h = QueryHistory.empty().add('A', 'c1', 1);
    expect(QueryHistory.restore(JSON.parse(JSON.stringify(h.toJSON()))).items()).toEqual(h.items());
    expect(QueryHistory.restore([{ sql: 5 }, null, { sql: 'ok', id: 'c', at: 1 }, 'x']).items().map((i) => i.sql)).toEqual(['ok']);
    expect(QueryHistory.restore('nope').items()).toEqual([]);
  });
  it('목록에 보일 한 줄: 줄바꿈과 겹친 공백을 하나로, 길면 줄인다', () => {
    expect(QueryHistory.oneLine('SELECT *\n  FROM  users')).toBe('SELECT * FROM users');
    expect(QueryHistory.oneLine('x'.repeat(200)).length).toBeLessThanOrEqual(121);
  });
});
