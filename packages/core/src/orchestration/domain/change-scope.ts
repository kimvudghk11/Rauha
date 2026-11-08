/** 테스트를 어디까지 돌릴지의 판단 결과. */
export type TestSelection =
  | { readonly kind: 'full' }
  | { readonly kind: 'related'; readonly files: readonly string[] }
  | { readonly kind: 'none' };

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** 바뀌면 어떤 테스트가 영향받는지 알 수 없는 파일: 의존성·컴파일 설정·테스트 도구 설정. */
const GLOBAL_FILE = /^(?:package\.json|(?:yarn|pnpm|package)-?lock\.[a-z]+|yarn\.lock|pnpm-lock\.yaml|tsconfig[\w.-]*\.json|(?:vitest|vite|jest)\.config\.[cm]?[jt]s|\.eslintrc[\w.]*|eslint\.config\.[cm]?[jt]s)$/;

/** 이번 시도에서 바뀐 파일들. 검사를 어디까지 좁혀도 되는지 판단한다. */
export class ChangeScope {
  private constructor(private readonly files: readonly string[]) {}

  static of(changedFiles: readonly string[]): ChangeScope {
    return new ChangeScope([...new Set(changedFiles.map((f) => f.replace(/\\/g, '/')))]);
  }

  testSelection(): TestSelection {
    if (this.files.some((f) => GLOBAL_FILE.test(f.split('/').pop() ?? f))) return { kind: 'full' };
    const code = this.files.filter((f) => CODE_FILE.test(f));
    return code.length > 0 ? { kind: 'related', files: code } : { kind: 'none' };
  }
}
