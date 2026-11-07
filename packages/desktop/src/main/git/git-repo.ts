import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ConfirmArg, type Done, type DiffView, type FileDiffView, type Overview, protectedMessage } from '../../shared/git-api.js';
import { ChangeSet } from '../../shared/git-changes.js';
import { FileDiff, type PatchMode, type Selection } from '../../shared/git-diff.js';
import { BranchName, compareUrl, GitInputError, ProtectedBranches, RepoPath } from '../../shared/git-guard.js';
import { BRANCH_FORMAT, branchView, LOG_FORMAT, LOG_LIMIT, parseBranches, parseLog } from '../../shared/git-lists.js';
import { GitFailure, mustGit, runGit } from './git-run.js';

const ok = (message: string, extra: Partial<Done> = {}): Done => ({ message, ...extra });
const NO_COMMIT = /^[0-9a-f]{4,64}$/;

/**
 * 레포 한 곳에서 git을 돌린다. root는 호출하는 쪽(RepoGate)이 이미 앱이 아는 레포 루트인지 확인한 값이다.
 * 사용자 입력은 값 객체(BranchName·RepoPath)로 검증한 뒤 인자로만 넘긴다.
 */
export class GitRepo {
  private constructor(
    private readonly root: string,
    private readonly protectedBranches: ProtectedBranches,
  ) {}

  static open(root: string, protectedBranches: readonly string[]): GitRepo {
    return new GitRepo(root, ProtectedBranches.of(protectedBranches));
  }

  private git = (args: readonly string[], input?: string) => mustGit(this.root, args, input);
  private paths = (list: readonly string[]) => list.map((p) => RepoPath.parse(p).value);

