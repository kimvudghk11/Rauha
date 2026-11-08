import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gitdirOf } from '../../shared/git-worktrees.js';

const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

/**
 * worktree 목록에 적힌 폴더가 정말 이 레포(commonDir)의 폴더인지 확인한다. 목록은 `.git/worktrees/*`의 파일에서 오는데,
 * 받은 압축 파일 같은 데 든 그 파일이 아무 폴더나 가리키게 할 수 있다. 그 폴더의 설정(core.fsmonitor 등)은 git이 읽는 순간 프로그램을 돌릴 수 있으므로,
 * 이 레포의 `.git`이거나, `.git` 파일이 이 레포의 `worktrees/` 항목을 가리키는 폴더에서만 git을 돌린다.
 */
export async function belongsToRepo(worktreePath: string, commonDir: string): Promise<boolean> {
  try {
    const common = fold(await realpath(commonDir));
    const dotGit = join(worktreePath, '.git');
    const info = await lstat(dotGit);
    if (info.isSymbolicLink()) return false;
    // 메인 작업 폴더: .git 폴더가 바로 이 레포의 공용 폴더다
    if (info.isDirectory()) return fold(await realpath(dotGit)) === common;
    if (!info.isFile() || info.size > 4096) return false;
    const target = gitdirOf(await readFile(dotGit, 'utf8'));
    if (target === null) return false;
    // 이 항목(.git/worktrees/이름)이 이 레포 것이고, 그 항목의 gitdir 이 다시 이 폴더의 .git 을 가리켜야 한다(서로 맞물려야 진짜다)
    const entry = await realpath(resolve(worktreePath, target));
    if (fold(dirname(entry)) !== fold(join(common, 'worktrees'))) return false;
    const back = (await readFile(join(entry, 'gitdir'), 'utf8')).split(/\r?\n/)[0]?.trim() ?? '';
    return back !== '' && fold(await realpath(resolve(entry, back))) === fold(await realpath(dotGit));
  } catch {
    return false;
  }
}
