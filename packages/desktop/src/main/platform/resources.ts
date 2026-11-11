import { join } from 'node:path';

export interface ResourceEnv {
  /** 설치본(electron-builder로 묶은 앱)이면 true */
  readonly packaged: boolean;
  /** 설치본의 resources 폴더(process.resourcesPath) */
  readonly resourcesPath: string;
  /** 앱 폴더(app.getAppPath()): 개발 중엔 packages/desktop, 설치본엔 .../app.asar */
  readonly appPath: string;
  readonly exists: (path: string) => boolean;
}

/** asar 안의 경로는 실제 파일이 아니다. 밖으로 풀어 둔 폴더(app.asar.unpacked)로 바꿔 찾는다. */
export const unpackedPath = (path: string): string => path.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');

/** 프롬프트 폴더: 환경 변수 → 설치본 resources/prompts → 개발 저장소의 prompts/ */
export function promptsDir(env: ResourceEnv, override?: string): string {
  if (override !== undefined && override !== '') return override;
  if (env.packaged) return join(env.resourcesPath, 'prompts');
  return join(env.appPath, '..', '..', 'prompts');
}

/** Agent SDK가 플랫폼별로 따로 배포하는 실행 파일 패키지 이름 */
export function sdkBinaryPackage(platform: NodeJS.Platform, arch: string): string {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
}

/**
 * Claude Code 실행 파일(claude / claude.exe)을 찾는다. SDK의 플랫폼 패키지에 들어 있는 네이티브 실행 파일이라 node가 필요 없다.
 * 설치본은 asar 안에서 실행할 수 없으므로 asar 밖(app.asar.unpacked, resources/node_modules)을 먼저 본다.
 * 못 찾으면 null — 그러면 SDK가 자기 방식으로 찾는다.
 */
export function claudeBinaryPath(env: ResourceEnv, platform: NodeJS.Platform, arch: string): string | null {
  const pkg = sdkBinaryPackage(platform, arch);
  const file = platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = env.packaged
    ? [join(env.resourcesPath, 'app.asar.unpacked', 'node_modules', pkg, file), join(env.resourcesPath, 'node_modules', pkg, file)]
    : [join(env.appPath, 'node_modules', pkg, file), join(env.appPath, '..', '..', 'node_modules', pkg, file)];
  return candidates.find((c) => env.exists(c)) ?? null;
}

/**
 * 작업 폴더를 아직 안 골랐을 때 쓸 폴더. 개발 실행은 실행한 폴더, 설치본은 앱 데이터 아래 빈 폴더다.
 * 맥에서 Finder로 연 앱의 실행 폴더는 `/`라서, 그대로 쓰면 첫 화면이 컴퓨터 전체를 훑고 문서·데스크톱 접근 권한 창이 줄줄이 뜬다.
 */
export function fallbackWorkDir(env: { readonly packaged: boolean; readonly userDataPath: string; readonly cwd: string }): string {
  return env.packaged ? join(env.userDataPath, 'no-work-folder') : env.cwd;
}

/**
 * 설치본에서 asar 밖으로 풀어 둔 빌드 파일(dist/ts-worker.cjs, dist/ts-lib/ …)의 실제 경로.
 * `dir`은 main 번들이 있는 폴더(__dirname: 설치본은 `…/app.asar/dist`, 개발 실행은 `dist`).
 * 풀어 둔 파일이 없으면 null — asar 안 경로는 worker 로 띄울 수 없어서 되돌아가지 않는다.
 */
export function unpackedAsset(dir: string, name: string, exists: (path: string) => boolean): string | null {
  const path = unpackedPath(join(dir, name));
  return exists(path) ? path : null;
}
