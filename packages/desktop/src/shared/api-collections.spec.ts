import { describe, expect, it } from 'vitest';
import { ApiCollections } from './api-collections.js';
import { ApiError, ApiRequest } from './api-request.js';
import { CollectionOpDto, CollectionsDto, EnvOpDto, EnvironmentsDto, ExportRequestDto, HistoryDto, ImportRequestDto, SendRequestDto, ApiRequestDto, safeRequestJson } from './api-dto.js';
import { ApiEnvironment, ApiEnvironments } from './api-env.js';

const FAKE = ['tok', 'en', '-abc', '123456'].join('');
let n = 0;
const nid = (): string => `n${++n}`;
const r = (id: string, name: string): ApiRequest => ApiRequest.create({ id, name, url: 'http://x' });

describe('컬렉션', () => {
  it('폴더 안에 요청을 넣고 폴더가 먼저, 이름순으로 나무를 만든다', () => {
    const c = ApiCollections.empty().addRequest(r('b', 'Beta'), null).addFolder('f', 'Users', null).addRequest(r('a', 'Alpha'), 'f').addRequest(r('c', 'Aardvark'), null);
    const t = c.tree();
    expect(t.map((x) => x.name)).toEqual(['Users', 'Aardvark', 'Beta']);
    expect(t[0]).toMatchObject({ kind: 'folder', children: [{ id: 'a' }] });
  });
  it('같은 폴더에서 이름이 겹치면 번호를 붙인다', () => {
    const c = ApiCollections.empty().addRequest(r('a', 'List'), null).addRequest(r('b', 'list'), null);
    expect(c.request('b')?.name).toBe('list 2');
  });
  it('폴더를 지우면 안의 것도 같이 지워진다', () => {
    const c = ApiCollections.empty().addFolder('f', 'F', null).addFolder('g', 'G', 'f').addRequest(r('a', 'A'), 'g').addRequest(r('b', 'B'), null);
    expect(c.remove('f').nodes.map((x) => x.id)).toEqual(['b']);
  });
  it('복제하면 새 번호와 "이름 2"로 같은 자리에 놓인다(폴더는 안의 것까지)', () => {
    const c = ApiCollections.empty().addFolder('f', 'F', null).addRequest(r('a', 'A'), 'f');
    const d = c.duplicate('f', nid);
    expect(d.nodes).toHaveLength(4);
    expect(d.tree().map((x) => x.name)).toEqual(['F', 'F 2']);
    expect(new Set(d.nodes.map((x) => x.id)).size).toBe(4);
  });
  it('폴더를 자기 안으로는 옮길 수 없다', () => {
    const c = ApiCollections.empty().addFolder('f', 'F', null).addFolder('g', 'G', 'f');
    expect(() => c.move('f', 'g')).toThrow('itself');
    expect(c.move('g', null).node('g')?.parentId).toBeNull();
  });
  it('이름 바꾸기에 빈 이름은 오류다', () => {
    expect(() => ApiCollections.empty().addRequest(r('a', 'A'), null).rename('a', '  ')).toThrow(ApiError);
  });
  it('폴더를 너무 깊게 중첩하면 오류다', () => {
    let c = ApiCollections.empty();
    let parent: string | null = null;
    expect(() => {
      for (let i = 0; i < 8; i++) {
        c = c.addFolder(`d${i}`, `D${i}`, parent);
        parent = `d${i}`;
      }
    }).toThrow('nested');
  });
  it('가져온 묶음은 새 폴더 아래 태그별 폴더로 들어간다', () => {
    const c = ApiCollections.empty().addImport({ name: 'Pets', groups: [{ name: 'pets', requests: [r('x', 'List')] }, { name: 'users', requests: [r('y', 'Me')] }], variables: [] }, nid);
    const t = c.tree();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ name: 'Pets', children: [{ name: 'pets' }, { name: 'users' }] });
  });
});

