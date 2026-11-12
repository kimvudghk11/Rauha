import { describe, expect, it } from 'vitest';
import { ApiCollections } from '../../shared/api-collections.js';
import { ApiEnvironments } from '../../shared/api-env.js';
import { ApiProjects } from '../../shared/api-project.js';
import { ApiHistory } from '../../shared/api-response.js';
import { ApiService } from './api-service.js';
import type { ApiStorePort } from './api-store.js';
import type { ProjectReaderPort } from './project-reader.js';

const mem = <T>(value: T): ApiStorePort<T> & { value: T } => {
  const s = { value, load: async () => s.value, save: async (v: T) => void (s.value = v) };
  return s;
};

/** 메모리 속 가짜 프로젝트들: 경로 → 파일 내용. 지문은 파일 내용을 이어 붙인 것 */
function fakeReader(trees: Record<string, Record<string, string>>) {
  const reads: string[][] = [];
  const reader: ProjectReaderPort = {
    survey: async (root) => {
      const files = trees[root] ?? {};
      const paths = Object.keys(files).filter((p) => !p.endsWith('package.json'));
      return {
        fingerprint: Object.entries(files).map(([p, t]) => `${p}:${t.length}:${t}`).join('|'),
        packageJsons: Object.entries(files).filter(([p]) => p.endsWith('package.json')).map(([, t]) => t),
        jvmBuild: files['pom.xml'] ?? null,
        paths,
        truncated: false,
      };
    },
    read: async (root, paths) => {
      reads.push([...paths]);
      return paths.flatMap((p) => (trees[root]?.[p] === undefined ? [] : [{ path: p, text: trees[root]![p]! }]));
    },
  };
  return { reader, reads };
}

const NEST_PKG = JSON.stringify({ dependencies: { '@nestjs/core': '11' } });
const CTRL = (extra = '') => `@Controller('users')\nexport class UsersController {\n  @Get()\n  list() {}\n${extra}}`;

function setup(trees: Record<string, Record<string, string>>) {
  let n = 0;
  const collections = mem(ApiCollections.empty());
  const envs = mem(ApiEnvironments.empty());
  const projects = mem(ApiProjects.empty());
  const fake = fakeReader(trees);
  const service = new ApiService({
    collections,
    envs,
    history: mem(ApiHistory.empty()),
    projects,
    reader: fake.reader,
    listProjects: async () => Object.keys(trees).map((root) => ({ root, name: root.split('/').pop() ?? root, relative: root })),
    send: (async () => ({ ok: false, kind: 'network', error: 'x', ms: 0 })) as never,
    newId: () => `id${++n}`,
    now: () => new Date('2026-01-01T00:00:00Z'),
    saveFile: async () => null,
  });
  return { service, collections, envs, projects, ...fake };
}

describe('프로젝트 API 동기화', () => {
  it('고른 프로젝트 하나만 읽어 컨트롤러 폴더를 만들고, 고른 것을 기억한다', async () => {
    const { service, reads, projects } = setup({ '/w/api': { 'package.json': NEST_PKG, 'src/users.controller.ts': CTRL() }, '/w/web': { 'package.json': '{}' } });
    const r = await service.syncProject({ root: '/w/api' });
    expect(r.ok && r.status).toBe('synced');
    if (!r.ok) return;
    expect(r.source).toBe('nest');
    expect(r.report).toMatchObject({ added: 1 });
    expect(reads).toHaveLength(1);
    expect(projects.value.selected).toBe('/w/api');
    expect((await service.listProjects()).selected).toBe('/w/api');
    expect(JSON.stringify(r.collections)).toContain('"key":"req:GET /users"');
    expect(r.envs?.items[0]?.vars.map((v) => v.name)).toContain('base_url');
  });

  it('프론트엔드 레포는 파일을 읽지 않고 frontend로 답한다', async () => {
    const { service, reads, collections } = setup({ '/w/web': { 'package.json': JSON.stringify({ dependencies: { react: '18' }, devDependencies: { vite: '5' } }), 'src/main.ts': 'x' } });
    const r = await service.syncProject({ root: '/w/web' });
    expect(r.ok && r.status).toBe('frontend');
    expect(reads).toHaveLength(0);
    expect(collections.value.nodes).toHaveLength(0);
  });

  it('지문이 같으면 다시 읽지 않고, 바뀌면 다시 읽어 합친다', async () => {
    const trees = { '/w/api': { 'package.json': NEST_PKG, 'src/users.controller.ts': CTRL() } };
    const { service, reads } = setup(trees);
    await service.syncProject({ root: '/w/api' });
    const same = await service.syncProject({ root: '/w/api' });
    expect(same.ok && same.status).toBe('unchanged');
    expect(reads).toHaveLength(1);
    trees['/w/api']['src/users.controller.ts'] = CTRL("  @Post()\n  create(@Body() b: X) {}\n");
    const changed = await service.syncProject({ root: '/w/api' });
    expect(changed.ok && changed.status).toBe('synced');
    if (changed.ok) expect(changed.report).toMatchObject({ added: 1 });
    expect(reads).toHaveLength(2);
  });

  it('작업 폴더 목록에 없는 경로는 읽지 않는다', async () => {
    const { service, reads } = setup({ '/w/api': { 'package.json': NEST_PKG } });
    const r = await service.syncProject({ root: 'C:/Windows' });
    expect(r.ok).toBe(false);
    expect(reads).toHaveLength(0);
  });

  it('API를 찾지 못하면 empty로 답하고 컬렉션을 만들지 않는다', async () => {
    const { service, collections } = setup({ '/w/lib': { 'package.json': JSON.stringify({ dependencies: { lodash: '4' } }), 'src/index.ts': 'export const a = 1;' } });
    const r = await service.syncProject({ root: '/w/lib' });
    expect(r.ok && r.status).toBe('empty');
    expect(collections.value.nodes).toHaveLength(0);
  });

  it('OpenAPI JSON 파일이 있으면 코드보다 그것을 먼저 쓴다', async () => {
    const doc = JSON.stringify({ openapi: '3.0.0', info: { title: 'T' }, paths: { '/a': { get: { tags: ['A'] } }, '/b': { post: { tags: ['B'] } } } });
    const { service } = setup({ '/w/api': { 'package.json': NEST_PKG, 'docs/openapi.json': doc, 'src/users.controller.ts': CTRL() } });
    const r = await service.syncProject({ root: '/w/api' });
    expect(r.ok && r.source).toBe('openapi');
    if (r.ok) expect(r.report?.added).toBe(2);
  });
});
