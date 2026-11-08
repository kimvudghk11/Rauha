import { describe, expect, it } from 'vitest';
import { SecretPolicy } from '../domain/secret-policy.js';
import { createToolGuard, type PermissionAnswer, type PermissionRequest, type ToolGuardOptions } from './tool-guard.js';

const ROOT = 'E:/work/app';

function input(tool_name: string, tool_input: Record<string, unknown>) {
  return {
    hook_event_name: 'PreToolUse' as const,
    tool_name,
    tool_input,
    tool_use_id: 't1',
    session_id: 's',
    transcript_path: '',
    cwd: ROOT,
  };
}

const output = (out: unknown) =>
  (out as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput;
const decision = (out: unknown) => output(out)?.permissionDecision;
const opts = { signal: new AbortController().signal };

function guardWith(answers: PermissionAnswer[], overrides: Partial<ToolGuardOptions> = {}) {
  const asked: PermissionRequest[] = [];
  const guard = createToolGuard({
    root: ROOT,
    role: 'implementer',
    canWrite: () => true,
    remembered: new Set(),
    secrets: SecretPolicy.defaults(),
    secretFiles: () => [],
    ask: async (request) => {
      asked.push(request);
      return answers.shift() ?? { kind: 'deny', note: null };
    },
    ...overrides,
  });
  return { guard, asked };
}

describe('createToolGuard', () => {
  it('비밀 파일은 읽기·쓰기·셸 모두 묻지 않고 거절한다', async () => {
    const { guard, asked } = guardWith([{ kind: 'allow' }]);
    for (const [tool, toolInput] of [
      ['Read', { file_path: 'E:\\work\\app\\.env' }],
      ['Write', { file_path: 'E:/work/app/certs/server.pem' }],
      ['Grep', { pattern: 'KEY', path: '.env.local' }],
      ['Bash', { command: 'cat .env' }],
    ] as const) {
      const out = await guard(input(tool, toolInput), 't1', opts);
      expect(decision(out)).toBe('deny');
      expect(output(out)?.permissionDecisionReason).toContain('비밀 파일');
    }
    expect(asked).toEqual([]);
  });

  it('함께 열어 준 폴더(작업 공간 폴더 등) 안의 쓰기는 묻지 않고 그 폴더 기준으로 역할 권한만 본다', async () => {
    const { guard, asked } = guardWith([], { role: 'writer', canWrite: (rel) => rel.endsWith('.md'), extraRoots: ['E:/work'] });
    expect(await guard(input('Write', { file_path: 'E:/work/RESUME.md' }), 't1', opts)).toEqual({});
    expect(decision(await guard(input('Write', { file_path: 'E:/work/other/src/app.ts' }), 't1', opts))).toBe('deny');
    expect(asked).toEqual([]);
  });

  it('열어 준 폴더가 아닌 밖에 쓰는 것은 여전히 묻는다', async () => {
    const { guard, asked } = guardWith([{ kind: 'deny', note: null }], { role: 'writer', canWrite: () => true, extraRoots: ['E:/work'] });
    await guard(input('Write', { file_path: 'E:/elsewhere/a.md' }), 't1', opts);
    expect(asked).toHaveLength(1);
  });

  it('비밀 파일이 있는 폴더를 내용으로 Grep하거나 glob으로 비밀 파일을 겨누면 거절한다', async () => {
    const { guard } = guardWith([], { secretFiles: () => ['config/prod.json'], secrets: SecretPolicy.of(['config/prod.json']) });
    expect(decision(await guard(input('Grep', { pattern: 'password', output_mode: 'content' }), 't1', opts))).toBe('deny');
    expect(decision(await guard(input('Grep', { pattern: 'password', path: 'config', output_mode: 'content' }), 't1', opts))).toBe('deny');
    expect(decision(await guard(input('Grep', { pattern: 'KEY', glob: '.env*' }), 't1', opts))).toBe('deny');
    // 파일 이름만 찾는 검색과 비밀 파일이 없는 폴더의 내용 검색은 그대로 둔다.
    expect(await guard(input('Grep', { pattern: 'password' }), 't1', opts)).toEqual({});
    expect(await guard(input('Grep', { pattern: 'password', path: 'src', output_mode: 'content' }), 't1', opts)).toEqual({});
  });

  it('예시 파일은 그대로 읽게 둔다', async () => {
    const { guard } = guardWith([]);
    expect(await guard(input('Read', { file_path: 'E:/work/app/.env.example' }), 't1', opts)).toEqual({});
  });

  it('잠긴 테스트 쓰기는 묻지 않고 거절한다', async () => {
    const { guard, asked } = guardWith([], { canWrite: (p) => !p.endsWith('.spec.ts') });
    const out = await guard(input('Edit', { file_path: 'E:\\work\\app\\src\\a.spec.ts' }), 't1', opts);
    expect(decision(out)).toBe('deny');
    expect(asked).toEqual([]);
  });

  it('위험 명령은 누가·어떤 도구로·무엇을·왜 하는지 묻고 답에 따른다', async () => {
    const { guard, asked } = guardWith([{ kind: 'allow' }, { kind: 'deny', note: null }]);
    expect(decision(await guard(input('Bash', { command: 'rm -rf dist' }), 't', opts))).toBe('allow');
    expect(decision(await guard(input('Bash', { command: 'rm -rf dist' }), 't', opts))).toBe('deny');
    expect(asked[0]).toMatchObject({ role: 'implementer', tool: 'Bash', detail: 'rm -rf dist' });
    expect(asked[0]!.reason).not.toBe('');
  });

  it('거절하면서 남긴 말은 팀원에게 거절 이유로 전달된다', async () => {
    const { guard } = guardWith([{ kind: 'deny', note: 'dist는 지우지 말고 build 폴더만 정리해' }]);
    const out = await guard(input('Bash', { command: 'rm -rf dist' }), 't', opts);
    expect(decision(out)).toBe('deny');
    expect(output(out)?.permissionDecisionReason).toContain('dist는 지우지 말고 build 폴더만 정리해');
  });

  it('이번 실행 동안 계속 허락하면 같은 명령은 다른 팀원 호출에서도 다시 묻지 않는다', async () => {
    const remembered = new Set<string>();
    const first = guardWith([{ kind: 'allow-always' }], { remembered });
    const second = guardWith([], { remembered, role: 'tester' });
    expect(decision(await first.guard(input('Bash', { command: 'rm -rf dist' }), 't', opts))).toBe('allow');
    expect(decision(await second.guard(input('Bash', { command: 'rm -rf dist' }), 't', opts))).toBe('allow');
    expect(second.asked).toEqual([]);
    const other = await second.guard(input('Bash', { command: 'rm -rf src' }), 't', opts);
    expect(decision(other)).toBe('deny');
    expect(second.asked).toHaveLength(1);
  });

  it('git commit은 묻지 않고 거절한다', async () => {
    const { guard, asked } = guardWith([{ kind: 'allow' }]);
    expect(decision(await guard(input('Bash', { command: 'git commit -m x' }), 't', opts))).toBe('deny');
    expect(asked).toEqual([]);
  });

  it('안전한 호출은 결정을 내리지 않고 그대로 둔다', async () => {
    const { guard } = guardWith([]);
    expect(decision(await guard(input('Bash', { command: 'yarn test' }), 't', opts))).toBeUndefined();
  });

  describe('인프라 위험도', () => {
    it('운영 팀원이 명령 설명에 적은 위험도를 허락 요청에 함께 싣는다', async () => {
      const { guard, asked } = guardWith([{ kind: 'allow' }], { role: 'operator' });
      await guard(input('Bash', { command: 'terraform apply -var env=prod', description: '운영 적용\nrauha-risk: {"scope":"결제 API","cost":"up"}' }), 't1', opts);
      expect(asked[0]?.risk).toMatchObject({ scope: '결제 API', cost: 'up' });
    });

    it('위험도를 안 적었으면 요청에 risk가 없다(화면은 모름으로 보인다)', async () => {
      const { guard, asked } = guardWith([{ kind: 'allow' }], { role: 'operator' });
      await guard(input('Bash', { command: 'terraform apply -var env=prod' }), 't1', opts);
      expect(asked[0]).not.toHaveProperty('risk');
    });
  });

  describe('사용자 규칙', () => {
    it('묻지 않고 할 것 규칙은 명령을 이은 글 전체를 풀어 주지 않는다(맞는 조각 때문에 위험한 조각이 지나가면 안 된다)', async () => {
      const { guard, asked } = guardWith([{ kind: 'deny', note: null }], { rules: (_tool, detail) => (detail.includes('git status') ? 'allow' : null) });
      const out = await guard(input('Bash', { command: 'git status && git reset --hard' }), 't1', opts);
      expect(asked).toHaveLength(1);
      expect(decision(out)).toBe('deny');
    });

    it('프로세스 치환(<( ))으로 이어 붙인 명령도 통째로 풀어 주지 않는다', async () => {
      const { guard, asked } = guardWith([{ kind: 'deny', note: null }], { rules: (_tool, detail) => (detail.includes('terraform apply') ? 'allow' : null) });
      const out = await guard(input('Bash', { command: 'terraform apply <(rm -rf build)' }), 't1', opts);
      expect(asked).toHaveLength(1);
      expect(decision(out)).toBe('deny');
    });

    it('묻지 않고 할 것 규칙에 맞는 위험 동작은 묻지 않고 허락한다', async () => {
      const { guard, asked } = guardWith([], { rules: (_tool, detail) => (detail.includes('terraform apply') ? 'allow' : null) });
      const out = await guard(input('Bash', { command: 'terraform apply -var env=prod' }), 't1', opts);
      expect(decision(out)).toBe('allow');
      expect(asked).toEqual([]);
    });

    it('꼭 허락받을 것 규칙에 맞으면 평소엔 묻지 않는 동작도 사용자에게 묻는다', async () => {
      const { guard, asked } = guardWith([{ kind: 'allow' }], { rules: (_tool, detail) => (detail.includes('yarn deploy') ? 'ask' : null) });
      const out = await guard(input('Bash', { command: 'yarn deploy' }), 't1', opts);
      expect(asked.length).toBe(1);
      expect(asked[0]!.reason).toContain('규칙');
      expect(decision(out)).toBe('allow');
    });

    it('꼭 허락받을 것에서 거절하면 팀원에게 거절이 간다', async () => {
      const { guard } = guardWith([{ kind: 'deny', note: '나중에' }], { rules: () => 'ask' });
      const out = await guard(input('Bash', { command: 'yarn deploy' }), 't1', opts);
      expect(decision(out)).toBe('deny');
      expect(output(out)?.permissionDecisionReason).toContain('나중에');
    });

    it('규칙이 allow여도 비밀 파일과 git push 거절은 그대로다', async () => {
      const { guard, asked } = guardWith([], { rules: () => 'allow' });
      expect(decision(await guard(input('Read', { file_path: 'E:/work/app/.env' }), 't1', opts))).toBe('deny');
      expect(decision(await guard(input('Bash', { command: 'git push origin main' }), 't1', opts))).toBe('deny');
      expect(asked).toEqual([]);
    });

    it('규칙에 안 맞으면 기본 위험 규칙대로 간다', async () => {
      const { guard, asked } = guardWith([{ kind: 'allow' }], { rules: () => null });
      expect(decision(await guard(input('Bash', { command: 'terraform apply -var env=prod' }), 't1', opts))).toBeDefined();
      expect(asked.length).toBeLessThanOrEqual(1);
    });
  });
});

describe('createToolGuard 비밀 파일 심볼릭 링크', () => {
  it('작업 폴더 안의 링크가 비밀 파일을 가리키면 읽기를 거절한다', async () => {
    const { mkdtempSync, symlinkSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'rauha-link-'));
    try {
      writeFileSync(join(dir, '.env'), 'X=1');
      try {
        symlinkSync(join(dir, '.env'), join(dir, 'notes.txt'), 'file');
      } catch {
        return; // 이 PC는 링크를 만들 권한이 없다(Windows 일반 계정)
      }
      const { guard } = guardWith([], { root: dir.replaceAll('\\', '/') });
      const out = await guard(input('Read', { file_path: join(dir, 'notes.txt') }), 't1', opts);
      expect(decision(out)).toBe('deny');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
