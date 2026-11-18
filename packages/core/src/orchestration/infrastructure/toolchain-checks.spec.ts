import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Toolchain } from '../domain/toolchain.js';
import { NodeChecks } from './node-checks.js';
import { projectChecks, ToolchainChecks, XcodeChecks, type ShellRunner } from './toolchain-checks.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const repo = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-tool-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
const go = Toolchain.detect({ rootFiles: ['go.mod'], pubspec: null, platform: 'linux' })!;
const fake = (code: number, output: string, seen: string[] = []): ShellRunner => async (command) => (seen.push(command), { code, output });

describe('Node 가 아닌 프로젝트 검사', () => {
  it('저장소에 맞는 검사를 고른다: test 스크립트가 있으면 Node, 아니면 루트 표시 파일의 도구', () => {
    expect(projectChecks(repo({ 'package.json': '{"scripts":{"test":"vitest"}}', 'go.mod': 'module x' }))).toBeInstanceOf(NodeChecks);
    expect(projectChecks(repo({ 'go.mod': 'module x' }))).toBeInstanceOf(ToolchainChecks);
    expect(projectChecks(repo({ 'pubspec.yaml': 'name: app\nflutter:\n' }))).toBeInstanceOf(ToolchainChecks);
    expect(projectChecks(repo({ 'README.md': '#' }))).toBeInstanceOf(NodeChecks);
  });

  it('테스트 파일을 도구 명령으로 돌리고, assertion 실패는 올바른 Red 로 실패한 테스트 이름과 함께 돌려준다', async () => {
    const seen: string[] = [];
    const checks = new ToolchainChecks('/r', go, 1000, fake(1, '--- FAIL: TestAdd (0.00s)\n    money_test.go:9: got 3, want 4\nFAIL', seen));
    const r = await checks.runTests(['pay/money_test.go']);
    expect(seen).toEqual(['go test ./pay']);
    expect(r.run.isValidRed()).toBe(true);
    expect(r.ids).toEqual(['TestAdd']);
    expect(r.digest).toContain('got 3, want 4');
  });

  it('아직 없는 코드를 불러 컴파일이 깨지면 올바른 Red 가 아니다(스텁부터)', async () => {
    const r = await new ToolchainChecks('/r', go, 1000, fake(1, 'pay/money_test.go:7:9: undefined: Add\nFAIL\tshop/pay [build failed]')).runTests(['pay/money_test.go']);
    expect(r.run.isValidRed()).toBe(false);
  });

  it('도구가 이 컴퓨터에 없으면 실패가 아니라 돌릴 방법 없음, 검사 묶음에서는 건너뜀', async () => {
    const missing = new ToolchainChecks('/r', go, 1000, fake(1, "'go' is not recognized as an internal or external command"));
    expect((await missing.runTests([])).run.failureKind).toBe('no-runner');
    const suite = await missing.runSuite();
    expect(suite.map((c) => `${c.name}:${c.status}`)).toEqual(['tests:skip', 'typecheck:skip', 'lint:skip']);
  });

  it('통과하면 초록, 검사 묶음은 테스트·타입 검사(go vet)를 돌린다', async () => {
    const seen: string[] = [];
    const ok = new ToolchainChecks('/r', go, 1000, fake(0, 'ok  \tshop/pay\t0.01s', seen));
    expect((await ok.runTests(['pay/money_test.go'])).run.isGreen()).toBe(true);
    const suite = await ok.runSuite();
    expect(suite.map((c) => `${c.name}:${c.status}`)).toEqual(['tests:pass', 'typecheck:pass', 'lint:skip']);
    expect(seen).toContain('go vet ./...');
  });
});

describe('Xcode 프로젝트 검사(맥)', () => {
  it('처음 쓸 때 스킴과 시뮬레이터를 알아내 xcodebuild test 로 돌리고, 못 알아내면 돌릴 방법 없음', async () => {
    const seen: string[] = [];
    const runner: ShellRunner = async (command) => {
      seen.push(command);
      if (command.startsWith('xcodebuild -list')) return { code: 0, output: 'note\n{"workspace":{"schemes":["App"]}}' };
      if (command.startsWith('xcrun simctl')) return { code: 0, output: '{"devices":{"iOS-18-1":[{"udid":"U1","name":"iPhone 16","isAvailable":true}]}}' };
      return { code: 0, output: '** TEST SUCCEEDED **' };
    };
    const checks = new XcodeChecks('/r', 'App.xcworkspace', runner, 1000);
    expect(await checks.hasTestRunner()).toBe(true);
    expect((await checks.runTests([])).run.isGreen()).toBe(true);
    expect(seen.at(-1)).toBe('xcodebuild test -workspace App.xcworkspace -scheme App -destination "platform=iOS Simulator,id=U1" -quiet');
    const none = new XcodeChecks('/r', 'App.xcodeproj', async () => ({ code: 1, output: 'xcodebuild: command not found' }), 1000);
    expect(await none.hasTestRunner()).toBe(false);
    expect((await none.runTests([])).run.failureKind).toBe('no-runner');
  });
});
