import { listSecretFiles, loadSecretPolicy, type SecretPolicy } from '@rauha/core';

/** 비밀 파일 규칙(.rauhaignore 포함)과 실제 있는 비밀 파일 목록은 git을 불러 읽으므로 잠깐 기억해 둔다 */
const TTL_MS = 10_000;

export interface SecretSource {
  /** 작업 폴더가 없으면 null */
  policy(): SecretPolicy | null;
  /** 작업 폴더 아래 실제 비밀 파일(작업 폴더 기준) */
  files(): string[];
}

/** 코드 탭과 터미널이 같은 비밀 파일 규칙을 쓰도록 한곳에서 읽는다 */
export function createSecretSource(workFolder: () => string | null, now: () => number = Date.now): SecretSource {
  let cached: { dir: string; at: number; policy: SecretPolicy; files: string[] | null } | null = null;
  const fresh = (): NonNullable<typeof cached> | null => {
    const dir = workFolder();
    if (dir === null) return null;
    if (cached === null || cached.dir !== dir || now() - cached.at > TTL_MS) cached = { dir, at: now(), policy: loadSecretPolicy(dir), files: null };
    return cached;
  };
  return {
    policy: () => fresh()?.policy ?? null,
    files: () => {
      const c = fresh();
      if (c === null) return [];
      c.files ??= listSecretFiles(c.dir, c.policy);
      return c.files;
    },
  };
}
