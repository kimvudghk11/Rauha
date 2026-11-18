import { describe, expect, it } from 'vitest';
import { Toolchain } from './toolchain.js';

const detect = (rootFiles: string[], pubspec: string | null = null, platform = 'linux') => Toolchain.detect({ rootFiles, pubspec, platform });

describe('Node 가 아닌 프로젝트의 테스트 도구', () => {
  it('루트 표시 파일로 안드로이드(Gradle)·Swift 패키지·Flutter·Dart·Maven·Go·Rust·pytest 를 고른다', () => {
    expect(detect(['build.gradle.kts', 'gradlew', 'app'])?.id).toBe('gradle');
    expect(detect(['Package.swift', 'Sources'])?.id).toBe('swift');
    expect(detect(['pubspec.yaml', 'lib'], 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n')?.id).toBe('flutter');
    expect(detect(['pubspec.yaml'], 'name: cli\n')?.id).toBe('dart');
    expect(detect(['pom.xml'])?.id).toBe('maven');
    expect(detect(['go.mod'])?.id).toBe('go');
    expect(detect(['Cargo.toml'])?.id).toBe('cargo');
    expect(detect(['pyproject.toml'])?.id).toBe('pytest');
    expect(detect(['README.md'])).toBeNull();
  });

  it('Gradle 은 래퍼가 있으면 래퍼로(Windows 는 gradlew.bat), 없으면 gradle', () => {
    expect(detect(['build.gradle', 'gradlew'])!.testAll()).toBe('./gradlew test --console=plain');
    expect(detect(['build.gradle', 'gradlew', 'gradlew.bat'], null, 'win32')!.testAll()).toBe('gradlew.bat test --console=plain');
    expect(detect(['build.gradle'])!.testAll()).toBe('gradle test --console=plain');
  });

  it('pytest·flutter 는 파일로, go 는 패키지 폴더로 좁히고, 좁히지 못하는 도구는 전체를 돌린다', () => {
    expect(detect(['pyproject.toml'])!.testFiles(['tests/test_pay.py'])).toEqual({ command: 'python -m pytest -q tests/test_pay.py', narrowed: true });
    expect(detect(['pubspec.yaml'], 'flutter:\n')!.testFiles(['test/a_test.dart'])).toEqual({ command: 'flutter test test/a_test.dart', narrowed: true });
    expect(detect(['go.mod'])!.testFiles(['pay/money_test.go', 'pay/tax_test.go', 'main_test.go'])).toEqual({ command: 'go test ./pay .', narrowed: true });
    expect(detect(['build.gradle'])!.testFiles(['app/src/test/FooTest.kt'])).toEqual({ command: 'gradle test --console=plain', narrowed: false });
  });

  it('도구마다 출력에서 실패한 테스트 이름을 찾는다', () => {
    expect(detect(['go.mod'])!.failedNames('=== RUN   TestAdd\n--- FAIL: TestAdd (0.00s)\nFAIL')).toEqual(['TestAdd']);
    expect(detect(['pyproject.toml'])!.failedNames('FAILED tests/test_pay.py::test_refund - AssertionError\n')).toEqual(['tests/test_pay.py::test_refund']);
    expect(detect(['build.gradle'])!.failedNames('MoneyTest > adds() FAILED\n    org.opentest4j.AssertionFailedError')).toEqual(['MoneyTest > adds()']);
    expect(detect(['Cargo.toml'])!.failedNames('test money::adds ... FAILED\n')).toEqual(['money::adds']);
    expect(detect(['pubspec.yaml'], 'flutter:\n')!.failedNames('00:02 +3 -1: counter increments [E]\n')).toEqual(['counter increments']);
    expect(detect(['Package.swift'])!.failedNames("Test Case '-[AppTests.MoneyTests testAdd]' failed (0.01 seconds).")).toEqual(['-[AppTests.MoneyTests testAdd]']);
  });

  it('컴파일·불러오기 실패와 assertion 실패를 가른다(Red 는 assertion 만 올바른 실패)', () => {
    expect(Toolchain.failureKind('e: file.kt:3:5 Unresolved reference: Money\n> Task :app:compileTestKotlin FAILED')).toBe('compile');
    expect(Toolchain.failureKind('# shop/pay\npay/money_test.go:7:9: undefined: Add\nFAIL\tshop/pay [build failed]')).toBe('compile');
    expect(Toolchain.failureKind('E   ModuleNotFoundError: No module named "pay"')).toBe('import');
    expect(Toolchain.failureKind('--- FAIL: TestAdd\n    money_test.go:9: got 3, want 4')).toBe('assertion');
  });

  it('도구가 설치돼 있지 않은 것은 실패가 아니라 돌릴 방법이 없는 것으로 본다', () => {
    expect(Toolchain.missingTool("'flutter' is not recognized as an internal or external command")).toBe(true);
    expect(Toolchain.missingTool('sh: 1: go: not found')).toBe(true);
    expect(Toolchain.missingTool('--- FAIL: TestAdd')).toBe(false);
  });
});
