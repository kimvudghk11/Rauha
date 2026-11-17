import type { ApiEndpoint } from './api-extract.js';
import type { StackKind } from './api-project.js';

/**
 * 팀이 API 를 만들거나 고친 뒤 rauha 가 알아서 하는 API 점검의 규칙(모델·네트워크·프로세스 없음).
 * - 이번 일에서 바뀐 파일에 있는 엔드포인트만 고른다(전체 API 를 매번 시험하지 않는다)
 * - 서버가 꺼져 있으면 띄울 방법을 프로젝트 파일에서 고른다(사용자 허락을 받은 뒤에만 실제로 띄운다)
 */

/** 한 번에 시험할 엔드포인트 수(모델 호출 = 엔드포인트마다 1번 + 실패 시 수정 제안 1번) */
export const AUTO_API_MAX_ENDPOINTS = 3;

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** 이번 일에서 바뀐 파일에 정의된 엔드포인트(지운 파일은 뺀다). 최대 AUTO_API_MAX_ENDPOINTS 개 */
export function changedEndpoints(endpoints: readonly ApiEndpoint[], changed: readonly { readonly path: string; readonly kind: string }[]): ApiEndpoint[] {
  const touched = new Set(changed.filter((c) => c.kind !== 'deleted').map((c) => norm(c.path)));
  return endpoints.filter((e) => e.file !== undefined && touched.has(norm(e.file))).slice(0, AUTO_API_MAX_ENDPOINTS);
}

export interface LaunchFacts {
  readonly stack: StackKind;
  /** 루트 package.json 의 scripts(없으면 빈 객체) */
  readonly scripts: Readonly<Record<string, string>>;
  /** 루트에 있는 파일 이름들(yarn.lock, pnpm-lock.yaml, gradlew, mvnw, docker-compose.yml …) */
  readonly rootFiles: readonly string[];
  readonly platform: NodeJS.Platform;
}

/** 서버를 띄우는 방법. command 는 사용자에게 그대로 보이고, 허락을 받은 뒤 그 글 그대로 실행한다 */
export interface ServerLaunch {
  readonly kind: 'local' | 'compose';
  readonly command: string;
  /** 시험이 끝나면 멈출 방법(compose 는 stop, local 은 띄운 프로세스를 끈다) */
  readonly stop: string | null;
}

const NODE_SCRIPTS = ['start:dev', 'dev', 'start'];
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

/** 띄울 방법을 고른다: 프로젝트의 개발 실행 명령 → 없으면 docker compose → 그래도 없으면 null(시험하지 않고 알린다) */
export function guessLaunch(f: LaunchFacts): ServerLaunch | null {
  const has = (name: string): boolean => f.rootFiles.includes(name);
  if (f.stack === 'nest' || f.stack === 'express' || f.stack === 'next') {
    const script = NODE_SCRIPTS.find((s) => typeof f.scripts[s] === 'string' && f.scripts[s]!.trim() !== '');
    if (script !== undefined) {
      const tool = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm run';
      return { kind: 'local', command: tool === 'npm run' ? `npm run ${script}` : `${tool} ${script}`, stop: null };
    }
  }
  if (f.stack === 'spring') {
    if (has('gradlew')) return { kind: 'local', command: f.platform === 'win32' ? 'gradlew.bat bootRun' : './gradlew bootRun', stop: null };
    if (has('mvnw')) return { kind: 'local', command: f.platform === 'win32' ? 'mvnw.cmd spring-boot:run' : './mvnw spring-boot:run', stop: null };
  }
  const compose = COMPOSE_FILES.find(has);
  if (compose !== undefined) return { kind: 'compose', command: `docker compose -f ${compose} up -d`, stop: `docker compose -f ${compose} stop` };
  return null;
}

/** 서버 주소: 코드에서 읽은 포트 → .env 의 PORT → 스택 기본값 */
export function baseUrlOf(stack: StackKind, codePort: number | null, envText: string | null): string {
  const fromEnv = envText === null ? null : /^\s*PORT\s*=\s*"?(\d{2,5})"?\s*$/m.exec(envText)?.[1] ?? null;
  const port = codePort ?? (fromEnv !== null ? Number(fromEnv) : stack === 'spring' ? 8080 : 3000);
  return `http://localhost:${port}`;
}

/** 팀 대화·결과 글에 붙일 한 줄 요약 */
export function autoApiLine(r: { readonly endpoints: number; readonly passed: number; readonly failed: number; readonly skipped: string | null }): string {
  if (r.skipped !== null) return `API 자동 점검을 건너뛰었어요: ${r.skipped}`;
  if (r.failed === 0) return `새로 만든 API ${r.endpoints}개를 이 컴퓨터에서 직접 불러 봤어요. 케이스 ${r.passed}개 모두 통과했어요.`;
  return `새로 만든 API ${r.endpoints}개를 이 컴퓨터에서 직접 불러 봤어요. 케이스 ${r.passed + r.failed}개 중 ${r.failed}개가 실패했어요.`;
}
