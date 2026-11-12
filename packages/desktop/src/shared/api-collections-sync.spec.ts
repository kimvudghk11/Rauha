import { describe, expect, it } from 'vitest';
import { ApiCollections } from './api-collections.js';
import { ApiRequest } from './api-request.js';
import type { GeneratedProject } from './api-project.js';

const ROOT = 'E:/work/api';
const gen = (groups: Record<string, string[]>): GeneratedProject => ({
  project: ROOT,
  name: 'api',
  source: 'nest',
  variables: [],
  groups: Object.entries(groups).map(([g, keys]) => ({
    key: g,
    name: g,
    requests: keys.map((k) => {
      const [method, path] = k.split(' ') as [string, string];
      return { key: k, request: { name: `${method} ${path}`, method: method as 'GET', url: `{{base_url}}${path}`, query: [], headers: [], body: { kind: 'none' }, auth: { kind: 'none' } } };
    }),
  })),
});

let counter = 0;
const ids = () => () => `n${++counter}`;

const byKey = (c: ApiCollections, key: string) => c.nodes.find((n) => n.origin?.key === `req:${key}`);

describe('프로젝트 API 합치기', () => {
  it('처음 고르면 프로젝트 폴더 → 컨트롤러 폴더 → 요청 나무를 만든다', () => {
    const r = ApiCollections.empty().syncProject(gen({ User: ['GET /users', 'POST /users'], Auth: ['POST /login'] }), new Set(), ids());
    const tree = r.collections.tree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'folder', name: 'api' });
    const kids = tree[0]!.kind === 'folder' ? tree[0]!.children : [];
    expect(kids.map((k) => k.name)).toEqual(['Auth', 'User']);
    expect(r.report).toMatchObject({ added: 3, updated: 0, gone: 0, kept: 0 });
    expect([...r.known].sort()).toEqual(['GET /users', 'POST /login', 'POST /users']);
    expect(r.collections.node(r.rootId)?.origin).toMatchObject({ project: ROOT, key: 'root' });
  });

  it('새 엔드포인트는 추가하고 이미 있는 것은 그대로 둔다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users'] }), new Set(), ids());
    const keep = byKey(first.collections, 'GET /users')!.id;
    const second = first.collections.syncProject(gen({ User: ['GET /users', 'DELETE /users/:id'] }), new Set(first.known), ids());
    expect(byKey(second.collections, 'GET /users')!.id).toBe(keep);
    expect(byKey(second.collections, 'DELETE /users/:id')).toBeDefined();
    expect(second.report).toMatchObject({ added: 1, gone: 0 });
  });

  it('코드에서 사라진 엔드포인트는 지우지 않고 사라짐 표시만 한다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users', 'POST /users'] }), new Set(), ids());
    const second = first.collections.syncProject(gen({ User: ['GET /users'] }), new Set(first.known), ids());
    const gone = byKey(second.collections, 'POST /users');
    expect(gone?.origin?.gone).toBe(true);
    expect(second.report.gone).toBe(1);
    const back = second.collections.syncProject(gen({ User: ['GET /users', 'POST /users'] }), new Set(second.known), ids());
    expect(byKey(back.collections, 'POST /users')?.origin?.gone).toBe(false);
  });

  it('사용자가 손댄 요청(이름·헤더·본문)은 다시 읽어도 덮어쓰지 않는다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users'] }), new Set(), ids());
    const node = byKey(first.collections, 'GET /users')!;
    const req = first.collections.request(node.id)!;
    const edited = first.collections.updateRequest(ApiRequest.create({ ...req.props, name: 'My users', headers: [{ key: 'X-Trace', value: '1', enabled: true }] }));
    expect(byKey(edited, 'GET /users')?.origin).toBeDefined();
    const changed = gen({ User: ['GET /users'] });
    const renamed: GeneratedProject = { ...changed, groups: [{ ...changed.groups[0]!, requests: [{ ...changed.groups[0]!.requests[0]!, request: { ...changed.groups[0]!.requests[0]!.request, name: 'List users' } }] }] };
    const again = edited.syncProject(renamed, new Set(first.known), ids());
    const after = again.collections.request(node.id)!;
    expect(after.name).toBe('My users');
    expect(after.props.headers).toHaveLength(1);
    expect(again.report).toMatchObject({ kept: 1, updated: 0 });
  });

  it('손대지 않은 자동 요청은 코드가 바뀌면 새 모양으로 바뀐다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users'] }), new Set(), ids());
    const g = gen({ User: ['GET /users'] });
    const renamed: GeneratedProject = { ...g, groups: [{ ...g.groups[0]!, requests: [{ ...g.groups[0]!.requests[0]!, request: { ...g.groups[0]!.requests[0]!.request, name: 'List users' } }] }] };
    const again = first.collections.syncProject(renamed, new Set(first.known), ids());
    expect(again.collections.request(byKey(again.collections, 'GET /users')!.id)!.name).toBe('List users');
    expect(again.report.updated).toBe(1);
  });

  it('사용자가 지운 자동 요청은 다시 만들지 않는다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users', 'POST /users'] }), new Set(), ids());
    const removed = first.collections.remove(byKey(first.collections, 'POST /users')!.id);
    const again = removed.syncProject(gen({ User: ['GET /users', 'POST /users'] }), new Set(first.known), ids());
    expect(byKey(again.collections, 'POST /users')).toBeUndefined();
    expect(again.report.added).toBe(0);
  });

  it('프로젝트 폴더를 통째로 지우면 다음에 처음부터 다시 만든다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users'] }), new Set(), ids());
    const removed = first.collections.remove(first.rootId);
    const again = removed.syncProject(gen({ User: ['GET /users'] }), new Set(first.known), ids());
    expect(again.report.added).toBe(1);
  });

  it('사용자가 만든 요청과 복제본은 자동 생성 표시가 없고 합치기가 건드리지 않는다', () => {
    const first = ApiCollections.empty().syncProject(gen({ User: ['GET /users'] }), new Set(), ids());
    const mine = first.collections.addRequest(ApiRequest.create({ id: 'mine', name: 'Mine' }), first.rootId);
    const dup = mine.duplicate(byKey(mine, 'GET /users')!.id, () => 'dup1');
    expect(dup.node('mine')?.origin).toBeUndefined();
    expect(dup.node('dup1')?.origin).toBeUndefined();
    const again = dup.syncProject(gen({ User: [] }), new Set(first.known), ids());
    expect(again.collections.node('mine')).toBeDefined();
    expect(again.collections.node('dup1')?.origin).toBeUndefined();
    const items = again.collections.tree()[0];
    expect(items?.kind === 'folder' && items.children.some((c) => c.kind === 'request' && c.name === 'Mine' && !c.auto)).toBe(true);
  });

  it('다른 프로젝트의 자동 요청은 사라짐 표시를 하지 않는다', () => {
    const a = ApiCollections.empty().syncProject(gen({ User: ['GET /users'] }), new Set(), ids());
    const other: GeneratedProject = { ...gen({ Pet: ['GET /pets'] }), project: 'E:/work/other', name: 'other' };
    const b = a.collections.syncProject(other, new Set(), ids());
    expect(byKey(b.collections, 'GET /users')?.origin?.gone).toBe(false);
    expect(b.collections.tree().map((t) => t.name)).toEqual(['api', 'other']);
  });
});
