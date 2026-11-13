import { describe, expect, it } from 'vitest';
import { ApiCollections } from '../../shared/api-collections.js';
import { ApiEnvironment, ApiEnvironments } from '../../shared/api-env.js';
import { extractNest } from '../../shared/api-extract.js';
import { ProjectApiSpec } from '../../shared/api-project.js';
import type { PreparedRequest } from '../../shared/api-request.js';
import type { SendOutcome } from './api-sender.js';
import type { ApiStorePort } from './api-store.js';
import { ApiTestService } from './api-test-service.js';
import type { ProjectReaderPort } from './project-reader.js';

const mem = <T>(value: T): ApiStorePort<T> => ({ load: async () => value, save: async () => undefined });
const SECRET = 'sk-live-very-secret-999';

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '11' } }),
  'src/main.ts': "const app = await NestFactory.create(AppModule);\napp.useGlobalPipes(new ValidationPipe({ whitelist: true }));\nawait app.listen(3000);",
  'src/users/users.controller.ts': "import { CreateUserDto } from './create-user.dto';\n@ApiBearerAuth()\n@Controller('users')\nexport class UsersController {\n  @Post()\n  create(@Body() dto: CreateUserDto) {}\n}",
  'src/users/create-user.dto.ts': 'export class CreateUserDto {\n  @IsEmail()\n  email: string;\n}',
};

const reader: ProjectReaderPort = {
  survey: async () => ({ fingerprint: 'f', packageJsons: [FILES['package.json']!], jvmBuild: null, paths: Object.keys(FILES).filter((p) => p !== 'package.json'), truncated: false }),
  read: async (_root, paths) => paths.map((p) => ({ path: p, text: FILES[p]! })),
};

const REFUSED: SendOutcome = { ok: false, kind: 'network', error: 'Connection refused: nothing is listening at that address and port.', ms: 1 } as SendOutcome;

function setup(o: { baseUrl?: string; planOut?: unknown; statuses?: number[]; down?: boolean; refuseAfter?: number } = {}) {
  let n = 0;
  const newId = (): string => `id${++n}`;
  const spec = ProjectApiSpec.fromExtracted('/w/api', 'api', extractNest(Object.entries(FILES).map(([path, text]) => ({ path, text }))));
  const collections = ApiCollections.empty().syncProject(spec, new Set(), newId).collections;
  const request = collections.requests()[0]!;
  const env = ApiEnvironment.create({ id: 'e1', name: 'local', vars: [{ name: 'base_url', value: o.baseUrl ?? 'http://localhost:3000', secret: false }, { name: 'token', value: SECRET, secret: true }] });
  const prompts: string[] = [];
  const fixPrompts: string[] = [];
  const sent: PreparedRequest[] = [];
  const statuses = [...(o.statuses ?? [400, 201])];
  const service = new ApiTestService({
    collections: mem(collections),
    envs: mem(ApiEnvironments.of([env], 'e1')),
    reader,
    probe: async () => (o.down === true ? 'Connection refused: nothing is listening at that address and port.' : null),
    send: async (p): Promise<SendOutcome> => {
      sent.push(p);
      if (o.refuseAfter !== undefined && sent.length > o.refuseAfter) return REFUSED;
      return { ok: true, response: { status: statuses.shift() ?? 200, statusText: '', ms: 5, size: 2, headers: [], body: `{"echo":"${SECRET}"}`, truncated: false, contentType: 'application/json', redirects: [], binary: false } };
    },
    plan: async (prompt) => {
      prompts.push(prompt);
      return (
        o.planOut ?? {
          cases: [
            { category: 'validation', title: '이메일이 틀리면 400', expect_note: 'IsEmail', body: '{"email":"x"}', auth: 'default', expect_status: [400], evidence: 'src/users/create-user.dto.ts:2', mutates: false },
            { category: 'happy', title: '정상 생성', expect_note: '', body: '{"email":"user@example.com"}', auth: 'default', expect_status: [200], evidence: 'src/users/users.controller.ts:6', mutates: true },
          ],
          notes: '',
        }
      );
    },
    fixes: async (prompt) => {
      fixPrompts.push(prompt);
      return { summary: '요약', fixes: [{ case_id: 'x', cause: 'c', fix: 'f' }] };
    },
    newId,
    now: () => new Date('2026-11-12T00:00:00Z'),
    saveFile: async (name) => `/docs/${name}`,
  });
  return { service, request, prompts, fixPrompts, sent };
}

