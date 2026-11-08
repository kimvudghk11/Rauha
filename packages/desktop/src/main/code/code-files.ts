import { constants } from 'node:fs';
import { access, lstat, open, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { CodeFail, FilesResult, ReadResult, SearchResult, StatResult, TreeEntry, TreeResult, WriteResult } from '../../shared/code-api.js';
import { decodeFile, encodeFile, MAX_OPEN_BYTES } from '../../shared/code-text.js';
import { applicableConfigs, editorConfigFor, parseEditorConfig, type EditorConfigFile } from '../../shared/editor-config.js';
import { SKIPPED_FOLDERS } from '../../shared/folder-kind.js';
import { cleanRelative, isInside } from './code-path.js';
import { searchWorkspace } from './code-search.js';
import { walkFiles } from './code-walk.js';
import { WriteRequestDto } from './write-request.js';

/** 폴더 하나에서 보여 줄 항목 수 상한(넘치면 잘렸다고 알린다) */
export const MAX_TREE_ENTRIES = 2000;
/** .editorconfig 한 개의 크기 상한 */
const MAX_CONFIG_BYTES = 64 * 1024;
/** 한 번에 상태를 묻는 파일 수 상한 */
const MAX_STAT_PATHS = 200;

export interface CodeFilesDeps {
  /** 지금 작업 폴더(없으면 null) */
  readonly root: () => string | null;
  /** 작업 폴더 기준 경로가 비밀 파일인지(core의 SecretPolicy) */
  readonly isSecret: (relPath: string) => boolean;
  readonly platform?: NodeJS.Platform;
}

export interface Resolved {
  readonly rootReal: string;
  /** 정리된 상대 경로(슬래시) */
  readonly clean: string;
  /** 링크를 다 푼 실제 경로 */
  readonly real: string;
}

export type EntryResolution = { readonly ok: true; readonly value: Resolved & { readonly link: boolean; readonly isDir: boolean; readonly isFile: boolean; /** 작업 폴더 기준 실제 경로(링크·짧은 이름을 다 푼 이름). 보호·비밀 판정은 이것도 함께 본다. */ readonly realRel: string } } | { readonly ok: false; readonly reason: CodeFail };

export type Resolution = { readonly ok: true; readonly value: Resolved } | { readonly ok: false; readonly reason: CodeFail };

const versionOf = (s: { mtimeMs: number; size: number }): string => `${Math.round(s.mtimeMs)}:${s.size}`;
const isMissing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR';
const toSlash = (p: string): string => p.split(sep).join('/');

/**
 * 코드 탭의 파일 읽기·쓰기. main에서만 돈다. 지키는 것:
 * - 작업 폴더 밖(`..`·절대 경로·바로가기로 새는 길)은 막는다. 판정은 링크를 다 푼 실제 경로로 한다.
 * - 비밀 파일은 읽지도 쓰지도 않는다(요청한 이름과 바로가기가 가리키는 실제 이름 둘 다 본다).
 * - `.git` 안은 다루지 않는다.
 * - 1MB 넘는 파일, 바이너리, UTF-8이 아닌 글은 열지 않는다.
 * - 저장은 같은 폴더의 임시 파일에 쓰고 이름을 바꾼다(중간에 끊겨도 원본이 남는다). 디스크가 읽을 때와 달라졌으면 충돌로 돌려준다.
 */
export class CodeFiles {
  constructor(private readonly deps: CodeFilesDeps) {}

  private get caseInsensitive(): boolean {
    return (this.deps.platform ?? process.platform) === 'win32';
  }

  private async rootReal(): Promise<string | null> {
    const root = this.deps.root();
    if (root === null || root === '') return null;
    try {
      return await realpath(root);
    } catch {
      return null;
    }
  }

  /** 상대 경로 → 실제 경로. 안전하지 않으면 까닭을 돌려준다. */
  private async resolve(rawPath: unknown, allowMissing = false): Promise<Resolution> {
    const clean = cleanRelative(rawPath);
    if (clean === null) return { ok: false, reason: 'bad-path' };
    const rootReal = await this.rootReal();
    if (rootReal === null) return { ok: false, reason: 'no-folder' };
    const abs = join(rootReal, ...clean.split('/').filter((p) => p !== ''));
    let real: string;
    try {
      real = await realpath(abs);
    } catch (e) {
      if (!isMissing(e)) return { ok: false, reason: 'error' };
      if (!allowMissing) return { ok: false, reason: 'missing' };
      // 지워진 파일을 다시 만드는 저장: 폴더가 안전하고 그 이름이 바로가기가 아닐 때만
      let parent: string;
      try {
        parent = await realpath(dirname(abs));
      } catch {
        return { ok: false, reason: 'missing' };
      }
      real = join(parent, basename(abs));
      try {
        await lstat(real);
        return { ok: false, reason: 'outside' };
      } catch {
        /* 정말 없다 */
      }
    }
    if (!isInside(rootReal, real, this.caseInsensitive)) return { ok: false, reason: 'outside' };
    const realRel = toSlash(relative(rootReal, real));
    if (cleanRelative(realRel) === null) return { ok: false, reason: 'bad-path' };
    if (clean !== '' && (this.deps.isSecret(clean) || this.deps.isSecret(realRel))) return { ok: false, reason: 'secret' };
    return { ok: true, value: { rootReal, clean, real } };
  }

  /**
   * 파일 조작용: 마지막 이름은 링크여도 따라가지 않고(링크 자체를 다룬다) 그 폴더만 실제 경로로 푼다.
   * 읽기와 달리 비밀 파일도 통과시킨다(이름 바꾸기·삭제는 허용, 내용은 읽지 않는다). 판단은 부르는 쪽이 한다.
   */
  async locateEntry(rawPath: unknown): Promise<EntryResolution> {
    const clean = cleanRelative(rawPath);
    if (clean === null) return { ok: false, reason: 'bad-path' };
    const rootReal = await this.rootReal();
    if (rootReal === null) return { ok: false, reason: 'no-folder' };
    if (clean === '') return { ok: true, value: { rootReal, clean, real: rootReal, link: false, isDir: true, isFile: false, realRel: '' } };
    const parts = clean.split('/');
    let parentReal: string;
    try {
      parentReal = await realpath(join(rootReal, ...parts.slice(0, -1)));
    } catch (e) {
      return { ok: false, reason: isMissing(e) ? 'missing' : 'error' };
    }
    if (!isInside(rootReal, parentReal, this.caseInsensitive)) return { ok: false, reason: 'outside' };
    let real = join(parentReal, parts[parts.length - 1]!);
    let info;
    try {
      info = await lstat(real);
    } catch (e) {
      return { ok: false, reason: isMissing(e) ? 'missing' : 'error' };
    }
    let name = parts[parts.length - 1]!;
    if (!info.isSymbolicLink()) {
      // 마지막 이름도 실제 이름으로 바로잡는다: Windows는 짧은 이름(GIT~1)·대체 데이터 스트림(.git::$INDEX_ALLOCATION)·대소문자 다른 이름으로
      // 같은 파일을 열 수 있어서, 요청한 글자만으로는 .git·node_modules·비밀 파일을 알아볼 수 없다.
      try {
        real = await realpath(real);
      } catch (e) {
        return { ok: false, reason: isMissing(e) ? 'missing' : 'error' };
      }
      const sameDir = dirname(real) === parentReal || (this.caseInsensitive && dirname(real).toLowerCase() === parentReal.toLowerCase());
      if (!sameDir || !isInside(rootReal, real, this.caseInsensitive)) return { ok: false, reason: 'outside' };
      name = basename(real);
    }
    const realRel = toSlash(relative(rootReal, real));
    if (cleanRelative(realRel) === null) return { ok: false, reason: 'bad-path' };
    return { ok: true, value: { rootReal, clean: [...parts.slice(0, -1), name].join('/'), real, link: info.isSymbolicLink(), isDir: info.isDirectory(), isFile: info.isFile(), realRel } };
  }

  /** 작업 폴더의 실제 경로(없으면 null) */
  rootRealPath(): Promise<string | null> {
    return this.rootReal();
  }

  /** 상대 경로를 안전한 실제 경로로 푼다(코드 탭 안의 다른 기능이 같은 검사를 거치게) */
  locate(rawPath: unknown): Promise<Resolution> {
    return this.resolve(rawPath);
  }

  isSecretPath(relPath: string): boolean {
    return this.deps.isSecret(relPath);
  }

  /** 빠른 열기용 파일 목록 */
  async listFiles(): Promise<FilesResult> {
    const rootReal = await this.rootReal();
    if (rootReal === null) return { ok: false, reason: 'no-folder' };
    const { paths, truncated } = await walkFiles(rootReal, { isSecret: this.deps.isSecret });
    return { ok: true, paths, truncated };
  }

  /** 작업 폴더 전체 글 찾기 */
  async searchAll(input: unknown): Promise<SearchResult> {
    const rootReal = await this.rootReal();
    if (rootReal === null) return { ok: false, reason: 'no-folder' };
    return searchWorkspace(rootReal, input, this.deps.isSecret);
  }

  async tree(rawPath: unknown): Promise<TreeResult> {
    const r = await this.resolve(rawPath);
    if (!r.ok) return r;
    const { rootReal, clean, real } = r.value;
    let dirents;
    try {
      if (!(await stat(real)).isDirectory()) return { ok: false, reason: 'not-dir' };
      dirents = await readdir(real, { withFileTypes: true });
    } catch {
      return { ok: false, reason: 'error' };
    }
    const entries: TreeEntry[] = [];
    for (const d of dirents) {
      if (d.name === '.git') continue;
      const path = clean === '' ? d.name : `${clean}/${d.name}`;
      let kind: 'dir' | 'file' = d.isDirectory() ? 'dir' : 'file';
      let blocked = false;
      const link = d.isSymbolicLink();
      if (link) {
        try {
          const target = await realpath(join(real, d.name));
          blocked = !isInside(rootReal, target, this.caseInsensitive);
          kind = (await stat(target)).isDirectory() ? 'dir' : 'file';
        } catch {
          blocked = true;
        }
      } else if (!d.isFile() && !d.isDirectory()) continue;
      const locked = kind === 'file' && this.deps.isSecret(path);
      entries.push({ name: d.name, path, kind, link, heavy: kind === 'dir' && SKIPPED_FOLDERS.has(d.name) && d.name !== '.vscode', locked, blocked });
    }
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'dir' ? -1 : 1));
    const truncated = entries.length > MAX_TREE_ENTRIES;
    return { ok: true, entries: truncated ? entries.slice(0, MAX_TREE_ENTRIES) : entries, truncated };
  }

  async read(rawPath: unknown): Promise<ReadResult> {
    const r = await this.resolve(rawPath);
    if (!r.ok) return r;
    const { rootReal, clean, real } = r.value;
    if (clean === '') return { ok: false, reason: 'not-file' };
    let handle;
    try {
      handle = await open(real, 'r');
    } catch {
      return { ok: false, reason: 'error' };
    }
    try {
      const before = await handle.stat();
      if (!before.isFile()) return { ok: false, reason: 'not-file' };
      if (before.size > MAX_OPEN_BYTES) return { ok: false, reason: 'too-big' };
      const bytes = await handle.readFile();
      if (bytes.length > MAX_OPEN_BYTES) return { ok: false, reason: 'too-big' };
      const decoded = decodeFile(bytes);
      if (!decoded.ok) return decoded;
      const readOnly = await access(real, constants.W_OK).then(
        () => false,
        () => true,
      );
      const after = await handle.stat();
      return {
        ok: true,
        path: clean,
        text: decoded.text,
        version: versionOf(after),
        eol: decoded.format.eol,
        bom: decoded.format.bom,
        mixedEol: decoded.format.mixedEol,
        editorConfig: await this.configFor(rootReal, clean),
        readOnly,
      };
    } catch {
      return { ok: false, reason: 'error' };
    } finally {
      await handle.close();
    }
  }

  async write(input: unknown): Promise<WriteResult> {
    const dto = WriteRequestDto.from(input);
    if (dto === null) return { ok: false, reason: 'bad-path' };
    const req = dto.request;
    const r = await this.resolve(req.path, true);
    if (!r.ok) return r;
    const { clean, real } = r.value;
    if (clean === '') return { ok: false, reason: 'not-file' };
    let mode: number | undefined;
    try {
      const current = await stat(real);
      if (!current.isFile()) return { ok: false, reason: 'not-file' };
      if (!req.overwrite && versionOf(current) !== req.baseVersion) return { ok: false, reason: 'conflict' };
      mode = current.mode & 0o777;
    } catch (e) {
      if (!isMissing(e)) return { ok: false, reason: 'error' };
      if (!req.overwrite) return { ok: false, reason: 'deleted' };
    }
    const bytes = encodeFile(req.text, req);
    if (bytes.length > MAX_OPEN_BYTES) return { ok: false, reason: 'too-big' };
    const tmp = join(dirname(real), `.${basename(real)}.rauha-${process.pid}-${Date.now()}.tmp`);
    try {
      await writeFile(tmp, bytes, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
      try {
        await rename(tmp, real);
      } catch (e) {
        // Windows: 다른 프로그램이 열고 있으면 이름 바꾸기가 막힌다. 그 자리에서 덮어쓴다.
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw e;
        await writeFile(real, bytes);
        await unlink(tmp).catch(() => undefined);
      }
      return { ok: true, version: versionOf(await stat(real)) };
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return { ok: false, reason: 'read-only' };
      return { ok: false, reason: 'error', detail: code ?? (e instanceof Error ? e.message : undefined) };
    }
  }

  /** 열어 둔 파일들의 지금 version. 없어졌거나 못 읽으면 null. */
  async stat(rawPaths: unknown): Promise<StatResult> {
    const out: Record<string, string | null> = {};
    if (!Array.isArray(rawPaths)) return out;
    for (const p of rawPaths.slice(0, MAX_STAT_PATHS)) {
      if (typeof p !== 'string') continue;
      const r = await this.resolve(p);
      if (!r.ok) {
        out[p] = null;
        continue;
      }
      try {
        out[p] = versionOf(await stat(r.value.real));
      } catch {
        out[p] = null;
      }
    }
    return out;
  }

  /** 파일이 있는 폴더부터 작업 폴더까지 .editorconfig를 모아 이 파일에 맞는 값을 뽑는다. */
  private async configFor(rootReal: string, clean: string): Promise<Record<string, string>> {
    const nearestFirst: EditorConfigFile[] = [];
    const parts = clean.split('/').slice(0, -1);
    for (let depth = parts.length; depth >= 0; depth--) {
      const dir = parts.slice(0, depth).join('/');
      try {
        const file = join(rootReal, ...parts.slice(0, depth), '.editorconfig');
        const s = await stat(file);
        if (!s.isFile() || s.size > MAX_CONFIG_BYTES) continue;
        const h = await open(file, 'r');
        try {
          nearestFirst.push({ dir, parsed: parseEditorConfig(new TextDecoder().decode(await h.readFile())) });
        } finally {
          await h.close();
        }
      } catch {
        /* 없는 폴더는 그냥 건너뛴다 */
      }
    }
    return { ...editorConfigFor(applicableConfigs(nearestFirst), clean) };
  }
}