  private async status(): Promise<ChangeSet> {
    return ChangeSet.parse(await this.git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']));
  }
  private async hasHead(): Promise<boolean> {
    return (await runGit(this.root, ['rev-parse', '-q', '--verify', 'HEAD'])).code === 0;
  }
  private async isMerging(): Promise<boolean> {
    return (await runGit(this.root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code === 0;
  }
  private async currentBranch(): Promise<string | null> {
    return (await this.status()).branch;
  }
  private async remoteName(): Promise<string | null> {
    const first = (await this.git(['remote'])).split('\n')[0]?.trim();
    return first === undefined || first === '' ? null : first;
  }

  async overview(): Promise<Overview> {
    const s = await this.status();
    return { branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind, files: s.views(), merging: await this.isMerging(), hasRemote: (await this.remoteName()) !== null };
  }

  async diff(path: string, side: 'staged' | 'unstaged'): Promise<DiffView> {
    const p = RepoPath.parse(path).value;
    let text: string;
    if (side === 'staged') text = (await runGit(this.root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--', p])).stdout;
    else {
      const untracked = (await this.git(['ls-files', '--others', '--exclude-standard', '--', p])).trim() !== '';
      text = untracked ? (await runGit(this.root, ['diff', '--no-index', '--no-color', '--', '/dev/null', p])).stdout : (await runGit(this.root, ['diff', '--no-color', '--no-ext-diff', '--', p])).stdout;
    }
    const d = FileDiff.parse(text);
    return { binary: d.isBinary(), hunks: d.hunks };
  }

  async stage(paths: readonly string[]): Promise<Done> {
    const list = this.paths(paths);
    if (list.length > 0) await this.git(['add', '--', ...list]);
    return ok(`${list.length}개 파일을 스테이지했어요.`);
  }

  async unstage(paths: readonly string[]): Promise<Done> {
    const list = this.paths(paths);
    if (list.length > 0) await this.git((await this.hasHead()) ? ['restore', '--staged', '--', ...list] : ['rm', '--cached', '-r', '-q', '--', ...list]);
    return ok(`${list.length}개 파일의 스테이지를 풀었어요.`);
  }

  /** hunk 또는 줄 단위로 스테이지·스테이지 해제한다. 패치는 main이 git diff에서 직접 만든다(화면이 보낸 패치를 믿지 않는다). */
  async stageSelection(path: string, selection: Selection, mode: PatchMode): Promise<Done> {
    const p = RepoPath.parse(path).value;
    const text = (await runGit(this.root, ['diff', ...(mode === 'unstage' ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--', p])).stdout;
    const patch = FileDiff.parse(text).patchFor(selection, mode);
    if (patch === '') throw new GitFailure('INVALID', '고른 변경이 없어요.');
    await this.git(['apply', '--cached', '--recount', '--whitespace=nowarn', ...(mode === 'unstage' ? ['--reverse'] : []), '-'], patch);
    return ok(mode === 'stage' ? '고른 변경을 스테이지했어요.' : '고른 변경의 스테이지를 풀었어요.');
  }

  /** 바뀐 파일을 버린다(추적 중인 파일은 HEAD 상태로, 추적 안 하는 파일은 지운다). 되돌릴 수 없다. */
  async discard(paths: readonly string[]): Promise<Done> {
    const list = this.paths(paths);
    const head = await this.hasHead();
    for (const p of list) {
      const untracked = (await this.git(['ls-files', '--others', '--exclude-standard', '--', p])).trim() !== '';
      if (untracked) await this.git(['clean', '-f', '-q', '--', p]);
      else if (head) await this.git(['restore', '--source=HEAD', '--staged', '--worktree', '--', p]);
      else await this.git(['rm', '--cached', '-f', '-q', '--', p]);
    }
    return ok(`${list.length}개 파일의 변경을 버렸어요.`);
  }

  async commit(subject: string, body: string): Promise<Done> {
    const title = subject.trim();
    if (title === '') throw new GitFailure('INVALID', '커밋 제목을 적어 주세요.');
    if (!(await this.status()).files.some((f) => f.isStaged())) throw new GitFailure('INVALID', '스테이지한 파일이 없어요.');
    await this.git(['commit', '-q', '-m', title, ...(body.trim() === '' ? [] : ['-m', body.trim()])]);
    return ok(`커밋했어요 ${(await this.git(['rev-parse', '--short', 'HEAD'])).trim()}  ${title}`);
  }

  async branches() {
    return parseBranches(await this.git(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'])).map(branchView);
  }

  async createBranch(name: string): Promise<Done> {
    const n = BranchName.parse(name).value;
    await this.git(['switch', '-c', n]);
    return ok(`${n} 브랜치를 만들고 옮겨 왔어요.`);
  }

  /** 전환. 커밋 안 한 변경이 막으면 git의 이유를 그대로 돌려주고 강제로 하지 않는다. */
  async switchBranch(name: string): Promise<Done> {
    const n = BranchName.parse(name).value;
    const remoteOnly = (await runGit(this.root, ['rev-parse', '-q', '--verify', `refs/remotes/${n}`])).code === 0 && (await runGit(this.root, ['rev-parse', '-q', '--verify', `refs/heads/${n}`])).code !== 0;
    await mustGit(this.root, remoteOnly ? ['switch', '--track', n] : ['switch', n], undefined, 'BLOCKED');
    return ok(`${n} 브랜치로 옮겼어요.`);
  }

  private async guardCurrent(action: string, confirm: ConfirmArg): Promise<string> {
    const branch = await this.currentBranch();
    if (branch === null) throw new GitFailure('INVALID', '브랜치 위에 있지 않아요(분리된 HEAD).');
    if (this.protectedBranches.has(branch) && confirm.confirmed !== true) throw new GitFailure('PROTECTED', `${protectedMessage(branch)} ${action}하려면 확인이 필요해요.`);
    return branch;
  }

  async merge(name: string, confirm: ConfirmArg): Promise<Done> {
    const n = BranchName.parse(name).value;
    const into = await this.guardCurrent('합치기', confirm);
    const r = await runGit(this.root, ['merge', '--no-edit', n]);
    if (r.code === 0) return ok(`${n}을(를) ${into}에 합쳤어요.`);
    if (await this.isMerging()) return ok(`충돌이 났어요. 충돌 탭에서 풀어 주세요.`, { conflicts: true });
    throw new GitFailure('BLOCKED', (r.stderr.trim() || r.stdout.trim()).split('\n').slice(0, 6).join('\n'));
  }

  /** 안전한 삭제(-d): 아직 합치지 않은 커밋이 있으면 git이 거절한다. 현재 브랜치와 보호 브랜치는 지우지 않는다. */
  async deleteBranch(name: string): Promise<Done> {
    const n = BranchName.parse(name).value;
    if (n === (await this.currentBranch())) throw new GitFailure('BLOCKED', '지금 있는 브랜치는 지울 수 없어요.');
    if (this.protectedBranches.has(n)) throw new GitFailure('BLOCKED', `${protectedMessage(n)} 지우지 않아요.`);
    await mustGit(this.root, ['branch', '-d', n], undefined, 'BLOCKED');
    return ok(`${n} 브랜치를 지웠어요.`);
  }

  async fetch(): Promise<Done> {
    await this.git(['fetch', '--prune']);
    return ok('원격 소식을 가져왔어요.');
  }

  /** 기본은 fast-forward만(--ff-only). 안 되면 이유를 돌려주고, 사용자가 고르면 merge 방식으로 한다. */
  async pull(mode: 'ff' | 'merge'): Promise<Done> {
    const r = await runGit(this.root, mode === 'ff' ? ['pull', '--ff-only'] : ['pull', '--no-rebase', '--no-edit']);
    if (r.code === 0) return ok(/Already up to date/i.test(r.stdout) ? '이미 최신이에요.' : '가져와서 합쳤어요.');
    if (await this.isMerging()) return ok('충돌이 났어요. 충돌 탭에서 풀어 주세요.', { conflicts: true });
    throw new GitFailure('BLOCKED', (r.stderr.trim() || r.stdout.trim()).split('\n').slice(0, 6).join('\n'));
  }

  /** push는 force 없이 현재 브랜치만. 보호 브랜치면 확인이 필요하다. */
  async push(confirm: ConfirmArg): Promise<Done> {
    const branch = await this.guardCurrent('push', confirm);
    const s = await this.status();
    const remote = await this.remoteName();
    if (remote === null) throw new GitFailure('INVALID', '원격이 없어요.');
    await this.git(s.upstream === null ? ['push', '-u', remote, branch] : ['push']);
    return ok(`${branch}을(를) 올렸어요.`);
  }

  async log(ref?: string) {
    if (!(await this.hasHead())) return [];
    const target = ref === undefined ? [] : [BranchName.parse(ref).value];
    return parseLog(await this.git(['log', `-n${LOG_LIMIT}`, `--format=${LOG_FORMAT}`, ...target, '--']));
  }

  async commitDiff(hash: string): Promise<FileDiffView[]> {
    if (!NO_COMMIT.test(hash)) throw new GitInputError('커밋 번호가 올바르지 않아요.');
    const text = await this.git(['show', '--no-color', '--no-ext-diff', '--format=', '-m', '--first-parent', '-p', hash]);
    return FileDiff.parseAll(text).map((f) => ({ path: f.path, binary: f.diff.isBinary(), hunks: f.diff.hunks }));
  }

  async mergeState(): Promise<{ merging: boolean; conflicts: string[] }> {
    const conflicts = (await this.status()).conflicts().map((f) => f.path);
    return { merging: await this.isMerging(), conflicts };
  }

  private async assertConflict(path: string): Promise<string> {
    const p = RepoPath.parse(path).value;
    if (!(await this.mergeState()).conflicts.includes(p)) throw new GitFailure('INVALID', '충돌 중인 파일이 아니에요.');
    return p;
  }

  /** "내 것"은 지금 브랜치(ours), "상대 것"은 합치려는 쪽(theirs). 고른 쪽으로 파일을 바꾸고 해결됨으로 표시한다. */
  async resolveSide(path: string, side: 'ours' | 'theirs'): Promise<Done> {
    const p = await this.assertConflict(path);
    await this.git(['checkout', `--${side}`, '--', p]);
    await this.git(['add', '--', p]);
    return ok(`${p}: ${side === 'ours' ? '내 것' : '상대 것'}으로 해결했어요.`);
  }

  async readConflict(path: string): Promise<{ text: string }> {
    return { text: await readFile(join(this.root, await this.assertConflict(path)), 'utf8') };
  }

  async writeConflict(path: string, text: string): Promise<Done> {
    await writeFile(join(this.root, await this.assertConflict(path)), text, 'utf8');
    return ok('저장했어요. 확인하고 "해결됨"을 눌러 주세요.');
  }

  async markResolved(path: string): Promise<Done> {
    const p = await this.assertConflict(path);
    if (/^(<{7}|>{7}) /m.test(await readFile(join(this.root, p), 'utf8'))) throw new GitFailure('BLOCKED', '충돌 표시(<<<<<<<)가 아직 남아 있어요.');
    await this.git(['add', '--', p]);
    return ok(`${p}: 해결됨으로 표시했어요.`);
  }

  async finishMerge(): Promise<Done> {
    if (!(await this.isMerging())) throw new GitFailure('INVALID', '진행 중인 머지가 없어요.');
    if ((await this.mergeState()).conflicts.length > 0) throw new GitFailure('BLOCKED', '아직 풀지 않은 충돌이 있어요.');
    await this.git(['commit', '--no-edit', '-q']);
    return ok('머지를 마쳤어요.');
  }

  async abortMerge(): Promise<Done> {
    await this.git(['merge', '--abort']);
    return ok('머지를 중단하고 원래대로 돌렸어요.');
  }

  /** GitHub 비교 주소(PR 만들기 화면). GitHub 원격이 아니면 실패한다. */
  async prUrl(base: string): Promise<{ url: string }> {
    const b = BranchName.parse(base).value;
    const branch = await this.currentBranch();
    const remote = await this.remoteName();
    if (branch === null || remote === null) throw new GitFailure('INVALID', '브랜치나 원격이 없어요.');
    const url = compareUrl((await this.git(['remote', 'get-url', remote])).trim(), b, branch);
    if (url === null) throw new GitFailure('INVALID', 'GitHub 원격이 아니라서 PR 주소를 만들 수 없어요.');
    return { url };
  }
}
