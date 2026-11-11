import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ConfirmArg, type Done, type DiffView, type FileDiffView, type Overview, protectedMessage } from '../../shared/git-api.js';
import { ChangeSet } from '../../shared/git-changes.js';
import { FileDiff, type PatchMode, type Selection } from '../../shared/git-diff.js';
import { BranchName, compareUrl, GitInputError, ProtectedBranches, RepoPath, StashMessage, type StashRef } from '../../shared/git-guard.js';
import { classifyStashApply, parseStashes, STASH_FORMAT, stashDropMessage, type StashView } from '../../shared/git-stash.js';
import { BRANCH_FORMAT, branchView, LOG_FORMAT, LOG_LIMIT, parseBranches, parseLog } from '../../shared/git-lists.js';
import { parseWorktrees, type WorktreeView } from '../../shared/git-worktrees.js';
import { knownGitError, knownLocalGitError, pullDoneMessage } from '../../shared/git-toolbar.js';
import { assertPlainFile } from './safe-file.js';
import { belongsToRepo } from './worktree-owner.js';
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

  /** 마지막으로 원격을 확인한 시각: git이 fetch·pull 때마다 고치는 FETCH_HEAD 파일의 수정 시각 */
  private async fetchedAt(): Promise<number | null> {
    const r = await runGit(this.root, ['rev-parse', '--git-path', 'FETCH_HEAD']);
    if (r.code !== 0) return null;
    try {
      return Math.floor((await stat(resolve(this.root, r.stdout.trim()))).mtimeMs / 1000);
    } catch {
      return null;
    }
  }

  private async stagedLines(): Promise<{ added: number; removed: number } | null> {
    const r = await runGit(this.root, ['diff', '--cached', '--numstat', '--no-color', '--no-ext-diff']);
    if (r.code !== 0) return null;
    let added = 0;
    let removed = 0;
    for (const line of r.stdout.split('\n')) {
      const m = /^(\d+)\t(\d+)\t/.exec(line);
      if (m !== null) [added, removed] = [added + Number(m[1]), removed + Number(m[2])];
    }
    return { added, removed };
  }

  /** 지금 브랜치가 원격 브랜치보다 몇 커밋 뒤처졌는지(연결된 원격 브랜치가 없으면 null) */
  private async behindCount(): Promise<number | null> {
    const r = await runGit(this.root, ['rev-list', '--count', 'HEAD..@{upstream}']);
    return r.code === 0 ? Number(r.stdout.trim()) : null;
  }

  /** 원격 명령이 실패하면 git의 영어 이유를 쉬운 말로 바꿔 던진다(아는 모양일 때만) */
  private async remote<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof GitFailure) {
        const easy = knownGitError(e.message);
        if (easy !== null) throw new GitFailure(e.code, easy);
      }
      throw e;
    }
  }

  /** 로컬 git 작업이 실패하면 git의 영어 이유를 쉬운 말로 바꿔 던진다(아는 모양일 때만) */
  private async local<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof GitFailure) {
        const easy = knownLocalGitError(e.message);
        if (easy !== null) throw new GitFailure(e.code, easy);
      }
      throw e;
    }
  }

  async overview(): Promise<Overview> {
    // 서로 기다릴 필요 없는 git 호출은 한꺼번에 돌린다(윈도우는 프로세스 하나 띄우는 데 100ms 안팎이 든다)
    const [s, merging, remote, fetchedAt, staged] = await Promise.all([this.status(), this.isMerging(), this.remoteName(), this.fetchedAt(), this.stagedLines()]);
    return { branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind, files: s.views(), merging, hasRemote: remote !== null, fetchedAt, staged };
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
    return ok(`Staged ${list.length} file(s).`);
  }

  async unstage(paths: readonly string[]): Promise<Done> {
    const list = this.paths(paths);
    if (list.length > 0) await this.git((await this.hasHead()) ? ['restore', '--staged', '--', ...list] : ['rm', '--cached', '-r', '-q', '--', ...list]);
    return ok(`Unstaged ${list.length} file(s).`);
  }

  /** hunk 또는 줄 단위로 스테이지·스테이지 해제한다. 패치는 main이 git diff에서 직접 만든다(화면이 보낸 패치를 믿지 않는다). */
  async stageSelection(path: string, selection: Selection, mode: PatchMode): Promise<Done> {
    const p = RepoPath.parse(path).value;
    const text = (await runGit(this.root, ['diff', ...(mode === 'unstage' ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--', p])).stdout;
    const patch = FileDiff.parse(text).patchFor(selection, mode);
    if (patch === '') throw new GitFailure('INVALID', 'No changes selected.');
    await this.git(['apply', '--cached', '--recount', '--whitespace=nowarn', ...(mode === 'unstage' ? ['--reverse'] : []), '-'], patch);
    return ok(mode === 'stage' ? 'Staged the selected changes.' : 'Unstaged the selected changes.');
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
    return ok(`Discarded changes in ${list.length} file(s).`);
  }

  async commit(subject: string, body: string): Promise<Done> {
    const title = subject.trim();
    if (title === '') throw new GitFailure('INVALID', 'Please enter a commit subject.');
    if (!(await this.status()).files.some((f) => f.isStaged())) throw new GitFailure('INVALID', 'No staged files.');
    await this.local(() => this.git(['commit', '-q', '-m', title, ...(body.trim() === '' ? [] : ['-m', body.trim()])]));
    const hash = (await this.git(['rev-parse', 'HEAD'])).trim();
    return ok(`Committed ${hash.slice(0, 7)}  ${title}`, { hash });
  }

  /** 이 레포의 작업 트리(메인 폴더와 worktree)와 각 폴더의 변경 파일 수·마지막 커밋 */
  async worktrees(): Promise<WorktreeView[]> {
    const rows = parseWorktrees(await this.git(['worktree', 'list', '--porcelain']));
    const common = resolve(this.root, (await this.git(['rev-parse', '--git-common-dir'])).trim());
    return Promise.all(
      rows.slice(0, 30).map(async (w) => {
        // 이 레포의 폴더가 아니면 그 폴더에서 git을 돌리지 않는다(그 폴더의 설정이 프로그램을 돌릴 수 있다)
        const skip = w.prunable || !(await belongsToRepo(w.path, common));
        const st = skip ? null : await runGit(w.path, ['status', '--porcelain']);
        const lg = skip ? null : await runGit(w.path, ['log', '-1', '--format=%an%x1f%at%x1f%s']);
        const [author = '', at = '0', subject = ''] = lg !== null && lg.code === 0 ? lg.stdout.trim().split(String.fromCharCode(31)) : [];
        const changed = st !== null && st.code === 0 ? st.stdout.split('\n').filter((l) => l.trim() !== '').length : 0;
        return { ...w, changed, author, at: Number(at) || 0, subject };
      }),
    );
  }

  async branches() {
    return parseBranches(await this.git(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'])).map(branchView);
  }

  /** base(기준 브랜치)에서 새 브랜치를 만든다. 기준이 원격 브랜치여도 그 원격에 연결하지 않는다. checkout=false면 옮기지 않는다. */
  async createBranch(name: string, base?: string, checkout = true): Promise<Done> {
    const n = BranchName.parse(name).value;
    const from = base === undefined ? [] : [BranchName.parse(base).value];
    if (checkout) {
      await this.git(['switch', '--no-track', '-c', n, ...from]);
      return ok(`Created branch ${n} and switched to it.`);
    }
    await this.git(['branch', '--no-track', n, ...from]);
    return ok(`Created branch ${n}. Did not switch to it.`);
  }

  /** 직전 커밋을 취소한다(soft reset: 바뀐 내용은 스테이지에 그대로 남는다). 이미 원격에 올라갔거나 첫 커밋이면 막는다. */
  async undoCommit(): Promise<Done> {
    if (!(await this.hasHead()) || (await runGit(this.root, ['rev-parse', '-q', '--verify', 'HEAD~1'])).code !== 0) throw new GitFailure('BLOCKED', 'There is no earlier commit to go back to (this is the first commit).');
    if (await this.isMerging()) throw new GitFailure('BLOCKED', 'Cannot undo a commit during a merge.');
    if ((await this.git(['branch', '-r', '--contains', 'HEAD'])).trim() !== '') throw new GitFailure('BLOCKED', 'This commit is already on the remote, so it cannot be undone.');
    const subject = (await this.git(['log', '-1', '--format=%s'])).trim();
    await this.git(['reset', '--soft', 'HEAD~1']);
    return ok(`Undid the last commit (${subject}). The changes are still staged.`);
  }

  /** 전환. 커밋 안 한 변경이 막으면 git의 이유를 그대로 돌려주고 강제로 하지 않는다. */
  async switchBranch(name: string): Promise<Done> {
    const n = BranchName.parse(name).value;
    const remoteOnly = (await runGit(this.root, ['rev-parse', '-q', '--verify', `refs/remotes/${n}`])).code === 0 && (await runGit(this.root, ['rev-parse', '-q', '--verify', `refs/heads/${n}`])).code !== 0;
    await this.local(() => mustGit(this.root, remoteOnly ? ['switch', '--track', n] : ['switch', n], undefined, 'BLOCKED'));
    return ok(`Switched to ${n}.`);
  }

  private async guardCurrent(action: string, confirm: ConfirmArg): Promise<string> {
    const branch = await this.currentBranch();
    if (branch === null) throw new GitFailure('INVALID', 'Not on a branch (detached HEAD).');
    if (this.protectedBranches.has(branch) && confirm.confirmed !== true) throw new GitFailure('PROTECTED', `${protectedMessage(branch)} Confirmation is needed to ${action}.`);
    return branch;
  }

  async merge(name: string, confirm: ConfirmArg): Promise<Done> {
    const n = BranchName.parse(name).value;
    const into = await this.guardCurrent('merge', confirm);
    const r = await runGit(this.root, ['merge', '--no-edit', n]);
    if (r.code === 0) return ok(`Merged ${n} into ${into}.`);
    if (await this.isMerging()) return ok(`Conflicts found. Resolve them in the Conflicts tab.`, { conflicts: true });
    throw new GitFailure('BLOCKED', (r.stderr.trim() || r.stdout.trim()).split('\n').slice(0, 6).join('\n'));
  }

  /** 안전한 삭제(-d): 아직 합치지 않은 커밋이 있으면 git이 거절한다. 현재 브랜치와 보호 브랜치는 지우지 않는다. */
  async deleteBranch(name: string): Promise<Done> {
    const n = BranchName.parse(name).value;
    if (n === (await this.currentBranch())) throw new GitFailure('BLOCKED', 'Cannot delete the current branch.');
    if (this.protectedBranches.has(n)) throw new GitFailure('BLOCKED', `${protectedMessage(n)} Not deleted.`);
    await this.local(() => mustGit(this.root, ['branch', '-d', n], undefined, 'BLOCKED'));
    return ok(`Deleted branch ${n}.`);
  }

  async fetch(): Promise<Done> {
    await this.remote(() => this.git(['fetch', '--prune']));
    const received = await this.behindCount();
    if (received === null) return ok('Checked the remote.');
    return ok(received > 0 ? `The remote has ${received} new commit(s). You can pull them.` : 'Nothing new.', { received });
  }

  /** 기본은 fast-forward만(--ff-only). 안 되면 이유를 돌려주고, 사용자가 고르면 merge 방식으로 한다. */
  async pull(mode: 'ff' | 'merge'): Promise<Done> {
    const before = (await runGit(this.root, ['rev-parse', '-q', '--verify', 'HEAD'])).stdout.trim();
    const r = await runGit(this.root, mode === 'ff' ? ['pull', '--ff-only'] : ['pull', '--no-rebase', '--no-edit']);
    if (r.code === 0) {
      const counted = before === '' ? null : await runGit(this.root, ['rev-list', '--count', `${before}..HEAD`]);
      const received = counted === null || counted.code !== 0 ? null : Number(counted.stdout.trim());
      return ok(pullDoneMessage(received), received === null ? {} : { received });
    }
    if (await this.isMerging()) return ok('Conflicts found. Resolve them in the Conflicts tab.', { conflicts: true });
    const raw = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(0, 6).join('\n');
    throw new GitFailure('BLOCKED', knownGitError(raw) ?? raw);
  }

  /** push는 force 없이 현재 브랜치만. 보호 브랜치면 확인이 필요하다. */
  async push(confirm: ConfirmArg): Promise<Done> {
    const branch = await this.guardCurrent('push', confirm);
    const s = await this.status();
    const remote = await this.remoteName();
    if (remote === null) throw new GitFailure('INVALID', 'There is no remote.');
    await this.remote(() => this.git(s.upstream === null ? ['push', '-u', remote, branch] : ['push']));
    return ok(`Pushed ${branch}.`);
  }

  /** 최근 커밋 목록(상한 LOG_LIMIT). --topo-order 라 자식이 부모보다 먼저 와서 그래프를 그릴 수 있다. all 이면 모든 브랜치. */
  async log(ref?: string, all = false) {
    if (!(await this.hasHead())) return [];
    const target = all ? ['--all'] : ref === undefined ? [] : [BranchName.parse(ref).value];
    return parseLog(await this.git(['log', '--topo-order', '--no-color', '--no-show-signature', `-n${LOG_LIMIT}`, `--format=${LOG_FORMAT}`, ...target, '--']));
  }

  async commitDiff(hash: string): Promise<FileDiffView[]> {
    if (!NO_COMMIT.test(hash)) throw new GitInputError('The commit id is not valid.');
    const text = await this.git(['show', '--no-color', '--no-ext-diff', '--format=', '-m', '--first-parent', '-p', hash]);
    return FileDiff.parseAll(text).map((f) => ({ path: f.path, binary: f.diff.isBinary(), hunks: f.diff.hunks }));
  }

  async mergeState(): Promise<{ merging: boolean; conflicts: string[] }> {
    const conflicts = (await this.status()).conflicts().map((f) => f.path);
    return { merging: await this.isMerging(), conflicts };
  }

  private async assertConflict(path: string): Promise<string> {
    const p = RepoPath.parse(path).value;
    if (!(await this.mergeState()).conflicts.includes(p)) throw new GitFailure('INVALID', 'This file is not in conflict.');
    return p;
  }

  /** "내 것"은 지금 브랜치(ours), "상대 것"은 합치려는 쪽(theirs). 고른 쪽으로 파일을 바꾸고 해결됨으로 표시한다. */
  async resolveSide(path: string, side: 'ours' | 'theirs'): Promise<Done> {
    const p = await this.assertConflict(path);
    await this.git(['checkout', `--${side}`, '--', p]);
    await this.git(['add', '--', p]);
    return ok(`${p}: resolved using ${side === 'ours' ? 'mine' : 'theirs'}.`);
  }

  async readConflict(path: string): Promise<{ text: string }> {
    const file = join(this.root, await this.assertConflict(path));
    await assertPlainFile(file);
    return { text: await readFile(file, 'utf8') };
  }

  async writeConflict(path: string, text: string): Promise<Done> {
    const file = join(this.root, await this.assertConflict(path));
    await assertPlainFile(file);
    await writeFile(file, text, 'utf8');
    return ok('Saved. Check it, then press "Resolved".');
  }

  async markResolved(path: string): Promise<Done> {
    const p = await this.assertConflict(path);
    await assertPlainFile(join(this.root, p));
    if (/^(<{7}|>{7}) /m.test(await readFile(join(this.root, p), 'utf8'))) throw new GitFailure('BLOCKED', 'Conflict markers (<<<<<<<) are still in the file.');
    await this.git(['add', '--', p]);
    return ok(`${p}: marked as resolved.`);
  }

  async finishMerge(): Promise<Done> {
    if (!(await this.isMerging())) throw new GitFailure('INVALID', 'No merge in progress.');
    if ((await this.mergeState()).conflicts.length > 0) throw new GitFailure('BLOCKED', 'There are still unresolved conflicts.');
    await this.local(() => this.git(['commit', '--no-edit', '-q']));
    return ok('Merge finished.');
  }

  async abortMerge(): Promise<Done> {
    await this.git(['merge', '--abort']);
    return ok('Merge aborted and everything restored.');
  }

  async stashList(): Promise<StashView[]> {
    return parseStashes(await this.git(['stash', 'list', `--format=${STASH_FORMAT}`]));
  }

  /**
   * 바뀐 파일을 stash 로 치운다. 첫 커밋이 없거나, 충돌이 남았거나, 치울 변경이 없으면 막는다(빈 stash 를 만들지 않는다).
   * 메시지는 값 객체로 검증하고, 새 파일 포함(--include-untracked)도 무시한 파일(.gitignore)은 건드리지 않는다.
   */
  async stash(message: unknown, includeUntracked: boolean): Promise<Done> {
    const msg = StashMessage.parse(message).value;
    if (!(await this.hasHead())) throw new GitFailure('BLOCKED', 'Make the first commit before stashing.');
    const s = await this.status();
    if (s.hasConflicts() || (await this.isMerging())) throw new GitFailure('BLOCKED', 'Resolve the conflicts or finish the merge before stashing.');
    if (!s.files.some((f) => includeUntracked || !f.isUntracked())) throw new GitFailure('BLOCKED', includeUntracked ? 'Nothing to stash.' : 'Nothing to stash (new files are not included).');
    await this.local(() => mustGit(this.root, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(msg === '' ? [] : ['-m', msg])], undefined, 'BLOCKED'));
    return ok(msg === '' ? 'Stashed your changes.' : `Stashed your changes: ${msg}`);
  }

  /** 목록을 본 뒤 번호가 밀렸으면(그 번호의 해시가 다르면) 아무것도 하지 않는다 */
  private async assertStash(ref: StashRef): Promise<void> {
    const r = await runGit(this.root, ['rev-parse', '-q', '--verify', ref.name]);
    if (r.code !== 0 || r.stdout.trim() !== ref.hash) throw new GitFailure('BLOCKED', 'The stash list changed. Reload the list and try again.');
  }

  private async applyStash(mode: 'apply' | 'pop', ref: StashRef): Promise<Done> {
    await this.assertStash(ref);
    const out = classifyStashApply(mode, await runGit(this.root, ['stash', mode, ref.name]), ref.name);
    if (out.kind === 'blocked') throw new GitFailure('BLOCKED', out.message);
    return ok(out.message, out.kind === 'conflict' ? { conflicts: true } : {});
  }

  stashApply(ref: StashRef): Promise<Done> {
    return this.applyStash('apply', ref);
  }

  stashPop(ref: StashRef): Promise<Done> {
    return this.applyStash('pop', ref);
  }

  async stashDrop(ref: StashRef): Promise<Done> {
    await this.assertStash(ref);
    return ok(stashDropMessage(ref.name, await this.git(['stash', 'drop', ref.name])));
  }

  /** GitHub 비교 주소(PR 만들기 화면). GitHub 원격이 아니면 실패한다. */
  async prUrl(base: string): Promise<{ url: string }> {
    const b = BranchName.parse(base).value;
    const branch = await this.currentBranch();
    const remote = await this.remoteName();
    if (branch === null || remote === null) throw new GitFailure('INVALID', 'There is no branch or remote.');
    const url = compareUrl((await this.git(['remote', 'get-url', remote])).trim(), b, branch);
    if (url === null) throw new GitFailure('INVALID', 'This is not a GitHub remote, so no PR address can be built.');
    return { url };
  }
}
