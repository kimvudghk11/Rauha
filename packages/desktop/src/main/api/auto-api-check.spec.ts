import { describe, expect, it } from 'vitest';
import type { ServerLaunch } from '../../shared/api-auto.js';
import type { PreparedRequest } from '../../shared/api-request.js';
import type { SendOutcome } from './api-sender.js';
import { autoApiCheck, type AutoApiDeps } from './auto-api-check.js';
import type { ProjectReaderPort } from './project-reader.js';

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '11' }, scripts: { 'start:dev': 'nest start --watch' } }),
  'src/main.ts': 'const app = await NestFactory.create(AppModule);\nawait app.listen(3000);',
  'src/users/users.controller.ts': "import { CreateUserDto } from './create-user.dto';\n@Controller('users')\nexport class UsersController {\n  @Post()\n  create(@Body() dto: CreateUserDto) {}\n  @Get()\n  list() {}\n}",
  'src/users/create-user.dto.ts': 'export class CreateUserDto {\n  @IsEmail()\n  email: string;\n}',
};

const reader: ProjectReaderPort = {
  survey: async () => ({ fingerprint: 'f', packageJsons: [FILES['package.json']!], jvmBuild: null, paths: Object.keys(FILES).filter((p) => p !== 'package.json'), truncated: false }),
  read: async (_root, paths) => paths.map((p) => ({ path: p, text: FILES[p]! })),
};

const PLAN = {
  cases: [
    { category: 'validation', title: '이메일이 틀리면 400', expect_note: 'IsEmail', body: '{"email":"x"}', auth: 'default', expect_status: [400], evidence: 'src/users/create-user.dto.ts:2', mutates: false },
    { category: 'happy', title: '정상 생성', expect_note: '', body: '{"email":"user@example.com"}', auth: 'default', expect_status: [201], evidence: 'src/users/users.controller.ts:5', mutates: true },
  ],
  notes: '',
};

function setup(o: { down?: boolean; allow?: boolean | boolean[]; statuses?: number[]; launchFails?: string; noLaunch?: boolean } = {}) {
  let n = 0;
  const asked: { detail: string; reason: string }[] = [];
  const said: string[] = [];
  const sent: PreparedRequest[] = [];
  const launched: ServerLaunch[] = [];
  let stopped = 0;
  let plans = 0;
  let fixes = 0;
  const answers = Array.isArray(o.allow) ? [...o.allow] : null;
  const statuses = [...(o.statuses ?? [400, 201, 400, 201])];
  const deps: AutoApiDeps = {
    reader,
    readText: async (_r, rel) => (rel === 'package.json' && o.noLaunch !== true ? FILES['package.json']! : null),
    listRoot: async () => ['package.json'],
    probe: async () => (o.down === true ? 'Connection refused' : null),
    send: async (p): Promise<SendOutcome> => {
      sent.push(p);
      return { ok: true, response: { status: statuses.shift() ?? 200, statusText: '', ms: 5, size: 2, headers: [], body: '{}', truncated: false, contentType: 'application/json', redirects: [], binary: false } };
    },
    plan: async () => {
      plans += 1;
      return PLAN;
    },
    fixes: async () => {
      fixes += 1;
      return { summary: '검증이 빠졌어요', fixes: [] };
    },
    launch: async (_root, how) => {
      launched.push(how);
      if (o.launchFails !== undefined) return o.launchFails;
      return { stop: async () => void (stopped += 1) };
    },
    ask: async (detail, reason) => {
      asked.push({ detail, reason });
      return answers !== null ? (answers.shift() ?? false) : o.allow !== false;
    },
    say: (line) => said.push(line),
    newId: () => `id${++n}`,
    now: () => new Date('2026-11-17T00:00:00Z'),
    platform: 'linux',
  };
  return { deps, asked, said, sent, launched, stopped: () => stopped, plans: () => plans, fixes: () => fixes };
}

const touched = [{ path: 'src/users/users.controller.ts', kind: 'modified' }];

describe('자동 API 점검', () => {
  it('API 파일을 안 건드렸으면 아무것도 하지 않는다(모델·서버·허락 없음)', async () => {
    const s = setup({ down: true });
    expect(await autoApiCheck(s.deps, '/w/api', [{ path: 'README.md', kind: 'modified' }])).toBeNull();
    expect(s.plans()).toBe(0);
    expect(s.asked).toEqual([]);
  });

  it('서버가 꺼져 있으면 띄울 명령을 보여 주고 허락받은 뒤 띄우고, 시험이 끝나면 끈다', async () => {
    const s = setup({ down: true });
    const r = await autoApiCheck(s.deps, '/w/api', touched);
    expect(s.asked[0]!.detail).toBe('npm run start:dev');
    expect(s.asked[0]!.reason).toContain('데이터가 바뀔 수 있어요');
    expect(s.launched[0]!.command).toBe('npm run start:dev');
    expect(s.stopped()).toBe(1);
    expect(s.sent.every((p) => p.url.startsWith('http://localhost:3000/users'))).toBe(true);
    expect(r?.line).toContain('API 2개');
    expect(r?.fixRequest).toBeNull();
  });

  it('띄우기를 거절하면 보내지 않고 건너뛴다고 알린다', async () => {
    const s = setup({ down: true, allow: false });
    const r = await autoApiCheck(s.deps, '/w/api', touched);
    expect(s.launched).toEqual([]);
    expect(s.sent).toEqual([]);
    expect(s.plans()).toBe(0);
    expect(r?.line).toContain('건너뛰었어요');
  });

  it('서버를 못 띄우면 이유를 알리고, 띄울 명령이 없으면 지어내지 않는다', async () => {
    expect((await autoApiCheck(setup({ down: true, launchFails: '90초 안에 응답이 없어요' }).deps, '/w/api', touched))?.line).toContain('90초');
    const none = setup({ down: true, noLaunch: true });
    expect((await autoApiCheck(none.deps, '/w/api', touched))?.line).toContain('찾지 못했어요');
    expect(none.asked).toEqual([]);
  });

  it('이미 떠 있는 서버면 데이터를 바꾸는 케이스는 따로 묻고, 거절하면 읽기 케이스만 보낸다', async () => {
    const s = setup({ allow: [false, false] });
    await autoApiCheck(s.deps, '/w/api', touched);
    expect(s.launched).toEqual([]);
    expect(s.asked[0]!.detail).toContain('데이터를 바꾸는 케이스');
    expect(s.sent.every((p) => !p.body || !String(p.body).includes('user@example.com'))).toBe(true);
  });

  it('실패가 있으면 원인·수정 방향을 받아 같은 팀에 맡길 글을 만든다', async () => {
    const s = setup({ statuses: [201, 201, 201, 201] });
    const r = await autoApiCheck(s.deps, '/w/api', touched);
    expect(s.fixes()).toBeGreaterThan(0);
    expect(r?.fixRequest).toContain('API 테스트에서 실패한 케이스를 고쳐 줘');
    expect(r?.line).toContain('실패했어요');
  });
});
