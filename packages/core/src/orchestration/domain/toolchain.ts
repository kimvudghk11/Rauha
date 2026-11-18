/**
 * Node 가 아닌 프로젝트의 테스트 도구(안드로이드·자바·코틀린 Gradle, Maven, Go, Python pytest, Rust, Flutter·Dart, Swift 패키지).
 * 저장소 루트의 표시 파일로 고르고, 돌릴 셸 명령과 실패한 테스트 이름 읽는 법을 정한다. 순수 규칙(파일·프로세스 없음).
 */
export type ToolchainId = 'gradle' | 'maven' | 'go' | 'pytest' | 'cargo' | 'flutter' | 'dart' | 'swift' | 'xcode';

/** Xcode 프로젝트를 돌릴 정보: 워크스페이스·프로젝트 파일, 스킴, 시뮬레이터 UDID */
export interface XcodeTarget {
  readonly container: string;
  readonly scheme: string;
  readonly simulator: string | null;
}

export interface ToolchainFacts {
  /** 저장소 루트의 파일·폴더 이름 */
  readonly rootFiles: readonly string[];
  /** pubspec.yaml 내용(없으면 null): flutter 인지 dart 인지 가른다 */
  readonly pubspec: string | null;
  readonly platform: string;
}

/** 실패한 테스트 이름을 출력에서 찾는 꼴(도구마다) */
const FAILED: Readonly<Record<ToolchainId, RegExp>> = {
  gradle: /^\s*(\S+ > .+?) FAILED\s*$/gm,
  maven: /^\[ERROR\]\s+(\S+\.\S+:\d+|\S+)\s+(?:Time elapsed.*)?<<< FAIL/gm,
  go: /^\s*--- FAIL: (\S+)/gm,
  pytest: /^FAILED (\S+)/gm,
  cargo: /^test (\S+) \.\.\. FAILED$/gm,
  flutter: /^\d\d:\d\d \+\d+(?: ~\d+)?(?: -\d+)?: (.+?) \[E\]\s*$/gm,
  dart: /^\d\d:\d\d \+\d+(?: ~\d+)?(?: -\d+)?: (.+?) \[E\]\s*$/gm,
  swift: /^Test Case '(.+?)' failed|✘ Test (.+?) (?:failed|recorded)/gm,
  xcode: /^Test Case '(.+?)' failed|✘ Test (.+?) (?:failed|recorded)/gm,
};

const LABEL: Readonly<Record<ToolchainId, string>> = {
  gradle: 'Gradle(안드로이드·자바·코틀린)',
  maven: 'Maven(자바)',
  go: 'Go',
  pytest: 'Python(pytest)',
  cargo: 'Rust(cargo)',
  flutter: 'Flutter',
  dart: 'Dart',
  swift: 'Swift 패키지(iOS·macOS)',
  xcode: 'Xcode(iOS)',
};

