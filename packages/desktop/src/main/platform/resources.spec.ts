import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeBinaryPath, promptsDir, sdkBinaryPackage, unpackedPath, type ResourceEnv } from './resources.js';

const dev = (exists: (p: string) => boolean = () => true): ResourceEnv => ({ packaged: false, resourcesPath: '/none', appPath: join('/repo', 'packages', 'desktop'), exists });
const packaged = (exists: (p: string) => boolean = () => true): ResourceEnv => ({
  packaged: true,
  resourcesPath: join('/Applications', 'rauha.app', 'Contents', 'Resources'),
  appPath: join('/Applications', 'rauha.app', 'Contents', 'Resources', 'app.asar'),
  exists,
});

describe('promptsDir', () => {
  it('환경 변수가 있으면 그것을 쓴다', () => {
    expect(promptsDir(dev(), '/my/prompts')).toBe('/my/prompts');
  });

  it('개발 실행은 저장소의 prompts/를 쓴다', () => {
    expect(promptsDir(dev())).toBe(join('/repo', 'prompts'));
  });

  it('설치본은 resources/prompts를 쓴다', () => {
    expect(promptsDir(packaged())).toBe(join('/Applications', 'rauha.app', 'Contents', 'Resources', 'prompts'));
  });
});

describe('claudeBinaryPath', () => {
  it('플랫폼마다 패키지 이름과 실행 파일 이름이 다르다', () => {
    expect(sdkBinaryPackage('darwin', 'arm64')).toBe('@anthropic-ai/claude-agent-sdk-darwin-arm64');
    expect(claudeBinaryPath(dev(), 'win32', 'x64')).toMatch(/claude\.exe$/);
    expect(claudeBinaryPath(dev(), 'darwin', 'arm64')).toMatch(/claude$/);
  });

  it('설치본은 asar 밖(app.asar.unpacked)의 실행 파일을 찾는다', () => {
    const p = claudeBinaryPath(packaged(), 'darwin', 'arm64')!;
    expect(p).toContain('app.asar.unpacked');
    expect(p).not.toMatch(/app\.asar[\\/]/);
  });

  it('개발 실행은 작업 공간 위쪽 node_modules에서도 찾는다', () => {
    const wanted = join('/repo', 'packages', 'desktop', '..', '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');
    expect(claudeBinaryPath(dev((p) => p === wanted), 'win32', 'x64')).toBe(wanted);
  });

  it('어디에도 없으면 null이다', () => {
    expect(claudeBinaryPath(dev(() => false), 'darwin', 'x64')).toBeNull();
  });
});

describe('unpackedPath', () => {
  it('asar 안 경로를 asar.unpacked로 바꾼다', () => {
    expect(unpackedPath('/r/app.asar/node_modules/x')).toBe('/r/app.asar.unpacked/node_modules/x');
    expect(unpackedPath('/r/app.asar.unpacked/x')).toBe('/r/app.asar.unpacked/x');
  });
});
