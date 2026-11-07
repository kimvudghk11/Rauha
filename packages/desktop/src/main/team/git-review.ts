import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { autoDeployFor, parseLeftRight, parseNumstat, type BranchImpact, type ChangedFile, type ChangeReview, type CiFile } from '../../shared/branch-impact.js';

const run = promisify(execFile);

/** 정리 화면에 싣는 diff 글자 수 상한. 넘으면 잘라서 보이고 truncated를 켠다. */
export const DIFF_LIMIT = 80_000;

async function git(root: string, args: readonly string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run('git', [...args], { cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return { ok: true, out: stdout };
  } catch (error) {
    const e = error as { stdout?: string };
    return { ok: false, out: e.stdout ?? '' };
  }
}

/** 레포의 CI 설정 파일들을 읽는다(자동 배포 여부를 짐작하는 데만 쓴다). */
async function ciFiles(root: string): Promise<CiFile[]> {
  const files: CiFile[] = [];
  const read = async (path: string) => {
    try {
      files.push({ path, text: await readFile(join(root, path), 'utf8') });
    } catch {
      /* 없으면 건너뛴다 */
    }
  };
  try {
    for (const name of await readdir(join(root, '.github', 'workflows'))) if (/\.ya?ml$/.test(name)) await read(`.github/workflows/${name}`);
  } catch {
    /* 워크플로 폴더가 없다 */
  }
  for (const name of ['.gitlab-ci.yml', 'Jenkinsfile', 'buildspec.yml', 'azure-pipelines.yml', '.circleci/config.yml']) await read(name);
  return files;
}

/** 보호 브랜치 하나에 지금 변경이 주는 영향. 모델 호출 없이 git으로만 계산한다. */
async function impactOn(root: string, branch: string, ci: readonly CiFile[]): Promise<BranchImpact> {
  const ref = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])).ok
    ? `origin/${branch}`
    : (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok
      ? branch
      : null;
  const autoDeploy = autoDeployFor(branch, ci);
  if (ref === null) return { branch, exists: false, ahead: null, behind: null, conflicts: null, autoDeploy };
  const counts = parseLeftRight((await git(root, ['rev-list', '--left-right', '--count', `${ref}...HEAD`])).out);
  // 시험 머지: 작업 트리를 건드리지 않는 merge-tree. 종료 코드 1이면 충돌이다. 못 돌리면(오래된 git) 모른다.
  const merge = await tryMerge(root, ref);
  return { branch, exists: true, behind: counts?.[0] ?? null, ahead: counts?.[1] ?? null, conflicts: merge, autoDeploy };
}

async function tryMerge(root: string, ref: string): Promise<boolean | null> {
  try {
    await run('git', ['merge-tree', '--write-tree', 'HEAD', ref], { cwd: root, windowsHide: true });
    return false;
  } catch (error) {
    const e = error as { code?: number; stderr?: string };
    return e.code === 1 ? true : null;
  }
}

/**
 * 허락 화면의 "코드" 정리: 바뀐 파일과 diff, 보호 브랜치(main·qa …)에 주는 영향.
 * diff는 보호 브랜치로 합칠 변경(커밋된 것)과 아직 커밋하지 않은 변경을 함께 담는다.
 */
export async function reviewChanges(root: string, protectedBranches: readonly string[], focus: string | null): Promise<ChangeReview> {
  const head = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
  const branch = head === '' || head === 'HEAD' ? null : head;
  const ci = await ciFiles(root);
  const impacts = await Promise.all(protectedBranches.map((b) => impactOn(root, b, ci)));

  const base = focus !== null ? impacts.find((i) => i.branch === focus && i.exists) : undefined;
  const baseRef = base === undefined ? null : (await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base.branch}`])).ok ? `origin/${base.branch}` : base.branch;
  const ranges: string[][] = [];
  if (baseRef !== null && branch !== focus) ranges.push([`${baseRef}...HEAD`]);
  ranges.push(['HEAD']);

  const byPath = new Map<string, ChangedFile>();
  let diff = '';
  for (const range of ranges) {
    for (const f of parseNumstat((await git(root, ['diff', '--numstat', ...range])).out)) if (!byPath.has(f.path)) byPath.set(f.path, f);
    diff += (await git(root, ['diff', '--no-color', ...range])).out;
  }
  return { branch, files: [...byPath.values()], diff: diff.slice(0, DIFF_LIMIT), truncated: diff.length > DIFF_LIMIT, impacts };
}
