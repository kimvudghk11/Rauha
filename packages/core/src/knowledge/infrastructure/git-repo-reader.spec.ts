import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretPolicy } from '../../orchestration/domain/secret-policy.js';
import { RepoRef } from '../domain/repo-ref.js';
import { GitRepoReader } from './git-repo-reader.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(commit = true) {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-reader-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }).toString().trim();
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src', 'domain'), { recursive: true });
  writeFileSync(join(dir, 'src', 'domain', 'money.ts'), 'export class Money {}\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', dev: 'x' } }));
  writeFileSync(join(dir, 'yarn.lock'), '');
  writeFileSync(join(dir, 'CLAUDE.md'), '# 규칙');
  writeFileSync(join(dir, 'src', 'domain', 'money.spec.ts'), '');
  if (commit) {
    git('add', '.');
    git('commit', '-qm', 'init');
  }
  return { dir, git, reader: new GitRepoReader(dir, SecretPolicy.defaults()) };
}

describe('GitRepoReader', () => {
  it('브랜치와 커밋, 작업 트리 변경 여부를 읽는다', async () => {
    const { dir, git, reader } = repo();
    const head = git('rev-parse', 'HEAD');
    expect(await reader.current()).toEqual(RepoRef.of({ branch: 'main', commit: head, dirty: false }));
    writeFileSync(join(dir, 'src', 'domain', 'money.ts'), 'export class Money { x = 1 }\n');
    expect((await reader.current())?.dirty).toBe(true);
  });

  it('커밋이 없는 저장소나 git이 아닌 폴더는 null', async () => {
    expect(await repo(false).reader.current()).toBeNull();
    const plain = mkdtempSync(join(tmpdir(), 'rauha-plain-'));
    dirs.push(plain);
    expect(await new GitRepoReader(plain, SecretPolicy.defaults()).current()).toBeNull();
  });

  it('detached HEAD면 브랜치는 null', async () => {
    const { git, reader } = repo();
    git('checkout', '-q', '--detach');
    expect((await reader.current())?.branch).toBeNull();
  });

  it('기준 뒤의 커밋과 커밋 안 한 변경을 합쳐 돌려준다', async () => {
    const { dir, git, reader } = repo();
    const basis = (await reader.current())!;
    writeFileSync(join(dir, 'src', 'domain', 'cart.ts'), 'export class Cart {}\n');
    git('add', '.');
    git('commit', '-qm', 'cart');
    writeFileSync(join(dir, 'src', 'domain', 'money.ts'), 'export class Money { y = 2 }\n');
    expect(await reader.changedSince(basis)).toEqual({ paths: ['src/domain/cart.ts', 'src/domain/money.ts'] });
  });

  it('브랜치를 바꾸면 갈라진 지점 기준으로 양쪽 변경을 합친다', async () => {
    const { dir, git, reader } = repo();
    git('checkout', '-qb', 'feature');
    writeFileSync(join(dir, 'src', 'domain', 'f.ts'), 'export const f = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'f');
    const onFeature = (await reader.current())!;
    git('checkout', '-q', 'main');
    writeFileSync(join(dir, 'src', 'domain', 'm.ts'), 'export const m = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'm');
    expect(await reader.changedSince(onFeature)).toEqual({ paths: ['src/domain/f.ts', 'src/domain/m.ts'] });
  });

  it('기준 커밋이 사라졌으면 다시 만들라고 한다', async () => {
    const { reader } = repo();
    expect(await reader.changedSince(RepoRef.of({ branch: 'main', commit: 'f'.repeat(40), dirty: false }))).toBe('rebuild');
  });

  it('비밀 파일은 목록과 변화에서 뺀다', async () => {
    const { dir, reader } = repo();
    const basis = (await reader.current())!;
    writeFileSync(join(dir, '.env'), 'X=1');
    expect(await reader.files()).not.toContain('.env');
    expect(await reader.changedSince(basis)).toEqual({ paths: [] });
  });

  it('파일 내용 해시를 읽고 없는 파일은 null', async () => {
    const { reader } = repo();
    const hashes = await reader.hashes(['src/domain/money.ts', 'src/domain/gone.ts']);
    expect(hashes.get('src/domain/money.ts')).toMatch(/^[0-9a-f]{40}$/);
    expect(hashes.get('src/domain/gone.ts')).toBeNull();
  });

  it('폴더(서브모듈 등)가 섞여 있어도 죽지 않고 파일만 해시한다', async () => {
    const { dir, reader } = repo();
    mkdirSync(join(dir, 'vendor', 'lib'), { recursive: true });
    const many = Array.from({ length: 5000 }, () => 'src/domain/money.ts');
    const hashes = await reader.hashes(['vendor/lib', ...many]);
    expect(hashes.get('vendor/lib')).toBeNull();
    expect(hashes.get('src/domain/money.ts')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('Java·Go·Python 저장소의 테스트 파일 모양도 알아본다(회사 백엔드 저장소)', async () => {
    const { reader } = repo();
    const of = async (files: string[]) => (await reader.facts(files)).testPattern;
    expect(await of(['src/main/java/Order.java', 'src/test/java/OrderServiceTest.java'])).toBe('*Test.java');
    expect(await of(['pkg/order.go', 'pkg/order_test.go'])).toBe('*_test.go');
    expect(await of(['app/order.py', 'tests/test_order.py'])).toBe('test_*.py');
    expect(await of(['README.md'])).toBeNull();
  });

  it('package.json 스크립트와 패키지 관리자, 지시 파일, 영역을 읽는다', async () => {
    const { reader } = repo();
    const facts = await reader.facts(await reader.files());
    expect(facts).toMatchObject({
      packageManager: 'yarn',
      scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' },
      instructionFiles: ['CLAUDE.md'],
      testPattern: '*.spec.ts',
    });
    expect(facts.dirs).toEqual([{ path: '.', files: 3 }, { path: 'src/domain', files: 2 }]);
    expect(await reader.symbolsOf(['src/domain/money.ts', 'src/domain/gone.ts', 'CLAUDE.md'])).toEqual(
      new Map([['src/domain/money.ts', ['Money']], ['src/domain/gone.ts', null], ['CLAUDE.md', []]]),
    );
  });
});
