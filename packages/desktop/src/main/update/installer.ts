import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isAllowedDownload } from '../../shared/app-update.js';
import { InstallFailure, installPlan, type InstallPlan } from '../../shared/update-install.js';
import { chooseMacTarget, targetNote } from '../../shared/update-target.js';
import type { InstallHooks, InstallRequest, Installer } from './update-service.js';

/** 이보다 작은 파일은 설치 파일이 아니다(오류 페이지 같은 것) */
export const MIN_INSTALLER_BYTES = 20 * 1024 * 1024;

/** 이 시간 동안 데이터가 한 바이트도 안 오면 멈춘 것으로 본다 */
export const STALL_MS = 30_000;

export interface AttemptWriter {
  /** 설치 전에 시도 기록을 남기고, 지난 결과 파일을 지운다 */
  begin(record: { from: string; to: string; target: string | null; at: string; log: string }): Promise<void>;
}

export interface InstallerDeps {
  readonly platform: string;
  /** 지금 실행 중인 앱 파일(process.execPath) */
  readonly execPath: string;
  readonly pid: number;
  /** 내려받은 파일을 둘 임시 폴더 */
  readonly tempDir: string;
  /** 맥: 사용자 홈 폴더 */
  readonly home: string;
  /** 이 폴더(없으면 가장 가까운 윗 폴더)에 쓸 수 있는지 */
  readonly canWrite: (dir: string) => boolean;
  /** 설치 스크립트가 로그와 결과를 남길 파일 */
  readonly logPath: string;
  readonly resultPath: string;
  readonly attempts: AttemptWriter;
  readonly now: () => Date;
  /** 데이터가 안 오면 멈춘 것으로 볼 시간(기본 STALL_MS) */
  readonly stallMs?: number;
  readonly fetch: (url: string, signal: AbortSignal) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }>;
  readonly spawn?: (plan: InstallPlan) => void;
  /** 설치 프로그램이 시작된 뒤 앱을 끈다 */
  readonly quit: () => void;
}

function detached(plan: InstallPlan): void {
  const child = nodeSpawn(plan.command, [...plan.args], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: plan.windowsVerbatimArguments });
  // 실행 파일이 없으면 error 이벤트가 오는데, 처리하지 않으면 앱이 죽는다
  child.on('error', () => undefined);
  child.unref();
}

/** 맥은 실행 파일(Rauha.app/Contents/MacOS/Rauha)에서 .app 폴더를 찾는다 */
export function macBundleOf(execPath: string): string {
  return posix.resolve(execPath, '..', '..', '..');
}

/** 검증된 설치 파일 주소를 받아 임시 폴더에 저장하고, 설치 계획대로 따로 띄운 뒤 앱을 끈다. 실패하면 InstallFailure를 던진다. */
export function createInstaller(deps: InstallerDeps): Installer {
  return {
    async run(request: InstallRequest, hooks: InstallHooks) {
      const { url, sha256 } = request;
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new InstallFailure('missing-checksum');
      if (!isAllowedDownload(url)) throw new InstallFailure('bad-address');
      const dir = join(deps.tempDir, 'rauha-update');
      const file = join(dir, basename(new URL(url).pathname));

      // 취소(사용자)와 멈춤(30초 무응답)을 한 신호로 받아 fetch와 저장을 함께 끊는다
      const inner = new AbortController();
      let stalled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poke = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          stalled = true;
          inner.abort();
        }, deps.stallMs ?? STALL_MS);
      };
      const onCancel = (): void => inner.abort();
      hooks.signal.addEventListener('abort', onCancel);
      if (hooks.signal.aborted) inner.abort();
      const why = (e: unknown, fallback: InstallFailure): InstallFailure => {
        if (e instanceof InstallFailure) return e;
        if (hooks.signal.aborted) return new InstallFailure('cancelled');
        if (stalled) return new InstallFailure('stalled');
        return fallback;
      };

      let size: number;
      try {
        try {
          await mkdir(dir, { recursive: true });
        } catch (e) {
          throw new InstallFailure('disk', String(e));
        }
        poke();
        let res;
        try {
          res = await deps.fetch(url, inner.signal);
        } catch (e) {
          throw why(e, new InstallFailure('network'));
        }
        if (!res.ok || res.body === null) throw new InstallFailure('http', String(res.status));
        const total = Number(res.headers.get('content-length') ?? '0');
        let received = 0;
        const hash = createHash('sha256');
        const source = Readable.fromWeb(res.body as never, { signal: inner.signal } as never);
        source.on('data', (chunk: Buffer) => {
          poke();
          received += chunk.length;
          hash.update(chunk);
          hooks.onProgress({ percent: total > 0 ? Math.min(100, (received / total) * 100) : null, received, total: total > 0 ? total : null });
        });
        try {
          await pipeline(source, createWriteStream(file), { signal: inner.signal });
        } catch (e) {
          const code = (e as { code?: string }).code;
          throw why(e, code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' ? new InstallFailure('disk', code) : new InstallFailure('network'));
        }
        clearTimeout(timer);
        hooks.onStage('verifying');
        size = (await stat(file)).size;
        if (size < MIN_INSTALLER_BYTES || (total > 0 && size !== total)) throw new InstallFailure('incomplete');
        if (hash.digest('hex') !== sha256) throw new InstallFailure('checksum');
      } catch (e) {
        await rm(file, { force: true });
        throw e instanceof InstallFailure ? e : new InstallFailure('network');
      } finally {
        clearTimeout(timer);
        hooks.signal.removeEventListener('abort', onCancel);
      }

      hooks.onStage('preparing');
      let appBundle: string | undefined;
      let target: string | null = null;
      let note: string | null = null;
      if (deps.platform === 'darwin') {
        const chosen = chooseMacTarget({ bundle: macBundleOf(deps.execPath), home: deps.home, canWrite: deps.canWrite });
        if (chosen === null) {
          await rm(file, { force: true });
          throw new InstallFailure('target-unwritable');
        }
        appBundle = chosen.path;
        target = chosen.path;
        note = targetNote(chosen);
      }
      const plan = installPlan({ platform: deps.platform, installerPath: file, appExe: deps.execPath, ...(appBundle === undefined ? {} : { appBundle }), pid: deps.pid, logPath: deps.logPath, resultPath: deps.resultPath });
      if (plan === null) throw new InstallFailure('plan');
      try {
        await deps.attempts.begin({ from: request.from, to: request.to, target, at: deps.now().toISOString(), log: deps.logPath });
        hooks.onInstalling({ target, note });
        (deps.spawn ?? detached)(plan);
      } catch {
        throw new InstallFailure('spawn');
      }
      setTimeout(deps.quit, 400);
    },
  };
}
