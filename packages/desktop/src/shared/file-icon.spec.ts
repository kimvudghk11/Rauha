import { describe, expect, it } from 'vitest';
import { iconFor } from './file-icon.js';

describe('파일·폴더 아이콘 고르기', () => {
  it('확장자가 같으면 대소문자와 상관없이 같은 아이콘이다', () => {
    expect(iconFor('App.TSX', false, false)).toBe('tsx');
    expect(iconFor('a.ts', false, false)).toBe('ts');
    expect(iconFor('x.MJS', false, false)).toBe('js');
    expect(iconFor('x.yml', false, false)).toBe('yaml');
    expect(iconFor('logo.JPEG', false, false)).toBe('img');
  });
  it('특수 파일 이름은 확장자보다 먼저 본다', () => {
    expect(iconFor('package.json', false, false)).toBe('pkg');
    expect(iconFor('Package.JSON', false, false)).toBe('pkg');
    expect(iconFor('package-lock.json', false, false)).toBe('lock');
    expect(iconFor('yarn.lock', false, false)).toBe('lock');
    expect(iconFor('tsconfig.build.json', false, false)).toBe('tsconfig');
    expect(iconFor('vitest.config.ts', false, false)).toBe('config');
    expect(iconFor('.eslintrc.json', false, false)).toBe('config');
    expect(iconFor('.prettierrc', false, false)).toBe('config');
    expect(iconFor('Dockerfile', false, false)).toBe('docker');
    expect(iconFor('docker-compose.yml', false, false)).toBe('docker');
    expect(iconFor('CLAUDE.md', false, false)).toBe('claude');
    expect(iconFor('README.md', false, false)).toBe('readme');
    expect(iconFor('LICENSE', false, false)).toBe('license');
    expect(iconFor('Makefile', false, false)).toBe('make');
    expect(iconFor('.gitignore', false, false)).toBe('git');
    expect(iconFor('.editorconfig', false, false)).toBe('editorconfig');
  });
  it('.env와 .env.local 같은 변형은 모두 환경 변수 아이콘이다', () => {
    expect(iconFor('.env', false, false)).toBe('env');
    expect(iconFor('.env.local', false, false)).toBe('env');
    expect(iconFor('.env.production', false, false)).toBe('env');
  });
  it('시험 파일은 확장자 아이콘 대신 시험 배지다', () => {
    expect(iconFor('a.spec.ts', false, false)).toBe('test');
    expect(iconFor('b.test.tsx', false, false)).toBe('test');
    expect(iconFor('c.spec.js', false, false)).toBe('test');
    expect(iconFor('spec.ts', false, false)).toBe('ts');
  });
  it('pem·key는 자물쇠 배지다', () => {
    expect(iconFor('cert.pem', false, false)).toBe('key');
    expect(iconFor('id.key', false, false)).toBe('key');
  });
  it('점 파일이나 확장자 없는 알 수 없는 파일은 기본 문서 아이콘이다', () => {
    expect(iconFor('.hidden', false, false)).toBe('file');
    expect(iconFor('NOTES', false, false)).toBe('file');
    expect(iconFor('a.unknownext', false, false)).toBe('file');
    expect(iconFor('trailingdot.', false, false)).toBe('file');
  });
  it('폴더는 이름으로 종류를 고르고 열림·닫힘을 구분한다', () => {
    expect(iconFor('src', true, false)).toBe('folder-src');
    expect(iconFor('SRC', true, true)).toBe('folder-src-open');
    expect(iconFor('node_modules', true, false)).toBe('folder-modules');
    expect(iconFor('dist', true, false)).toBe('folder-out');
    expect(iconFor('build', true, true)).toBe('folder-out-open');
    expect(iconFor('__tests__', true, false)).toBe('folder-test');
    expect(iconFor('.github', true, false)).toBe('folder-github');
    expect(iconFor('.git', true, false)).toBe('folder-git');
    expect(iconFor('images', true, false)).toBe('folder-assets');
    expect(iconFor('whatever', true, false)).toBe('folder');
    expect(iconFor('whatever', true, true)).toBe('folder-open');
  });
  it('폴더 이름이 파일 규칙에 걸리지 않는다', () => {
    expect(iconFor('package.json', true, false)).toBe('folder');
  });
  it('글꼴·소리·영상·압축 파일은 종류별 아이콘이다', () => {
    expect(iconFor('a.woff2', false, false)).toBe('font');
    expect(iconFor('a.TTF', false, false)).toBe('font');
    expect(iconFor('a.wav', false, false)).toBe('audio');
    expect(iconFor('a.webm', false, false)).toBe('video');
    expect(iconFor('a.7z', false, false)).toBe('zip');
    expect(iconFor('a.avif', false, false)).toBe('img');
    expect(iconFor('a.bmp', false, false)).toBe('img');
  });
  it('언어 확장자 변형은 같은 아이콘이다', () => {
    expect(iconFor('a.mts', false, false)).toBe('ts');
    expect(iconFor('a.cts', false, false)).toBe('ts');
    expect(iconFor('a.jsonc', false, false)).toBe('json');
    expect(iconFor('a.htm', false, false)).toBe('html');
    expect(iconFor('a.sass', false, false)).toBe('scss');
    expect(iconFor('a.less', false, false)).toBe('css');
    expect(iconFor('a.graphql', false, false)).toBe('graphql');
    expect(iconFor('a.lua', false, false)).toBe('lua');
    expect(iconFor('a.dart', false, false)).toBe('dart');
  });
  it('도구 설정 파일 이름은 설정 아이콘이다', () => {
    expect(iconFor('tailwind.config.js', false, false)).toBe('config');
    expect(iconFor('next.config.mjs', false, false)).toBe('config');
    expect(iconFor('jest.config.ts', false, false)).toBe('config');
    expect(iconFor('.npmrc', false, false)).toBe('config');
    expect(iconFor('.nvmrc', false, false)).toBe('config');
    expect(iconFor('.prettierignore', false, false)).toBe('config');
    expect(iconFor('.dockerignore', false, false)).toBe('docker');
    expect(iconFor('.gitkeep', false, false)).toBe('git');
  });
  it('다른 언어의 패키지·잠금 파일 이름도 알아본다', () => {
    expect(iconFor('Cargo.toml', false, false)).toBe('pkg');
    expect(iconFor('Cargo.lock', false, false)).toBe('lock');
    expect(iconFor('pyproject.toml', false, false)).toBe('pkg');
    expect(iconFor('requirements.txt', false, false)).toBe('pkg');
    expect(iconFor('go.mod', false, false)).toBe('pkg');
    expect(iconFor('go.sum', false, false)).toBe('lock');
    expect(iconFor('composer.lock', false, false)).toBe('lock');
  });
  it('CHANGELOG와 CONTRIBUTING은 안내 문서 아이콘이다', () => {
    expect(iconFor('CHANGELOG.md', false, false)).toBe('readme');
    expect(iconFor('CONTRIBUTING.md', false, false)).toBe('readme');
    expect(iconFor('changelog', false, false)).toBe('readme');
  });
  it('폴더 종류를 더 알아본다', () => {
    expect(iconFor('api', true, false)).toBe('folder-api');
    expect(iconFor('routes', true, true)).toBe('folder-api-open');
    expect(iconFor('db', true, false)).toBe('folder-db');
    expect(iconFor('migrations', true, false)).toBe('folder-db');
    expect(iconFor('styles', true, false)).toBe('folder-styles');
    expect(iconFor('utils', true, false)).toBe('folder-utils');
    expect(iconFor('helpers', true, false)).toBe('folder-utils');
    expect(iconFor('types', true, false)).toBe('folder-types');
    expect(iconFor('hooks', true, false)).toBe('folder-hooks');
    expect(iconFor('static', true, false)).toBe('folder-assets');
    expect(iconFor('bin', true, false)).toBe('folder-scripts');
  });
});
