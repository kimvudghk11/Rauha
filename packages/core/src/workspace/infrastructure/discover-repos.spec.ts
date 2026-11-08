import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { toPosixPath } from '../../shared/path-pattern.js';
import { discoverRepos, isRepo } from './discover-repos.js';

const dirs: string[] = [];
const ceiling = process.env['GIT_CEILING_DIRECTORIES'];
// 임시 폴더 위(예: 홈 폴더)가 git 저장소인 PC에서도 테스트가 같게 돌도록 git이 임시 폴더 위로 올라가지 않게 한다.
beforeAll(() => {
  process.env['GIT_CEILING_DIRECTORIES'] = tmpdir();
});
afterAll(() => {
  if (ceiling === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
  else process.env['GIT_CEILING_DIRECTORIES'] = ceiling;
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'rauha-ws-')));
  dirs.push(dir);
  return dir;
}

function gitInit(path: string): void {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: path });
}

const posix = (paths: readonly string[]) => paths.map((p) => toPosixPath(p).toLowerCase()).sort();

describe('discoverRepos', () => {
  it('저장소 안에서 띄우면 그 저장소 하나', () => {
    const root = join(folder(), 'app');
    gitInit(root);
    mkdirSync(join(root, 'src'));
    expect(posix(discoverRepos(join(root, 'src')))).toEqual(posix([root]));
  });

  it('저장소들을 담은 폴더면 두 단계 아래까지 찾는다(node_modules·숨은 폴더 제외)', () => {
    const ws = folder();
    gitInit(join(ws, 'api'));
    gitInit(join(ws, 'team', 'web'));
    gitInit(join(ws, 'a', 'b', 'too-deep'));
    gitInit(join(ws, 'node_modules', 'pkg'));
    gitInit(join(ws, '.cache', 'x'));
    expect(posix(discoverRepos(ws))).toEqual(posix([join(ws, 'api'), join(ws, 'team', 'web')]));
  });

  it('큰 저장소(예: 홈 폴더 전체) 안의 폴더라도 그 아래에 저장소들이 있으면 그것들을 쓴다', () => {
    const home = join(folder(), 'home');
    gitInit(home);
    gitInit(join(home, 'projects', 'api'));
    gitInit(join(home, 'projects', 'web'));
    expect(posix(discoverRepos(join(home, 'projects')))).toEqual(posix([join(home, 'projects', 'api'), join(home, 'projects', 'web')]));
    // 저장소의 루트에서 띄워도 그 아래에 저장소들이 있으면 그것들이다(작업 폴더가 레포로 오인되지 않는다).
    expect(posix(discoverRepos(home))).toEqual(posix([join(home, 'projects', 'api'), join(home, 'projects', 'web')]));
  });

  it('저장소의 루트에서 띄웠고 아래에 다른 저장소가 없으면 그 저장소 하나', () => {
    const solo = join(folder(), 'solo');
    gitInit(solo);
    expect(posix(discoverRepos(solo))).toEqual(posix([solo]));
  });

  it('저장소가 없으면 빈 목록', () => {
    expect(discoverRepos(folder())).toEqual([]);
  });
});

describe('isRepo', () => {
  it('git이 아니거나 없는 경로는 저장소가 아니다', () => {
    const ws = folder();
    gitInit(join(ws, 'api'));
    expect(isRepo(join(ws, 'api'))).toBe(true);
    expect(isRepo(ws)).toBe(false);
    expect(isRepo(join(ws, 'missing'))).toBe(false);
  });
});
