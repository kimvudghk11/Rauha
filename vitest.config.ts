import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 테스트는 빌드 없이 각 패키지의 소스를 바로 읽는다.
    alias: {
      '@rauha/core/jobs': fileURLToPath(new URL('./packages/core/src/jobs.ts', import.meta.url)),
      '@rauha/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.spec.ts'],
    environment: 'node',
    // 인프라 테스트는 실제 git·셸을 여러 번 부른다. 병렬 실행으로 바쁠 때 5초 기본값을 넘기기도 한다.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // 끝난 뒤 남은 핸들(worker·자식 프로세스) 때문에 CI 가 끝없이 기다리지 않게.
    teardownTimeout: 20_000,
    // CI 에서는 실패를 공개 주석으로도 남긴다(로그인 없이 원인을 볼 수 있게).
    reporters: process.env.GITHUB_ACTIONS === "true" ? ["default", "github-actions"] : ["default"],
  },
});
