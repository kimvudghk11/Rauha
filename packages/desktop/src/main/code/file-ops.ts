import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { CodeFail, CreateRequest, DuplicateRequest, InspectResult, MoveRequest, NodeKind, OpResult, PathRequest, RenameRequest } from '../../shared/code-api.js';
import { checkName, copyName, inProtectedZone, joinPath, nameOf, parentOf, planMove, tooLongPath } from '../../shared/code-ops.js';
import type { CodeFiles } from './code-files.js';
import { isInside } from './code-path.js';
import { CreateRequestDto, DuplicateRequestDto, MoveRequestDto, PathRequestDto, RenameRequestDto } from './op-request.js';

/** 복제할 폴더의 파일 수·전체 크기 상한 */
const MAX_COPY_FILES = 2000;
const MAX_COPY_BYTES = 100 * 1024 * 1024;
/** 삭제 확인 창에 보일 파일 수를 세는 상한 */
const MAX_COUNT = 10_000;
/** Windows의 경로 길이 한도(260)에서 여유를 둔 값 */
const MAX_ABS_WIN = 250;

export interface FileOpsDeps {
  readonly files: CodeFiles;
  /** 휴지통으로 보낸다(Electron shell.trashItem). 실패하면 던진다 — 영구 삭제로 대신하지 않는다. */
  readonly trash: (absPath: string) => Promise<void>;
  /** 파일 관리자에서 보여 준다(shell.showItemInFolder) */
  readonly reveal: (absPath: string) => void;
  /** 앱이 작업 폴더에서 찾은 레포·문서 폴더의 루트(절대 경로). .git이 든 폴더는 이 목록과 상관없이 막는다. */
  readonly protectedRoots: () => readonly string[] | Promise<readonly string[]>;
  readonly platform?: NodeJS.Platform;
}

const toSlash = (p: string): string => p.split(sep).join('/');
const fail = (reason: CodeFail, detail?: string): { ok: false; reason: CodeFail; detail?: string } => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail });

function errorFail(e: unknown): { ok: false; reason: CodeFail; detail?: string } {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return fail('read-only');
  if (code === 'EEXIST') return fail('exists');
  if (code === 'ENAMETOOLONG') return fail('too-long');
  return fail('error', code ?? (e instanceof Error ? e.message : undefined));
}

/**
 * 코드 탭의 파일 조작(새로 만들기·이름 바꾸기·복제·옮기기·휴지통). main에서만 돈다. 사용자가 직접 하는 일이라 허락 카드는 없다. 지키는 것:
 * - 경로는 code-files의 검사를 그대로 쓴다(작업 폴더 밖·`..`·바로가기로 새는 길·`.git`은 막는다). 판정은 링크를 다 푼 실제 경로로 한다.
 * - 덮어쓰지 않는다. 이름이 겹치면 거절한다(복제만 "이름 복사본"으로 비어 있는 이름을 고른다).
 * - 작업 폴더 루트, 레포 루트(.git이 든 폴더), 문서 폴더 루트, node_modules 안은 바꾸지 않는다.
 * - 삭제는 영구 삭제가 아니라 휴지통이다. 휴지통이 안 되면 지우지 않는다.
 * - 비밀 파일(.env 등)은 이름 바꾸기·옮기기·삭제만 된다. 내용을 복제하지 않고, 비밀이 아닌 이름으로 바꾸어 내용이 열리게 하지도 않는다.
 */
