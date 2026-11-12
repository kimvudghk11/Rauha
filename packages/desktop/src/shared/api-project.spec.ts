import { describe, expect, it } from 'vitest';
import { ProjectApiSpec, ProjectStack } from './api-project.js';

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) => ({ name: 'x', dependencies: deps, devDependencies: dev });

describe('프로젝트 판별', () => {
  it('react·vite만 있는 package.json은 프론트엔드라 API 목록을 만들지 않는다', () => {
    const s = ProjectStack.judge({ packageJsons: [pkg({ react: '^18', 'react-dom': '^18' }, { vite: '^5' })], jvmBuild: null, paths: ['src/App.tsx', 'src/api/client.ts'] });
    expect(s.kind).toBe('frontend');
    expect(s.makesApi()).toBe(false);
  });

  it('vue·svelte·angular도 서버 프레임워크가 없으면 프론트엔드다', () => {
    for (const d of ['vue', 'svelte', '@angular/core', 'nuxt']) expect(ProjectStack.judge({ packageJsons: [pkg({ [d]: '1' })], jvmBuild: null, paths: [] }).kind).toBe('frontend');
  });

  it('@nestjs/core가 있으면 NestJS다(프론트 의존성이 같이 있어도)', () => {
    expect(ProjectStack.judge({ packageJsons: [pkg({ '@nestjs/core': '11', react: '18' })], jvmBuild: null, paths: [] }).kind).toBe('nest');
  });

  it('pom.xml·build.gradle에 spring이 있으면 Spring이다', () => {
    expect(ProjectStack.judge({ packageJsons: [], jvmBuild: '<artifactId>spring-boot-starter-web</artifactId>', paths: [] }).kind).toBe('spring');
  });

  it('express·fastify·koa가 있으면 Express 방식으로 읽는다', () => {
    expect(ProjectStack.judge({ packageJsons: [pkg({ fastify: '4' })], jvmBuild: null, paths: [] }).kind).toBe('express');
  });

  it('Next.js라도 app/api 라우트 파일이 있으면 서버 API로 본다', () => {
    expect(ProjectStack.judge({ packageJsons: [pkg({ next: '15', react: '19' })], jvmBuild: null, paths: ['src/app/api/users/route.ts'] }).kind).toBe('next');
    expect(ProjectStack.judge({ packageJsons: [pkg({ next: '15', react: '19' })], jvmBuild: null, paths: ['src/app/page.tsx'] }).kind).toBe('frontend');
  });

  it('모노레포는 하위 package.json 의존성까지 합쳐서 본다', () => {
    expect(ProjectStack.judge({ packageJsons: [pkg({}), pkg({ react: '18' }), pkg({ '@nestjs/common': '11' })], jvmBuild: null, paths: [] }).kind).toBe('nest');
  });

  it('아무 단서가 없으면 모른다(OpenAPI 파일이 있으면 그것만 쓴다)', () => {
    const s = ProjectStack.judge({ packageJsons: [], jvmBuild: null, paths: ['README.md'] });
    expect(s.kind).toBe('unknown');
    expect(s.makesApi()).toBe(true);
  });

  it('OpenAPI 파일은 얕은 것부터 고른다', () => {
    const s = ProjectStack.judge({ packageJsons: [pkg({ express: '4' })], jvmBuild: null, paths: ['a/b/openapi.json', 'docs/swagger.json', 'src/x.ts'] });
    expect(s.openApiPaths(['a/b/openapi.json', 'docs/swagger.json', 'src/x.ts', 'swagger-ui.css'])).toEqual(['docs/swagger.json', 'a/b/openapi.json']);
  });
});

describe('생성할 요청 모양', () => {
  it('코드에서 읽은 엔드포인트는 {{base_url}}과 {{경로변수}}로 된 요청이 되고 키는 메서드+경로다', () => {
    const spec = ProjectApiSpec.fromExtracted('/w/api', 'api', {
      source: 'nest',
      port: 8080,
      groups: [{ key: 'UserController', name: 'User', endpoints: [{ method: 'POST', path: '/users/:id/roles', name: 'add', query: ['force'], body: { role: '' }, bearer: true }] }],
    });
    const g = spec.groups[0]!;
    expect(g.requests[0]!.key).toBe('POST /users/:id/roles');
    const r = g.requests[0]!.request;
    expect(r.url).toBe('{{base_url}}/users/{{id}}/roles');
    expect(r.query).toEqual([{ key: 'force', value: '', enabled: false }]);
    expect(r.body).toEqual({ kind: 'json', text: JSON.stringify({ role: '' }, null, 2) });
    expect(r.auth).toEqual({ kind: 'bearer', token: '{{token}}' });
    expect(spec.variables).toEqual([
      { name: 'base_url', value: 'http://localhost:8080', secret: false },
      { name: 'token', value: '', secret: true },
      { name: 'id', value: '', secret: false },
    ]);
    expect(spec.requestCount()).toBe(1);
  });

  it('예시 값이 있으면 쿼리 값과 경로 변수의 환경 값에 미리 채운다(쿼리는 켜지 않는다)', () => {
    const spec = ProjectApiSpec.fromExtracted('/w/api', 'api', {
      source: 'nest',
      port: 3000,
      groups: [{ key: 'U', name: 'U', endpoints: [{ method: 'GET', path: '/users/:id', name: 'one', query: ['page'], body: null, bearer: false, examples: { id: '1', page: '2' } }] }],
    });
    expect(spec.groups[0]!.requests[0]!.request.query).toEqual([{ key: 'page', value: '2', enabled: false }]);
    expect(spec.variables.find((v) => v.name === 'id')).toEqual({ name: 'id', value: '1', secret: false });
  });

  it('OpenAPI 문서는 태그가 묶음, 메서드+경로가 키가 된다', () => {
    const doc = { openapi: '3.0.0', info: { title: 'Pets' }, servers: [{ url: 'http://localhost:4000' }], paths: { '/pets/{id}': { get: { tags: ['pets'], summary: 'Get pet' } } } };
    const spec = ProjectApiSpec.fromOpenApi('/w/p', 'p', JSON.stringify(doc));
    expect(spec.source).toBe('openapi');
    expect(spec.groups[0]!.name).toBe('pets');
    expect(spec.groups[0]!.requests[0]!.key).toBe('GET /pets/:id');
    expect(spec.variables[0]).toEqual({ name: 'base_url', value: 'http://localhost:4000', secret: false });
  });

  it('같은 메서드+경로가 두 번 나오면 처음 것만 둔다', () => {
    const e = { method: 'GET' as const, path: '/a', name: 'a', query: [], body: null, bearer: false };
    const spec = ProjectApiSpec.fromExtracted('/w', 'w', { source: 'express', port: null, groups: [{ key: 'g1', name: 'g1', endpoints: [e] }, { key: 'g2', name: 'g2', endpoints: [e] }] });
    expect(spec.requestCount()).toBe(1);
    expect(spec.groups.map((g) => g.key)).toEqual(['g1']);
  });
});
