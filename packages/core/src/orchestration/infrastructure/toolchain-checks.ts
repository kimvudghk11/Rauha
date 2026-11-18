import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChecksPort, QuickChecksResult, TestsResult } from '../application/ports.js';
import { TestRun } from '../domain/test-run.js';
import { Toolchain } from '../domain/toolchain.js';
import type { CheckResult } from '../domain/verification.js';
import { NodeChecks, runShell, type CommandResult } from './node-checks.js';

/** 셸 명령 실행(시험에서는 가짜로 바꾼다) */
export type ShellRunner = (command: string, cwd: string, timeoutMs: number) => Promise<CommandResult>;

/** 컴파일이 섞여 오래 걸리는 도구(Gradle·Swift·Rust)를 생각해 Node 보다 넉넉히 */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

const tail = (text: string, lines: number): string => text.trim().split('\n').slice(-lines).join('\n');

/**
 * Node 가 아닌 프로젝트(안드로이드·자바·코틀린·Go·Python·Rust·Flutter·Swift 패키지)의 검사. 판정은 TestRun 이 한다.
 * 도구가 설치돼 있지 않으면 "돌릴 방법 없음(no-runner)"으로 돌려준다(실패로 세지 않는다).
 */
export class ToolchainChecks implements ChecksPort {
  constructor(
    private readonly root: string,
    private readonly tool: Toolchain,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly run: ShellRunner = runShell,
  ) {}

  async hasTestRunner(): Promise<boolean> {
    return true;
  }

  async runTests(files: readonly string[]): Promise<TestsResult> {
    const { command } = this.tool.testFiles(files);
    const result = await this.run(command, this.root, this.timeoutMs);
    const run = this.outcome(result.code, result.output);
    return { run, ids: [...run.failedNames], passed: [], digest: run.failed === 0 ? '' : tail(result.output, 30), command };
  }

  async runQuick(changedFiles: readonly string[]): Promise<QuickChecksResult> {
    // 바뀐 소스에 딸린 테스트를 고르는 규칙은 도구마다 달라, 전체를 돌린다(좁히지 않음)
    void changedFiles;
    return { results: await this.runSuite(), narrowed: false };
  }

  async runSuite(): Promise<CheckResult[]> {
    const tests = this.check('tests', this.tool.testAll());
    const typecheck = this.tool.typecheck();
    const types: Promise<CheckResult> = typecheck === null ? Promise.resolve({ name: 'typecheck', status: 'skip', failures: [], command: null, summary: `${this.tool.label}: 테스트가 컴파일까지 확인` }) : this.check('typecheck', typecheck);
    const lint: CheckResult = { name: 'lint', status: 'skip', failures: [], command: null, summary: '린트 명령 없음' };
    return [await tests, await types, lint];
  }

  private async check(name: 'tests' | 'typecheck', command: string): Promise<CheckResult> {
    const result = await this.run(command, this.root, this.timeoutMs);
    if (Toolchain.missingTool(result.output) && result.code !== 0) return { name, status: 'skip', failures: [], command, summary: `${this.tool.label} 도구가 이 컴퓨터에 없어 건너뜀` };
    if (result.code === 0) return { name, status: 'pass', failures: [], command, summary: `${this.tool.label} ${name === 'tests' ? '테스트' : '검사'} 통과` };
    const failures = name === 'tests' ? this.tool.failedNames(result.output) : [];
    return { name, status: 'fail', failures, command, summary: tail(result.output, 1), detail: tail(result.output, 40) };
  }

  private outcome(code: number, output: string): TestRun {
    if (code === 0) return TestRun.of({ passed: 1, failed: 0 });
    if (Toolchain.missingTool(output)) return TestRun.of({ passed: 0, failed: 1, failureKind: 'no-runner', failedNames: [`(${this.tool.label} 도구가 이 컴퓨터에 없음)`] });
    if (code === 124) return TestRun.of({ passed: 0, failed: 1, failureKind: 'timeout', failedNames: ['(시간 제한을 넘김)'] });
    const names = this.tool.failedNames(output);
    return TestRun.of({ passed: 0, failed: Math.max(1, names.length), failureKind: Toolchain.failureKind(output), failedNames: names.length > 0 ? names : ['(세부 정보 없음)'] });
  }
}

