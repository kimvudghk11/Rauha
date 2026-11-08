import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VitestReportDto } from '../application/dto/vitest-report.dto.js';
import { describe, expect, it } from 'vitest';
import { NodeChecks, NodeProject, testsOutcome } from './node-checks.js';

describe('NodeProject', () => {
  it('lockfile로 패키지 매니저를 고른다', () => {
    expect(NodeProject.detect(['yarn.lock', 'package.json'], {}).packageManager).toBe('yarn');
    expect(NodeProject.detect(['pnpm-lock.yaml'], {}).packageManager).toBe('pnpm');
    expect(NodeProject.detect(['package-lock.json'], {}).packageManager).toBe('npm');
    expect(NodeProject.detect(['package.json'], {}).packageManager).toBe('npm');
  });

  it('scripts에서 test·typecheck·lint 명령을 만든다', () => {
    const p = NodeProject.detect(['yarn.lock', 'tsconfig.json'], { scripts: { test: 'vitest run', lint: 'eslint .' } });
    expect(p.suiteCommand('tests')).toBe('yarn run test');
    expect(p.suiteCommand('lint')).toBe('yarn run lint');
    // typecheck 스크립트가 없으면 tsconfig가 있을 때 tsc --noEmit
    expect(p.suiteCommand('typecheck')).toBe('yarn exec tsc --noEmit');
  });

  it('스크립트도 tsconfig도 없으면 그 검사는 건너뛴다', () => {
    const p = NodeProject.detect(['package-lock.json'], { scripts: {} });
    expect(p.suiteCommand('tests')).toBeNull();
    expect(p.suiteCommand('typecheck')).toBeNull();
    expect(p.suiteCommand('lint')).toBeNull();
  });

  it('vitest를 쓰면 대상 테스트를 JSON reporter로 돌린다', () => {
    const p = NodeProject.detect(['package-lock.json'], { devDependencies: { vitest: '^3' } });
    expect(p.usesVitest()).toBe(true);
    expect(p.testFilesCommand(['src/a.spec.ts'], 'out.json')).toBe('npx --no-install vitest run src/a.spec.ts --reporter=json --outputFile=out.json');
  });

  it('vitest가 아니면 test 스크립트에 파일을 넘긴다', () => {
    const p = NodeProject.detect(['yarn.lock'], { scripts: { test: 'jest' }, devDependencies: { jest: '^29' } });
    expect(p.usesVitest()).toBe(false);
    expect(p.testFilesCommand(['a.test.ts'], 'x')).toBe('yarn run test a.test.ts');
  });

  it('공백이 든 경로는 따옴표로 감싼다', () => {
    const p = NodeProject.detect(['package-lock.json'], { devDependencies: { vitest: '^3' }, scripts: { test: 'vitest run' } });
    expect(p.testFilesCommand(['src/my feature.spec.ts'], 'C:/Users/John Smith/out.json')).toBe(
      'npx --no-install vitest run "src/my feature.spec.ts" --reporter=json "--outputFile=C:/Users/John Smith/out.json"',
    );
    expect(p.suiteTestsJsonCommand('C:/a b/o.json')).toBe('npm run test -- --reporter=json "--outputFile=C:/a b/o.json"');
  });

  it('실패한 검사의 실제 메시지는 에러 줄을 먼저, 최대 12줄까지 남긴다', () => {
    const out = ['> tsc --noEmit', '', "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.", ...Array(20).fill('noise')].join('\n');
    const detail = NodeProject.failureDetail(out);
    expect(detail.split('\n')[0]).toBe("src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(detail.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('typecheck 출력에서 파일:코드 식별자를 뽑는다', () => {
    const out = 'src/a.ts(3,7): error TS2322: Type x\nsrc/b.ts:10:2 - error TS2304: Cannot find name';
    expect(NodeProject.typeErrorIds(out)).toEqual(['src/a.ts:TS2322', 'src/b.ts:TS2304']);
  });
});

describe('testsOutcome', () => {
  const green = VitestReportDto.from({
    testResults: [{ name: '/p/a.spec.ts', status: 'passed', message: '', assertionResults: [{ fullName: 'a', status: 'passed', failureMessages: [] }] }],
  });

  it('보고서가 통과여도 종료 코드가 0이 아니면 실패로 본다', () => {
    const run = testsOutcome(green, 1);
    expect(run.isGreen()).toBe(false);
    expect(run.failedNames).toContain('(처리되지 않은 오류: 종료 코드 1)');
  });

  it('보고서가 통과이고 종료 코드가 0이면 통과', () => {
    expect(testsOutcome(green, 0).isGreen()).toBe(true);
  });
});

function countProcesses(marker: string): number {
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.Name -eq 'node.exe' }).Count`,
  ]).toString();
  return Number(out.trim());
}

describe('NodeChecks 시간 제한 — 프로세스 정리', () => {
  it.runIf(process.platform === 'win32')('시간 제한으로 끊으면 그 사이 새로 생긴 손자 프로세스까지 남기지 않는다', async () => {
    const marker = `rauha-leak-probe-${process.pid}-${Date.now()}`;
    const dir = mkdtempSync(join(tmpdir(), 'rauha-leak-'));
    try {
      const spawner = `setInterval(()=>require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)//${marker}'],{stdio:'ignore'}),50)`;
      writeFileSync(join(dir, 'spawner.js'), spawner);
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node spawner.js' } }));
      await new NodeChecks(dir, 2000).runSuite();
      await new Promise((r) => setTimeout(r, 1000));
      expect(countProcesses(marker)).toBe(0);
    } finally {
      execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 60000);
});

