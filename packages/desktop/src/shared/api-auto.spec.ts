import { describe, expect, it } from 'vitest';
import { autoApiLine, baseUrlOf, changedEndpoints, guessLaunch } from './api-auto.js';
import type { ApiEndpoint } from './api-extract.js';

const ep = (path: string, file: string): ApiEndpoint => ({ method: 'GET', path, name: path, query: [], body: null, bearer: false, file });

describe('이번 일에서 바뀐 엔드포인트만', () => {
  const all = [ep('/users', 'src/users/users.controller.ts'), ep('/orders', 'src/orders/orders.controller.ts'), ep('/a', 'a.ts'), ep('/b', 'b.ts'), ep('/c', 'c.ts')];

  it('바뀐(지우지 않은) 파일에 있는 엔드포인트만 고르고, Windows 경로도 맞춘다', () => {
    expect(changedEndpoints(all, [{ path: 'src\\users\\users.controller.ts', kind: 'modified' }, { path: 'src/orders/orders.controller.ts', kind: 'deleted' }]).map((e) => e.path)).toEqual(['/users']);
  });

  it('API 파일을 안 건드렸으면 없다(모델도 서버도 부르지 않는다)', () => {
    expect(changedEndpoints(all, [{ path: 'README.md', kind: 'modified' }])).toEqual([]);
  });

  it('한 번에 최대 3개까지만', () => {
    expect(changedEndpoints(all, ['a.ts', 'b.ts', 'c.ts', 'src/users/users.controller.ts'].map((path) => ({ path, kind: 'added' })))).toHaveLength(3);
  });
});

describe('서버 띄우는 방법 고르기', () => {
  const base = { scripts: {}, rootFiles: [] as string[], platform: 'linux' as NodeJS.Platform };

  it('Node 서버는 start:dev → dev → start 스크립트, 잠금 파일로 yarn·pnpm·npm 을 고른다', () => {
    expect(guessLaunch({ ...base, stack: 'nest', scripts: { start: 'nest start', 'start:dev': 'nest start --watch' } })).toEqual({ kind: 'local', command: 'npm run start:dev', stop: null });
    expect(guessLaunch({ ...base, stack: 'express', scripts: { dev: 'tsx watch src' }, rootFiles: ['yarn.lock'] })?.command).toBe('yarn dev');
    expect(guessLaunch({ ...base, stack: 'next', scripts: { dev: 'next dev' }, rootFiles: ['pnpm-lock.yaml'] })?.command).toBe('pnpm dev');
  });

  it('Spring 은 gradlew·mvnw, Windows 면 .bat·.cmd', () => {
    expect(guessLaunch({ ...base, stack: 'spring', rootFiles: ['gradlew'] })?.command).toBe('./gradlew bootRun');
    expect(guessLaunch({ ...base, stack: 'spring', rootFiles: ['gradlew'], platform: 'win32' })?.command).toBe('gradlew.bat bootRun');
    expect(guessLaunch({ ...base, stack: 'spring', rootFiles: ['mvnw'] })?.command).toBe('./mvnw spring-boot:run');
  });

  it('실행 스크립트가 없고 compose 파일이 있으면 docker compose 로 띄우고 끝나면 stop 한다(down 으로 지우지 않는다)', () => {
    expect(guessLaunch({ ...base, stack: 'nest', rootFiles: ['docker-compose.yml'] })).toEqual({ kind: 'compose', command: 'docker compose -f docker-compose.yml up -d', stop: 'docker compose -f docker-compose.yml stop' });
  });

  it('띄울 방법이 없으면 null(지어내지 않는다)', () => {
    expect(guessLaunch({ ...base, stack: 'unknown' })).toBeNull();
  });
});

describe('서버 주소', () => {
  it('코드의 포트 → .env PORT → 스택 기본값', () => {
    expect(baseUrlOf('nest', 4000, 'PORT=5000')).toBe('http://localhost:4000');
    expect(baseUrlOf('express', null, 'DB=x\nPORT = "5000"\n')).toBe('http://localhost:5000');
    expect(baseUrlOf('spring', null, null)).toBe('http://localhost:8080');
    expect(baseUrlOf('next', null, null)).toBe('http://localhost:3000');
  });
});

describe('요약 한 줄', () => {
  it('건너뜀·모두 통과·일부 실패를 구분한다', () => {
    expect(autoApiLine({ endpoints: 0, passed: 0, failed: 0, skipped: '서버를 띄우지 않기로 했어요' })).toContain('건너뛰었어요');
    expect(autoApiLine({ endpoints: 2, passed: 9, failed: 0, skipped: null })).toContain('모두 통과');
    expect(autoApiLine({ endpoints: 1, passed: 7, failed: 2, skipped: null })).toContain('9개 중 2개가 실패');
  });
});
