import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DomainError } from '../../shared/domain-error.js';
import { relativeToRoot } from '../../shared/path-pattern.js';
import type { FileChange, WorkspacePort, WorkspaceSnapshot } from '../application/ports.js';
import { SecretPolicy } from '../domain/secret-policy.js';

const run = promisify(execFile);
const IGNORED = /(^|\/)node_modules\//;
/** 접수 팀장에게 넘기는 파일 목록 상한. 큰 저장소에서 메시지가 커지지 않게 한다. */
const MAX_LISTED_FILES = 300;
/** 커밋이 하나도 없는 저장소에서 비교 기준으로 쓰는 빈 트리. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

interface Entry {
  readonly path: string;
  readonly kind: FileChange['kind'];
}

function kindOf(letter: string): FileChange['kind'] {
  if (letter === 'A') return 'added';
  if (letter === 'D') return 'deleted';
  return 'modified';
}

/**
 * git으로 작업 트리를 본다. 비교 기준은 처음 본 시점의 커밋(시작 커밋)이라,
 * 팀원이 몰래 커밋해도 바뀐 파일을 놓치지 않는다. 경로는 실행 폴더 기준이고 그 폴더 밖은 보지 않는다.
 * 스냅숏 값은 `<종류>:<내용 해시>`.
 */
export class GitWorkspace implements WorkspacePort {
  private base: string | null = null;

  constructor(
    private readonly root: string,
    /** 비밀 파일은 rauha도 읽지 않는다. 팀원 메시지(<files>)와 근거 확인에 내용이 들어가지 않게. */
    private readonly secrets: SecretPolicy = SecretPolicy.defaults(),
  ) {}