describe('NodeChecks 모노레포', () => {
  it('테스트 파일은 그 파일이 속한 워크스페이스 패키지에서, 패키지 기준 경로로 그 패키지의 test 스크립트로 돌린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-mono-'));
    try {
      // 루트 test는 다른 패키지·도커까지 도는 묶음이라 파일 인자를 받지 못한다(여기서는 늘 실패).
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['apps/*'], scripts: { test: 'node -e "process.exit(1)"' } }));
      // lockfile 없음 = npm. 설치하지 않은 임시 폴더에서는 yarn 4가 프로젝트를 거부해서다(실제 저장소에서는 yarn도 같은 길이다).
      mkdirSync(join(dir, 'apps', 'api', 'src'), { recursive: true });
      writeFileSync(join(dir, 'apps', 'api', 'src', 'a.spec.js'), '');
      // 패키지 폴더에서 패키지 기준 경로를 받았을 때만 통과한다.
      writeFileSync(join(dir, 'apps', 'api', 'check.js'), "process.exit(require('fs').existsSync(process.argv[2]) && process.argv[2].startsWith('src') ? 0 : 1)");
      writeFileSync(join(dir, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: 'node check.js' } }));
      const result = await new NodeChecks(dir).runTests(['apps/api/src/a.spec.js']);
      expect(result.run.isGreen()).toBe(true);
      expect(result.command).toContain('apps/api');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 60000);

  it('파일이 속한 패키지에 test 스크립트가 없으면 test 스크립트가 있는 위쪽(루트)에서 돌린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-mono-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['apps/*'], scripts: { test: 'node check.js' } }));
      // 루트 기준 경로를 받았을 때만 통과한다.
      writeFileSync(join(dir, 'check.js'), "process.exit(require('fs').existsSync(process.argv[2]) && process.argv[2].startsWith('apps/') ? 0 : 1)");
      mkdirSync(join(dir, 'apps', 'api', 'test'), { recursive: true });
      writeFileSync(join(dir, 'apps', 'api', 'test', 'a.test.js'), '');
      writeFileSync(join(dir, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api' }));
      const result = await new NodeChecks(dir).runTests(['apps/api/test/a.test.js']);
      expect(result.run.isGreen()).toBe(true);
      expect(result.command).not.toContain('(apps/api)');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 60000);
});

describe('NodeChecks 시간 제한', () => {
  it('멈춘 테스트 명령도 시간 제한이 지나면 실패로 끝난다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-hang-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setInterval(()=>{},1000)"' } }));
      const started = Date.now();
      const [tests] = await new NodeChecks(dir, 1500).runSuite();
      expect(tests?.status).toBe('fail');
      expect(Date.now() - started).toBeLessThan(15000);
    } finally {
      // Windows는 프로세스를 끈 뒤에도 잠시 폴더를 잡고 있어서 재시도한다.
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 30000);
});

describe('NodeProject 관련 테스트 명령', () => {
  it('vitest면 바뀐 파일과 관련된 테스트만 JSON reporter로 돌린다(관련 테스트가 없어도 실패가 아니다)', () => {
    const p = NodeProject.detect(['yarn.lock'], { devDependencies: { vitest: '^3' }, scripts: { test: 'vitest run' } });
    expect(p.relatedTestsCommand(['src/a.ts', 'src/my b.ts'], 'o.json')).toBe(
      'yarn exec vitest related src/a.ts "src/my b.ts" --run --passWithNoTests --reporter=json --outputFile=o.json',
    );
  });

  it('vitest가 아니면 관련 테스트를 좁힐 수 없어서 명령이 없다', () => {
    const p = NodeProject.detect(['yarn.lock'], { scripts: { test: 'jest' }, devDependencies: { jest: '^29' } });
    expect(p.relatedTestsCommand(['src/a.ts'], 'o.json')).toBeNull();
  });
});

describe('NodeChecks 검사 묶음 병렬 실행', () => {
  const slow = 'node -e "setTimeout(()=>{},2500)"';

  it('tests·typecheck·lint를 차례가 아니라 동시에 돌린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-par-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: slow, typecheck: slow, lint: slow } }));
      const started = Date.now();
      const results = await new NodeChecks(dir).runSuite();
      expect(results.map((r) => [r.name, r.status])).toEqual([['tests', 'pass'], ['typecheck', 'pass'], ['lint', 'pass']]);
      expect(Date.now() - started).toBeLessThan(6500); // 차례로 돌면 7500ms 이상(전체 테스트가 몰려 느려져도 겹쳐 도는지 가린다)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 30000);
});

describe('NodeChecks 바뀐 곳 먼저 검사', () => {
  it('설정 파일이 바뀌었거나 vitest가 아니면 좁히지 못하고 전체 검사를 돌린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-quick-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
      const checks = new NodeChecks(dir);
      expect((await checks.runQuick(['package.json'])).narrowed).toBe(false);
      expect((await checks.runQuick(['src/a.js'])).narrowed).toBe(false); // vitest 아님
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 30000);

  it('문서만 바뀌었으면 테스트는 건너뛰고(좁힘), 타입 검사·린트는 그대로 돌린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-quick-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"', lint: 'node -e "process.exit(0)"' } }));
      const quick = await new NodeChecks(dir).runQuick(['README.md']);
      expect(quick.narrowed).toBe(true);
      expect(quick.results.map((r) => [r.name, r.status])).toEqual([['tests', 'skip'], ['typecheck', 'skip'], ['lint', 'pass']]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 30000);
});
