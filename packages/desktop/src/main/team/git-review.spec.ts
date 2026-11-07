import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reviewChanges } from './git-review.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'rauha-review-'));
  dirs.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 't');
  const write = (name: string, text: string) => writeFileSync(join(root, name), text);
  const commit = (msg: string) => {
    git('add', '.');
    git('commit', '-q', '-m', msg);
  };
  write('pay.ts', 'const timeout = 3000;\n');
  commit('init');
  return { root, git, write, commit };
}

describe('reviewChanges', () => {
  it('보호 브랜치보다 앞선 커밋 수와 충돌 없음을 git으로 계산한다', async () => {
    const r = repo();
    r.git('checkout', '-q', '-b', 'fix');
    r.write('pay.ts', 'const timeout = 8000;\n');
    r.commit('늘림');
    const review = await reviewChanges(r.root, ['main', 'qa'], 'main');
    const main = review.impacts.find((i) => i.branch === 'main')!;
    expect(review.branch).toBe('fix');
    expect(main).toMatchObject({ exists: true, ahead: 1, behind: 0, conflicts: false });
    expect(review.impacts.find((i) => i.branch === 'qa')).toMatchObject({ exists: false, ahead: null });
    expect(review.files).toEqual([{ path: 'pay.ts', additions: 1, deletions: 1 }]);
    expect(review.diff).toContain('+const timeout = 8000;');
  });

  it('같은 줄을 서로 고쳤으면 충돌이라고 알리고 뒤처진 커밋 수를 센다', async () => {
    const r = repo();
    r.git('checkout', '-q', '-b', 'fix');
    r.write('pay.ts', 'const timeout = 8000;\n');
    r.commit('fix 쪽');
    r.git('checkout', '-q', 'main');
    r.write('pay.ts', 'const timeout = 5000;\n');
    r.commit('main 쪽');
    r.git('checkout', '-q', 'fix');
    const main = (await reviewChanges(r.root, ['main'], 'main')).impacts[0]!;
    expect(main).toMatchObject({ ahead: 1, behind: 1, conflicts: true });
  });

  it('아직 커밋하지 않은 변경도 diff에 담긴다', async () => {
    const r = repo();
    r.write('pay.ts', 'const timeout = 1000;\n');
    mkdirSync(join(r.root, 'src'));
    const review = await reviewChanges(r.root, ['main'], null);
    expect(review.files.map((f) => f.path)).toEqual(['pay.ts']);
    expect(review.diff).toContain('+const timeout = 1000;');
    expect(review.truncated).toBe(false);
  });

  it('CI 설정에서 자동 배포를 읽는다', async () => {
    const r = repo();
    mkdirSync(join(r.root, '.github', 'workflows'), { recursive: true });
    r.write('.github/workflows/cd.yml', 'on:\n  push:\n    branches: [main]\njobs:\n  d:\n    steps:\n      - run: ./deploy.sh\n');
    r.commit('ci');
    const [main] = (await reviewChanges(r.root, ['main'], null)).impacts;
    expect(main!.autoDeploy).toBe('yes');
  });
});
