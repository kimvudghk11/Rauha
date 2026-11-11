import { describe, expect, it } from 'vitest';
import { ConnectionsDto, DbConnections, MAX_CONNECTIONS } from './db-connections.js';
import { DbFilePath, DbInputError } from './db-names.js';

const p = (v: string) => DbFilePath.parse(v);

describe('저장한 DB 파일 목록', () => {
  it('파일을 더하면 id 와 보이는 이름이 생기고 최근에 쓴 순서로 나온다', () => {
    const c = DbConnections.empty();
    c.add(p('/data/a.db'), 'id1', 100);
    c.add(p('/data/b.sqlite'), 'id2', 200);
    expect(c.list().map((x) => x.name)).toEqual(['b.sqlite', 'a.db']);
    c.touch('id1', 300);
    expect(c.list().map((x) => x.name)).toEqual(['a.db', 'b.sqlite']);
  });
  it('같은 파일(대소문자·구분 기호만 다른 윈도우 경로 포함)을 또 더하면 새로 만들지 않고 기존 것을 최근으로 올린다', () => {
    const c = DbConnections.empty();
    const first = c.add(p('C:\\Data\\App.db'), 'id1', 100);
    const again = c.add(p('c:/data/app.DB'), 'id2', 200);
    expect(again.id).toBe(first.id);
    expect(c.list()).toHaveLength(1);
    expect(c.find('id1')?.lastUsed).toBe(200);
  });
  it('지우면 목록에서 빠지고 모르는 id 는 아무 일도 없다', () => {
    const c = DbConnections.empty();
    c.add(p('/a.db'), 'id1', 1);
    c.remove('nope');
    expect(c.list()).toHaveLength(1);
    c.remove('id1');
    expect(c.list()).toHaveLength(0);
    expect(c.find('id1')).toBeUndefined();
  });
  it(`${MAX_CONNECTIONS}개를 넘기면 거절한다(말없이 지우지 않는다)`, () => {
    const c = DbConnections.empty();
    for (let i = 0; i < MAX_CONNECTIONS; i += 1) c.add(p(`/d/f${i}.db`), `i${i}`, i);
    expect(() => c.add(p('/d/extra.db'), 'x', 99)).toThrow(DbInputError);
  });
});

describe('목록 JSON(DTO)', () => {
  it('저장했다가 읽으면 같은 목록이다', () => {
    const c = DbConnections.empty();
    c.add(p('/data/a.db'), 'id1', 100);
    const back = ConnectionsDto.from(ConnectionsDto.fromEntity(c).toJSON()).toEntity();
    expect(back.list()).toEqual(c.list());
  });
  it('깨진 항목(경로 규칙 위반·id 중복·글이 아닌 값)은 건너뛰고 개수를 센다', () => {
    const dto = ConnectionsDto.from({ version: 1, items: [{ id: 'ok1', path: '/a.db', lastUsed: 1 }, { id: 'bad', path: '\\\\server\\x.db', lastUsed: 1 }, { id: 'ok1', path: '/b.db', lastUsed: 1 }, 7, { id: 'x y', path: '/c.db' }] });
    expect(dto.toEntity().list().map((x) => x.id)).toEqual(['ok1']);
    expect(dto.skipped).toBe(4);
  });
  it('모르는 모양이면 빈 목록이다', () => {
    expect(ConnectionsDto.from(null).toEntity().list()).toEqual([]);
    expect(ConnectionsDto.from('x').toEntity().list()).toEqual([]);
    expect(ConnectionsDto.from({ items: 'no' }).toEntity().list()).toEqual([]);
  });
});