describe('AI API 시험 서비스', () => {
  it('프로젝트에서 만든 요청이 아니면 모델을 부르지 않고 막는다', async () => {
    const s = setup();
    const r = await s.service.plan({ requestId: 'nope', request: s.request.props });
    expect(r.ok).toBe(false);
    expect(s.prompts).toHaveLength(0);
  });

  it('base_url 이 이 컴퓨터가 아니면 모델을 부르지 않고 막는다', async () => {
    const s = setup({ baseUrl: 'https://api.example.com' });
    const r = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not local/);
    expect(s.prompts).toHaveLength(0);
  });

  it('케이스 만들기는 모델 한 번이고, 보낸 글에 코드는 있고 비밀 값은 없다', async () => {
    const s = setup();
    const r = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    expect(r.ok).toBe(true);
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]).toContain('src/users/users.controller.ts');
    expect(s.prompts[0]).toContain('ValidationPipe');
    expect(s.prompts[0]).not.toContain(SECRET);
    if (r.ok) expect(r.plan.cases.map((c) => c.risky)).toEqual([false, true]);
  });

  it('데이터를 바꾸는 케이스는 확인 없이 실행하지 않는다', async () => {
    const s = setup();
    const p = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    if (!p.ok) throw new Error(p.error);
    const r = await s.service.run({ planId: p.plan.id, caseIds: p.plan.cases.map((c) => c.id), confirmed: false });
    expect(r.ok).toBe(false);
    expect(s.sent).toHaveLength(0);
  });

  it('실행은 모델 없이 main 이 보내고, 토큰은 보낼 때만 채우고, 실패가 있으면 수정 제안을 한 번 받는다', async () => {
    const s = setup({ statuses: [400, 201] });
    const p = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    if (!p.ok) throw new Error(p.error);
    const r = await s.service.run({ planId: p.plan.id, caseIds: p.plan.cases.map((c) => c.id), confirmed: true });
    if (!r.ok) throw new Error(r.error);
    expect(s.sent).toHaveLength(2);
    expect(s.sent[0]!.headers).toContainEqual(['Authorization', `Bearer ${SECRET}`]);
    expect(r.report.counts).toEqual({ pass: 1, fail: 1, error: 0, total: 2 });
    expect(s.fixPrompts).toHaveLength(1);
    expect(s.fixPrompts[0]).not.toContain(SECRET);
    expect(r.report.markdown).not.toContain(SECRET);
    const saved = await s.service.save(p.plan.id);
    expect(saved).toEqual({ ok: true, saved: '/docs/api-test-post-users.md' });
  });

  it('서버가 꺼져 있으면 모델을 부르기 전에 바로 멈추고, 어느 주소인지와 켜는 방법을 알려 준다', async () => {
    const s = setup({ down: true });
    const r = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('http://localhost:3000');
      expect(r.error).toMatch(/start/i);
    }
    expect(s.prompts).toHaveLength(0);
  });

  it('계획에는 시험 대상(환경 이름·base_url)이 담겨 화면 머리에 보인다', async () => {
    const s = setup();
    const r = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.target).toEqual({ env: 'local', baseUrl: 'http://localhost:3000' });
  });

  it('실행 중 서버가 꺼지면 남은 케이스는 보내지 않고 "서버가 꺼져 건너뜀"으로 남긴다', async () => {
    const s = setup({ refuseAfter: 0 });
    const p = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    if (!p.ok) throw new Error(p.error);
    const r = await s.service.run({ planId: p.plan.id, caseIds: p.plan.cases.map((c) => c.id), confirmed: true });
    if (!r.ok) throw new Error(r.error);
    expect(s.sent).toHaveLength(1);
    expect(r.report.counts).toEqual({ pass: 0, fail: 0, error: 2, total: 2 });
    expect(r.report.serverDown).toBe(true);
    expect(s.fixPrompts).toHaveLength(0);
    expect(r.report.markdown).toMatch(/server stopped answering/i);
  });

  it('모두 통과하면 수정 제안을 부르지 않는다(모델 호출 1번)', async () => {
    const s = setup({ statuses: [400, 200] });
    const p = await s.service.plan({ requestId: s.request.id, request: s.request.props });
    if (!p.ok) throw new Error(p.error);
    const r = await s.service.run({ planId: p.plan.id, caseIds: p.plan.cases.map((c) => c.id), confirmed: true });
    expect(r.ok).toBe(true);
    expect(s.fixPrompts).toHaveLength(0);
  });
});