/**
 * Xcode 프로젝트(맥): 처음 쓸 때 스킴(xcodebuild -list)과 iPhone 시뮬레이터(simctl)를 알아내고 xcodebuild test 로 돌린다.
 * 알아내지 못하면(맥이 아니거나 Xcode 가 없음) 돌릴 방법 없음.
 */
export class XcodeChecks implements ChecksPort {
  private resolved: Promise<ToolchainChecks | null> | null = null;

  constructor(
    private readonly root: string,
    private readonly container: string,
    private readonly run: ShellRunner = runShell,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private inner(): Promise<ToolchainChecks | null> {
    this.resolved ??= (async () => {
      const where = this.container.endsWith('.xcworkspace') ? '-workspace' : '-project';
      const list = await this.run(`xcodebuild -list -json ${where} "${this.container}"`, this.root, 60_000);
      const scheme = list.code === 0 ? Toolchain.xcodeScheme(list.output.slice(list.output.indexOf('{')), this.container) : null;
      if (scheme === null) return null;
      const sims = await this.run('xcrun simctl list devices available --json', this.root, 60_000);
      const simulator = sims.code === 0 ? Toolchain.iphoneSimulator(sims.output.slice(sims.output.indexOf('{'))) : null;
      return new ToolchainChecks(this.root, Toolchain.forXcode({ container: this.container, scheme, simulator }), this.timeoutMs, this.run);
    })();
    return this.resolved;
  }

  async hasTestRunner(): Promise<boolean> {
    return (await this.inner()) !== null;
  }

  async runTests(files: readonly string[]): Promise<TestsResult> {
    const c = await this.inner();
    if (c !== null) return c.runTests(files);
    const run = TestRun.of({ passed: 0, failed: 1, failureKind: 'no-runner', failedNames: ['(Xcode 스킴을 찾지 못함: 맥에서 Xcode 가 있어야 해요)'] });
    return { run, ids: [...run.failedNames], passed: [], digest: '', command: 'xcodebuild test' };
  }

  async runQuick(changedFiles: readonly string[]): Promise<QuickChecksResult> {
    void changedFiles;
    return { results: await this.runSuite(), narrowed: false };
  }

  async runSuite(): Promise<CheckResult[]> {
    const c = await this.inner();
    if (c !== null) return c.runSuite();
    const skip = (name: 'tests' | 'typecheck' | 'lint'): CheckResult => ({ name, status: 'skip', failures: [], command: null, summary: 'Xcode 를 쓸 수 없어 건너뜀' });
    return [skip('tests'), skip('typecheck'), skip('lint')];
  }
}

/**
 * 저장소에 맞는 검사를 고른다: package.json 에 test 스크립트가 있으면 Node, 아니면 루트 표시 파일로 다른 언어 도구,
 * 그것도 없으면 Node(테스트를 돌릴 방법 없음으로 알린다).
 */
export function projectChecks(root: string): ChecksPort {
  if (nodeTestScript(root)) return new NodeChecks(root);
  let rootFiles: string[] = [];
  try {
    rootFiles = readdirSync(root);
  } catch {
    return new NodeChecks(root);
  }
  const pubspecPath = join(root, 'pubspec.yaml');
  const tool = Toolchain.detect({ rootFiles, pubspec: existsSync(pubspecPath) ? readFileSync(pubspecPath, 'utf8') : null, platform: process.platform });
  if (tool !== null) return new ToolchainChecks(root, tool);
  // Swift 패키지가 아닌 iOS 앱(Xcode 프로젝트)은 맥에서만 돌린다
  const xcode = Toolchain.xcodeContainer(rootFiles);
  return xcode !== null && process.platform === 'darwin' ? new XcodeChecks(root, xcode) : new NodeChecks(root);
}

function nodeTestScript(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.['test'] === 'string';
  } catch {
    return false;
  }
}
