import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanWorkFolder } from './scan.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function base() {
  const root = mkdtempSync(join(tmpdir(), 'rauha-scan-'));
  dirs.push(root);
  const repo = (rel: string) => {
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    return dir;
  };
  const file = (rel: string, text = 'x') => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  return { root, repo, file };
}

describe('scanWorkFolder', () => {
  it('레포와 문서 폴더와 기타를 가르고 상태를 붙인다', async () => {
    const w = base();
    const a = w.repo('api-server');
    writeFileSync(join(a, 'x.ts'), 'x');
    w.repo('web');
    w.file('docs/기획.md');
    w.file('docs/설계.pdf');
    w.file('docs/표.docx');
    w.file('assets/logo.png');
    const found = await scanWorkFolder(w.root);
    expect(found.map((f) => [f.name, f.kind]).sort()).toEqual([['api-server', 'repo'], ['docs', 'docs'], ['web', 'repo']]);
    expect(found.find((f) => f.name === 'api-server')!.status).toMatchObject({ branch: 'main', changed: 1 });
    expect(found.find((f) => f.name === 'docs')!.status).toBeNull();
  });

  it('생성물 폴더 안의 레포는 찾지 않는다', async () => {
    const w = base();
    w.repo('node_modules/pkg');
    w.repo('real');
    expect((await scanWorkFolder(w.root)).map((f) => f.name)).toEqual(['real']);
  });

  it('레포 안의 폴더는 따로 찾지 않는다', async () => {
    const w = base();
    const r = w.repo('app');
    mkdirSync(join(r, 'sub'));
    w.file('app/sub/inner.md');
    expect((await scanWorkFolder(w.root)).map((f) => f.name)).toEqual(['app']);
  });

  it('작업 폴더 자체가 레포면 그 하나만 돌려준다', async () => {
    const w = base();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: w.root });
    expect((await scanWorkFolder(w.root)).map((f) => f.relative)).toEqual(['.']);
  });

  it('작업 폴더에 .git이 있어도 아래에 레포들이 있으면 그것들을 찾는다(드라이브 루트·깨진 .git)', async () => {
    const w = base();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: w.root });
    w.repo('api');
    w.repo('web');
    expect((await scanWorkFolder(w.root)).map((f) => f.relative).sort()).toEqual(['api', 'web']);
  });

  it('깊이 제한을 넘는 폴더는 찾지 않고, 없는 폴더는 빈 목록이다', async () => {
    const w = base();
    w.repo('a/b/c/d/deep');
    expect(await scanWorkFolder(w.root, 3)).toEqual([]);
    expect(await scanWorkFolder(join(w.root, '없는폴더'))).toEqual([]);
  });
});