  async dirtyFiles(): Promise<string[] | null> {
    try {
      await this.git(['rev-parse', '--is-inside-work-tree']);
    } catch {
      return null;
    }
    await this.startCommit();
    const out = await this.git(['status', '--porcelain=v1', '-z', '-uall', '--', '.'], false);
    const prefix = await this.git(['rev-parse', '--show-prefix']);
    const paths: string[] = [];
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] as string;
      if (part.length < 4) continue;
      const path = part.slice(3);
      if (path.startsWith(prefix) && !IGNORED.test(path)) paths.push(path.slice(prefix.length));
      if (part.startsWith('R') || part.startsWith('C')) i += 1; // 이름 바꾸기는 원래 이름이 뒤따른다.
    }
    return paths.sort();
  }

  async listFiles(): Promise<string[]> {
    const out = await this.git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], false);
    return [...new Set(out.split('\0').filter((p) => p !== '' && !IGNORED.test(p)))].sort().slice(0, MAX_LISTED_FILES);
  }

  /** 파일의 최근 커밋 "해시 날짜 제목"(새것부터). 밖·비밀 파일이거나 git 이 실패하면 빈 목록. */
  async recentCommits(path: string, limit: number): Promise<string[]> {
    const rel = relativeToRoot(this.root, path);
    if (rel === null || this.secrets.isSecret(rel)) return [];
    try {
      const out = await this.git(['log', `-n${limit}`, '--date=short', '--format=%h %ad %s', '--', rel]);
      return out === '' ? [] : out.split('\n').map((l) => l.slice(0, 160));
    } catch {
      return [];
    }
  }

  /** 근거 확인용. 작업 폴더 밖, 없는 파일, 비밀 파일은 null. */
  async readFile(path: string): Promise<string | null> {
    const rel = relativeToRoot(this.root, path);
    if (rel === null || this.secrets.isSecret(rel)) return null;
    try {
      return await readFile(join(this.root, rel), 'utf8');
    } catch {
      return null;
    }
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const entries = await this.changes();
    const present = entries.filter((e) => e.kind !== 'deleted');
    const hashes = present.length > 0 ? (await this.git(['hash-object', '--stdin-paths'], true, present.map((e) => join(this.root, e.path)).join('\n'))).split('\n') : [];
    const files = new Map<string, string>();
    present.forEach((e, i) => files.set(e.path, `${e.kind}:${hashes[i] ?? ''}`));
    for (const e of entries.filter((x) => x.kind === 'deleted')) files.set(e.path, 'deleted:');
    return { files };
  }

  changesBetween(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChange[] {
    const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort();
    return paths
      .filter((p) => before.files.get(p) !== after.files.get(p))
      .map((p) => {
        const value = after.files.get(p);
        // 스냅숏에서 사라졌다 = 시작 커밋 상태로 되돌렸다.
        return { path: p, kind: value === undefined ? 'modified' : (value.split(':')[0] as FileChange['kind']) };
      });
  }

  async changesSinceHead(): Promise<FileChange[]> {
    return (await this.changes()).map((e) => ({ path: e.path, kind: e.kind }));
  }

  /**
   * /review 대상. target이 null이면 지금 HEAD 대비(커밋 안 한 변경), 브랜치·커밋이면 그것과 갈라진 지점 대비.
   * 세션 시작 커밋이 아니라 부를 때의 HEAD를 쓴다(그사이 사용자가 커밋했을 수 있다).
   */
  async reviewChanges(target: string | null): Promise<FileChange[]> {
    const base = target === null ? await this.head() : await this.mergeBase(target);
    return (await this.changes(base)).map((e) => ({ path: e.path, kind: e.kind }));
  }

  private async head(): Promise<string> {
    try {
      return await this.git(['rev-parse', 'HEAD']);
    } catch {
      return EMPTY_TREE;
    }
  }

  /** `-`로 시작하는 이름은 git 옵션으로 읽히므로 받지 않는다. */
  private async mergeBase(target: string): Promise<string> {
    const unknown = new DomainError('UNKNOWN_REF', `${target} 브랜치나 커밋을 찾지 못했어요.`);
    if (target.startsWith('-')) throw unknown;
    try {
      await this.git(['rev-parse', '--verify', '--quiet', `${target}^{commit}`]);
      return await this.git(['merge-base', target, 'HEAD']);
    } catch {
      throw unknown;
    }
  }

  /** base(기본: 시작 커밋) 대비 바뀐 파일(커밋됐든 아니든) + 추적하지 않는 새 파일. */
  private async changes(from?: string): Promise<Entry[]> {
    const base = from ?? (await this.startCommit());
    const diff = (await this.git(['diff', '--name-status', '-z', '--no-renames', '--relative', base, '--', '.'], false)).split('\0');
    const entries = new Map<string, Entry>();
    for (let i = 0; i + 1 < diff.length; i += 2) {
      const letter = (diff[i] as string).trim().charAt(0);
      const path = diff[i + 1] as string;
      if (letter !== '' && path !== '' && !IGNORED.test(path)) entries.set(path, { path, kind: kindOf(letter) });
    }
    const untracked = (await this.git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], false)).split('\0');
    for (const path of untracked) {
      if (path !== '' && !IGNORED.test(path)) entries.set(path, { path, kind: 'added' });
    }
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private async startCommit(): Promise<string> {
    if (this.base === null) {
      try {
        this.base = await this.git(['rev-parse', 'HEAD']);
      } catch {
        this.base = EMPTY_TREE;
      }
    }
    return this.base;
  }

  private async git(args: readonly string[], trim = true, input?: string): Promise<string> {
    const child = run('git', ['-c', 'core.quotepath=false', ...args], { cwd: this.root, maxBuffer: 32 * 1024 * 1024 });
    if (input !== undefined) {
      // git이 입력을 다 읽기 전에 끝나도 EPIPE로 프로세스가 죽지 않게. 실패는 종료 코드로 알린다.
      child.child.stdin?.on('error', () => undefined);
      child.child.stdin?.end(input);
    }
    const { stdout } = await child;
    return trim ? stdout.trim() : stdout;
  }
}