describe('API DTO 검사', () => {
  it('요청: 모르는 메서드·거대한 값·잘못된 형식은 거부한다', () => {
    const ok = { id: 'a', name: 'n', method: 'get', url: 'http://x' };
    expect(ApiRequestDto.from(ok).json.method).toBe('GET');
    expect(() => ApiRequestDto.from({ ...ok, method: 'TRACE' })).toThrow('not supported');
    expect(() => ApiRequestDto.from({ ...ok, url: 'x'.repeat(9000) })).toThrow('too long');
    expect(() => ApiRequestDto.from({ ...ok, url: 5 })).toThrow('must be text');
    expect(() => ApiRequestDto.from({ ...ok, headers: 'x' })).toThrow('list');
    expect(() => ApiRequestDto.from({ ...ok, headers: Array.from({ length: 101 }, () => ({ key: 'a', value: 'b' })) })).toThrow('at most');
    expect(() => ApiRequestDto.from({ ...ok, body: { kind: 'xml' } })).toThrow('Body type');
    expect(() => ApiRequestDto.from({ ...ok, auth: { kind: 'apikey', in: 'cookie' } })).toThrow('location');
    expect(() => ApiRequestDto.from({ ...ok, id: '../x' })).toThrow('not valid');
    expect(() => ApiRequestDto.from(null)).toThrow('object');
    expect(() => ApiRequestDto.from([])).toThrow('object');
  });
  it('__proto__·constructor 같은 필드는 어디에 있어도 거부한다', () => {
    const evil = JSON.parse('{"id":"a","name":"n","url":"http://x","body":{"kind":"none","__proto__":{"x":1}}}');
    expect(() => ApiRequestDto.from(evil)).toThrow('forbidden');
    expect(() => EnvOpDto.from(JSON.parse('{"kind":"add","name":"a","constructor":{}}'))).toThrow('forbidden');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });
  it('너무 깊게 중첩된 값은 거부한다', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 30; i++) deep = { a: deep };
    expect(() => SendRequestDto.from({ key: 'k', request: { id: 'a', url: 'x', extra: deep } })).toThrow('deeply');
  });
  it('작업 요청: 알 수 없는 종류는 오류, 맞는 것은 정리해서 통과한다', () => {
    expect(() => CollectionOpDto.from({ kind: 'drop-all' })).toThrow('Unknown');
    expect(CollectionOpDto.from({ kind: 'move', id: 'a' })).toEqual({ kind: 'move', id: 'a', parentId: null });
    expect(() => EnvOpDto.from({ kind: 'save', id: 'e', name: 'n', vars: [{ name: 'a', value: 5 }] })).toThrow('must be text');
    expect(() => ImportRequestDto.from({ format: 'xml', text: '' })).toThrow('format');
    expect(() => ExportRequestDto.from({ format: 'curl' })).toThrow();
  });
  it('저장 파일: 깨진 항목은 건너뛰고 나머지는 연다', () => {
    const dto = CollectionsDto.from({ nodes: [{ kind: 'request', id: 'a', parentId: null, request: { id: 'a', name: 'A', url: 'http://x' } }, { kind: 'request', id: 'b', parentId: 'ghost', request: { id: 'b', url: 'x' } }, 5, { kind: 'folder' }] });
    expect(dto.toEntity().nodes.map((x) => x.id)).toEqual(['a']);
    expect(dto.skipped).toBe(3);
    expect(CollectionsDto.from('nonsense').toEntity().nodes).toEqual([]);
  });
  it('환경 저장 파일은 비밀 값을 담지만 화면용 view에는 없다', () => {
    const envs = ApiEnvironments.empty().add(ApiEnvironment.create({ id: 'a', name: 'L', vars: [{ name: 'tok', value: FAKE, secret: true }] }));
    const stored = EnvironmentsDto.fromEntity(envs).toJSON();
    expect(JSON.stringify(stored)).toContain(FAKE);
    expect(EnvironmentsDto.from(JSON.parse(JSON.stringify(stored))).toEntity().selectedVariables().get('tok')).toBe(FAKE);
    expect(JSON.stringify(EnvironmentsDto.view(envs))).not.toContain(FAKE);
  });
  it('기록 저장 파일은 100개까지만 읽는다', () => {
    const entries = Array.from({ length: 150 }, (_, i) => ({ id: `h${i}`, at: 'x', request: { id: 'r', url: 'u' }, status: 200, ms: 1, size: 1, error: null, response: null }));
    expect(HistoryDto.from({ entries }).toEntity().entries).toHaveLength(100);
  });
  it('화면에 보내는 요청에서는 값으로 적힌 비밀이 변수 이름이 된다', () => {
    const j = safeRequestJson(ApiRequest.create({ id: 'a', name: 'X', auth: { kind: 'bearer', token: FAKE } }));
    expect(JSON.stringify(j)).not.toContain(FAKE);
  });
});
