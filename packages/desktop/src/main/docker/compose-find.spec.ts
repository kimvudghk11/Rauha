import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findComposeFiles } from './compose-find.js';

let root: string;
const touch = (rel: string): void => {
  mkdirSync(join(root, ...rel.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...rel.split('/')), 'services: {}\n');
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rauha-compose-find-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('compose 파일 자동 발견', () => {
  it('작업 폴더와 그 아래 폴더의 compose 파일을 상대 경로로 찾는다', () => {
    touch('docker-compose.yml');
    touch('api/compose.yaml');
    touch('api/notes.txt');
    expect(findComposeFiles(root).map((f) => f.path)).toEqual(['api/compose.yaml', 'docker-compose.yml']);
  });
  it('node_modules·숨김 폴더·빌드 폴더 안은 뒤지지 않는다', () => {
    touch('node_modules/pkg/compose.yaml');
    touch('.git/compose.yaml');
    touch('dist/compose.yaml');
    touch('web/compose.yaml');
    expect(findComposeFiles(root).map((f) => f.path)).toEqual(['web/compose.yaml']);
  });
  it('깊이 상한보다 깊은 파일은 찾지 않는다', () => {
    touch('a/b/c/d/e/compose.yaml');
    touch('a/b/compose.yaml');
    expect(findComposeFiles(root, { maxDepth: 3 }).map((f) => f.path)).toEqual(['a/b/compose.yaml']);
  });
  it('읽는 폴더 수 상한을 넘으면 거기서 멈춘다', () => {
    for (let i = 0; i < 20; i++) touch(`d${String(i).padStart(2, '0')}/compose.yaml`);
    expect(findComposeFiles(root, { maxDirs: 5 }).length).toBeLessThan(20);
  });
  it('없는 폴더는 빈 목록이다', () => {
    expect(findComposeFiles(join(root, 'nope'))).toEqual([]);
  });
});