export class FileOps {
  constructor(private readonly deps: FileOpsDeps) {}

  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }
  /** 이름이 겹치는지 볼 때: Windows·macOS는 대소문자를 구분하지 않는다 */
  private get ci(): boolean {
    return this.platform === 'win32' || this.platform === 'darwin';
  }
  private get pathCi(): boolean {
    return this.platform === 'win32';
  }

  private tooLong(clean: string, abs: string): boolean {
    return tooLongPath(clean) || (this.platform === 'win32' && abs.length > MAX_ABS_WIN);
  }

  /** 바꾸거나 지울 대상: 링크는 링크 자체를 다루고, 막힌 대상(루트·레포·node_modules)은 거절한다 */
  private async target(raw: string): Promise<{ ok: false; reason: CodeFail; detail?: string } | { ok: true; clean: string; real: string; rootReal: string; link: boolean; isDir: boolean }> {
    const r = await this.deps.files.locateEntry(raw);
    if (!r.ok) return fail(r.reason);
    const { clean, real, rootReal, link, isDir } = r.value;
    if (clean === '' || inProtectedZone(clean) || inProtectedZone(toSlash(relative(rootReal, real)))) return fail('protected');
    if (isDir && !link && (await this.isRepoRoot(real))) return fail('protected');
    return { ok: true, clean, real, rootReal, link, isDir };
  }

  private async isRepoRoot(real: string): Promise<boolean> {
    const fold = (p: string): string => (this.pathCi ? p.toLowerCase() : p);
    if ((await this.deps.protectedRoots()).some((root) => fold(root) === fold(real))) return true;
    return lstat(join(real, '.git')).then(
      () => true,
      () => false,
    );
  }

  /** 새로 만들거나 옮겨 갈 폴더 */
  private async folder(raw: string): Promise<{ ok: false; reason: CodeFail; detail?: string } | { ok: true; clean: string; real: string; rootReal: string; names: string[] }> {
    const r = await this.deps.files.locate(raw);
    if (!r.ok) return fail(r.reason);
    const { clean, real, rootReal } = r.value;
    if (inProtectedZone(clean) || inProtectedZone(toSlash(relative(rootReal, real)))) return fail('protected');
    try {
      if (!(await stat(real)).isDirectory()) return fail('not-dir');
      await access(real, constants.W_OK);
      return { ok: true, clean, real, rootReal, names: await readdir(real) };
    } catch (e) {
      return errorFail(e);
    }
  }

  async create(input: CreateRequest): Promise<OpResult> {
    const dto = CreateRequestDto.from(input);
    if (dto === null) return fail('bad-path');
    const { parent, name, kind } = dto.request;
    const dir = await this.folder(parent);
    if (!dir.ok) return dir;
    const checked = checkName(name, { siblings: dir.names, caseInsensitive: this.ci });
    if (!checked.ok) return checked.problem === 'exists' ? fail('exists') : fail('bad-name', checked.text);
    const clean = joinPath(dir.clean, name);
    const abs = join(dir.real, name);
    if (this.tooLong(clean, abs)) return fail('too-long');
    try {
      if (kind === 'dir') await mkdir(abs);
      else await writeFile(abs, '', { flag: 'wx' });
    } catch (e) {
      return errorFail(e);
    }
    return { ok: true, path: clean, kind };
  }

  async rename(input: RenameRequest): Promise<OpResult> {
    const dto = RenameRequestDto.from(input);
    if (dto === null) return fail('bad-path');
    const { path, name } = dto.request;
    const t = await this.target(path);
    if (!t.ok) return t;
    const parentReal = join(t.real, '..');
    let siblings: string[];
    try {
      await access(parentReal, constants.W_OK);
      siblings = await readdir(parentReal);
    } catch (e) {
      return errorFail(e);
    }
    const old = nameOf(t.clean);
    const checked = checkName(name, { siblings, self: old, caseInsensitive: this.ci });
    if (!checked.ok) return checked.problem === 'exists' ? fail('exists') : fail('bad-name', checked.text);
    const next = joinPath(parentOf(t.clean), name);
    const abs = join(parentReal, name);
    if (this.tooLong(next, abs)) return fail('too-long');
    if (this.deps.files.isSecretPath(t.clean) && !this.deps.files.isSecretPath(next)) return fail('secret');
    const caseOnly = name.toLowerCase() === old.toLowerCase();
    if (!(caseOnly && this.ci) && (await lstat(abs).then(() => true, () => false))) return fail('exists');
    try {
      await rename(t.real, abs);
    } catch (e) {
      return errorFail(e);
    }
    return { ok: true, path: next, kind: t.isDir ? 'dir' : 'file' };
  }

  async move(input: MoveRequest): Promise<OpResult> {
    const dto = MoveRequestDto.from(input);
    if (dto === null) return fail('bad-path');
    const { path, destDir } = dto.request;
    const t = await this.target(path);
    if (!t.ok) return t;
    const dest = await this.folder(destDir);
    if (!dest.ok) return dest;
    const kind: NodeKind = t.isDir ? 'dir' : 'file';
    // 링크를 다 푼 실제 경로로도 자기 안으로 들어가는지 본다
    if (t.isDir && !t.link && isInside(t.real, dest.real, this.pathCi)) return fail('into-self');
    const plan = planMove({ path: t.clean, kind, destDir: dest.clean, destNames: dest.names, caseInsensitive: this.ci });
    if (!plan.ok) return plan.reason === 'exists' ? fail('exists') : plan.reason === 'protected' ? fail('protected') : fail(plan.reason);
    const abs = join(dest.real, nameOf(t.clean));
    if (this.tooLong(plan.target, abs)) return fail('too-long');
    if (this.deps.files.isSecretPath(t.clean) && !this.deps.files.isSecretPath(plan.target)) return fail('secret');
    try {
      await access(join(t.real, '..'), constants.W_OK);
      if (await lstat(abs).then(() => true, () => false)) return fail('exists');
      await rename(t.real, abs);
    } catch (e) {
      return errorFail(e);
    }
    return { ok: true, path: plan.target, kind };
  }

  async duplicate(input: DuplicateRequest): Promise<OpResult> {
    const dto = DuplicateRequestDto.from(input);
    if (dto === null) return fail('bad-path');
    const { path, destDir } = dto.request;
    const r = await this.deps.files.locateEntry(path);
    if (!r.ok) return fail(r.reason);
    const src = r.value;
    if (src.clean === '' || inProtectedZone(src.clean)) return fail('protected');
    if (src.link) return fail('link');
    if (!src.isDir && this.deps.files.isSecretPath(src.clean)) return fail('secret');
    const dest = await this.folder(destDir ?? parentOf(src.clean));
    if (!dest.ok) return dest;
    if (src.isDir && isInside(src.real, dest.real, this.pathCi)) return fail('into-self');
    if (src.isDir) {
      const scan = await this.scanForCopy(src.real, src.clean);
      if (!scan.ok) return scan;
    }
    const sameFolder = dest.clean === parentOf(src.clean);
    const name = sameFolder || dest.names.some((n) => (this.ci ? n.toLowerCase() === nameOf(src.clean).toLowerCase() : n === nameOf(src.clean))) ? copyName(nameOf(src.clean), dest.names, this.ci) : nameOf(src.clean);
    const clean = joinPath(dest.clean, name);
    const abs = join(dest.real, name);
    if (this.tooLong(clean, abs)) return fail('too-long');
    try {
      if (src.isDir) {
        await mkdir(abs);
        try {
          await this.copyTree(src.real, abs);
        } catch (e) {
          // 우리가 방금 만든 폴더만 치운다(원본은 건드리지 않는다)
          await rm(abs, { recursive: true, force: true }).catch(() => undefined);
          throw e;
        }
      } else {
        await copyFile(src.real, abs, constants.COPYFILE_EXCL);
      }
    } catch (e) {
      return errorFail(e);
    }
    return { ok: true, path: clean, kind: src.isDir ? 'dir' : 'file' };
  }

  /** 복제해도 되는 폴더인지: 링크·.git·node_modules·비밀 파일이 없고 너무 크지 않아야 한다 */
  private async scanForCopy(real: string, clean: string): Promise<{ ok: true } | { ok: false; reason: CodeFail; detail?: string }> {
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string, rel: string): Promise<{ ok: false; reason: CodeFail } | null> => {
      for (const d of await readdir(dir, { withFileTypes: true })) {
        if (d.isSymbolicLink()) return { ok: false, reason: 'link' };
        const lower = d.name.toLowerCase();
        if (lower === '.git' || lower === 'node_modules') return { ok: false, reason: 'protected' };
        const childRel = `${rel}/${d.name}`;
        if (d.isDirectory()) {
          const inner = await walk(join(dir, d.name), childRel);
          if (inner !== null) return inner;
        } else if (d.isFile()) {
          if (this.deps.files.isSecretPath(childRel)) return { ok: false, reason: 'secret' };
          files++;
          bytes += (await stat(join(dir, d.name))).size;
          if (files > MAX_COPY_FILES || bytes > MAX_COPY_BYTES) return { ok: false, reason: 'too-many' };
        }
      }
      return null;
    };
    try {
      return (await walk(real, clean)) ?? { ok: true };
    } catch (e) {
      return errorFail(e);
    }
  }

  private async copyTree(from: string, to: string): Promise<void> {
    for (const d of await readdir(from, { withFileTypes: true })) {
      if (d.isDirectory()) {
        await mkdir(join(to, d.name));
        await this.copyTree(join(from, d.name), join(to, d.name));
      } else if (d.isFile()) {
        await copyFile(join(from, d.name), join(to, d.name), constants.COPYFILE_EXCL);
      } else {
        throw Object.assign(new Error('link'), { code: 'ELINK' });
      }
    }
  }

  /** 영구 삭제가 아니라 휴지통. 휴지통으로 못 보내면 그대로 두고 까닭을 알린다. */
  async trash(input: PathRequest): Promise<OpResult> {
    const dto = PathRequestDto.from(input);
    if (dto === null) return fail('bad-path');
    const t = await this.target(dto.request.path);
    if (!t.ok) return t;
    try {
      await this.deps.trash(t.real);
    } catch (e) {
      return fail('trash-failed', e instanceof Error ? e.message : undefined);
    }
    return { ok: true, path: t.clean, kind: t.isDir ? 'dir' : 'file' };
  }

  /** 삭제 확인 창에 쓸 정보: 종류, 폴더 안 파일 수, 막힌 대상인지 */
  async inspect(input: PathRequest): Promise<InspectResult> {
    const dto = PathRequestDto.from(input);
    if (dto === null) return fail('bad-path');
    const r = await this.deps.files.locateEntry(dto.request.path);
    if (!r.ok) return fail(r.reason);
    const { clean, real, rootReal, link, isDir } = r.value;
    const locked = clean === '' || inProtectedZone(clean) || inProtectedZone(toSlash(relative(rootReal, real))) || (isDir && !link && (await this.isRepoRoot(real)));
    let files = isDir ? 0 : 1;
    let capped = false;
    if (isDir && !link) {
      const walk = async (dir: string): Promise<void> => {
        for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (files >= MAX_COUNT) {
            capped = true;
            return;
          }
          if (d.isDirectory()) await walk(join(dir, d.name));
          else if (d.isFile()) files++;
        }
      };
      await walk(real);
    }
    return { ok: true, kind: isDir ? 'dir' : 'file', files, capped, link, secret: !isDir && this.deps.files.isSecretPath(clean), locked };
  }

  async reveal(input: PathRequest): Promise<{ ok: boolean }> {
    const dto = PathRequestDto.from(input);
    if (dto === null) return { ok: false };
    const r = await this.deps.files.locateEntry(dto.request.path);
    if (!r.ok) return { ok: false };
    this.deps.reveal(r.value.real);
    return { ok: true };
  }
}
