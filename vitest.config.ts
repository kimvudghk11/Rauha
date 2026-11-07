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
  },
});