const quote = (s: string): string => (/^[\w./:@=+-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);
const dirOf = (file: string): string => {
  const parts = file.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.length === 0 ? '.' : parts.join('/');
};

export class Toolchain {
  private constructor(
    readonly id: ToolchainId,
    private readonly gradleWrapper: string | null,
    private readonly xcode: XcodeTarget | null = null,
  ) {}

  /** Xcode 프로젝트(스킴·시뮬레이터를 알아낸 뒤). 시뮬레이터를 못 찾으면 iOS 시뮬레이터 아무거나 */
  static forXcode(target: XcodeTarget): Toolchain {
    return new Toolchain('xcode', null, target);
  }

  /** 루트의 Xcode 워크스페이스(먼저)나 프로젝트 이름. 없으면 null */
  static xcodeContainer(rootFiles: readonly string[]): string | null {
    return rootFiles.find((f) => f.endsWith('.xcworkspace')) ?? rootFiles.find((f) => f.endsWith('.xcodeproj')) ?? null;
  }

  /** xcodebuild -list -json 출력에서 스킴: 컨테이너 이름과 같은 것을 먼저, 없으면 첫 번째 */
  static xcodeScheme(listJson: string, container: string): string | null {
    let schemes: string[] = [];
    try {
      const o = JSON.parse(listJson) as { workspace?: { schemes?: unknown }; project?: { schemes?: unknown } };
      const raw = o.workspace?.schemes ?? o.project?.schemes;
      schemes = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return null;
    }
    const base = container.replace(/\.(xcworkspace|xcodeproj)$/, '');
    return schemes.find((x) => x === base) ?? schemes[0] ?? null;
  }

  /** xcrun simctl list devices available --json 에서 가장 새 iOS 런타임의 iPhone UDID */
  static iphoneSimulator(simctlJson: string): string | null {
    try {
      const o = JSON.parse(simctlJson) as { devices?: Record<string, { udid?: string; name?: string; isAvailable?: boolean }[]> };
      const runtimes = Object.keys(o.devices ?? {}).filter((k) => /iOS/i.test(k)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const rt of runtimes) {
        const phone = (o.devices![rt] ?? []).find((d) => d.isAvailable !== false && typeof d.udid === 'string' && /iPhone/.test(d.name ?? ''));
        if (phone !== undefined) return phone.udid!;
      }
    } catch {
      return null;
    }
    return null;
  }

  /** 루트 표시 파일로 고른다. 모르면 null. 여럿이면 앱 쪽(Flutter·Gradle·Swift)을 먼저 본다. */
  static detect(facts: ToolchainFacts): Toolchain | null {
    const has = (name: string) => facts.rootFiles.includes(name);
    if (has('pubspec.yaml')) return new Toolchain(facts.pubspec !== null && /^\s*flutter\s*:/m.test(facts.pubspec) ? 'flutter' : 'dart', null);
    if (has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts')) {
      const wrapper = facts.platform === 'win32' ? (has('gradlew.bat') ? 'gradlew.bat' : null) : has('gradlew') ? './gradlew' : null;
      return new Toolchain('gradle', wrapper);
    }
    if (has('Package.swift')) return new Toolchain('swift', null);
    if (has('pom.xml')) return new Toolchain('maven', null);
    if (has('go.mod')) return new Toolchain('go', null);
    if (has('Cargo.toml')) return new Toolchain('cargo', null);
    if (has('pytest.ini') || has('pyproject.toml') || has('setup.cfg') || has('tox.ini') || has('conftest.py') || (has('requirements.txt') && has('tests'))) return new Toolchain('pytest', null);
    return null;
  }

  get label(): string {
    return LABEL[this.id];
  }

  /** 전체 테스트 */
  testAll(): string {
    switch (this.id) {
      case 'gradle':
        return `${this.gradleWrapper ?? 'gradle'} test --console=plain`;
      case 'maven':
        return 'mvn -q -B test';
      case 'go':
        return 'go test ./...';
      case 'pytest':
        return 'python -m pytest -q';
      case 'cargo':
        return 'cargo test';
      case 'flutter':
        return 'flutter test';
      case 'dart':
        return 'dart test';
      case 'swift':
        return 'swift test';
      case 'xcode': {
        const x = this.xcode!;
        const where = x.container.endsWith('.xcworkspace') ? '-workspace' : '-project';
        const dest = x.simulator !== null ? `platform=iOS Simulator,id=${x.simulator}` : 'platform=iOS Simulator,name=iPhone 16';
        return `xcodebuild test ${where} ${quote(x.container)} -scheme ${quote(x.scheme)} -destination ${quote(dest)} -quiet`;
      }
    }
  }

  /** 테스트 파일만 돌리는 명령. 도구가 파일로 좁히지 못하면 전체(narrowed=false) */
  testFiles(files: readonly string[]): { command: string; narrowed: boolean } {
    if (files.length === 0) return { command: this.testAll(), narrowed: false };
    const list = files.map(quote).join(' ');
    switch (this.id) {
      case 'pytest':
        return { command: `python -m pytest -q ${list}`, narrowed: true };
      case 'flutter':
        return { command: `flutter test ${list}`, narrowed: true };
      case 'dart':
        return { command: `dart test ${list}`, narrowed: true };
      case 'go':
        return { command: `go test ${[...new Set(files.map((f) => `./${dirOf(f)}`.replace(/^\.\/\.$/, '.')))].map(quote).join(' ')}`, narrowed: true };
      default:
        return { command: this.testAll(), narrowed: false };
    }
  }

  /** 타입·컴파일 검사(테스트와 따로 돌릴 값어치가 있을 때만). 없으면 null */
  typecheck(): string | null {
    switch (this.id) {
      case 'go':
        return 'go vet ./...';
      case 'cargo':
        return 'cargo check --all-targets';
      case 'flutter':
        return 'flutter analyze';
      case 'dart':
        return 'dart analyze';
      default:
        return null;
    }
  }

  /** 출력에서 실패한 테스트 이름들(못 찾으면 빈 목록) */
  failedNames(output: string): string[] {
    const re = new RegExp(FAILED[this.id].source, FAILED[this.id].flags);
    const names: string[] = [];
    for (const m of output.matchAll(re)) {
      const name = (m[1] ?? m[2] ?? '').trim();
      if (name !== '' && !names.includes(name)) names.push(name);
    }
    return names;
  }

  /**
   * 실패의 종류. Red 단계는 assertion 실패만 올바른 실패로 친다: 아직 없는 코드를 불러 컴파일·불러오기가 깨진 것은
   * 테스트 팀원이 빈 껍데기(스텁)를 먼저 만들어야 한다는 뜻이다.
   */
  static failureKind(output: string): 'assertion' | 'compile' | 'import' {
    if (/ModuleNotFoundError|ImportError|errors? during collection|Failed to load "/.test(output)) return 'import';
    if (/Compilation failed|compile\w*Kotlin FAILED|compile\w*Java FAILED|\[build failed\]|\bundefined: \w|error\[E\d+\]|could not compile|cannot find symbol|Unresolved reference|cannot find '[^']+' in scope|isn't defined for|Error: Compilation failed|\*\* TEST BUILD FAILED \*\*|\*\* BUILD FAILED \*\*/.test(output)) return 'compile';
    return 'assertion';
  }

  /** 테스트를 실행하지 못한 것(도구가 없음)인지: 그러면 "실패"가 아니라 "돌릴 방법 없음"으로 본다 */
  static missingTool(output: string): boolean {
    return /is not recognized as an internal or external command|command not found|: not found|spawn \S+ ENOENT|No such file or directory.*gradlew|No module named pytest|Python was not found/i.test(output);
  }
}
