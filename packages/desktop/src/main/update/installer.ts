import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isAllowedDownload } from '../../shared/app-update.js';
import { installPlan, type InstallPlan } from '../../shared/update-install.js';
import type { Installer } from './update-service.js';

/** 이보다 작은 파일은 설치 파일이 아니다(오류 페이지 같은 것) */
export const MIN_INSTALLER_BYTES = 20 * 1024 * 1024;

export interface InstallerDeps {
  readonly platform: string;
  /** 지금 실행 중인 앱 파일(process.execPath) */
  readonly execPath: string;
  readonly pid: number;
  /** 내려받은 파일을 둘 임시 폴더 */
  readonly tempDir: string;
  readonly fetch: (url: string) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }>;
  readonly spawn?: (plan: InstallPlan) => void;
  /** 설치 프로그램이 시작된 뒤 앱을 끈다 */
  readonly quit: () => void;
}

function detached(plan: InstallPlan): void {
  const child = nodeSpawn(plan.command, [...plan.args], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: plan.windowsVerbatimArguments });
  child.unref();
}

/** 맥은 실행 파일(Rauha.app/Contents/MacOS/Rauha)에서 .app 폴더를 찾는다 */
export function macBundleOf(execPath: string): string {
  return resolve(execPath, '..', '..', '..');
}

/** 검증된 설치 파일 주소를 받아 임시 폴더에 저장하고, 설치 계획대로 따로 띄운 뒤 앱을 끈다. 실패하면 던진다. */
export function createInstaller(deps: InstallerDeps): Installer {
  return {
    async run(url, sha256, onProgress, onInstalling) {
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('missing checksum');
      if (!isAllowedDownload(url)) throw new Error('not an allowed download address');
      const dir = join(deps.tempDir, 'rauha-update');
      await mkdir(dir, { recursive: true });
      const file = join(dir, basename(new URL(url).pathname));
      const res = await deps.fetch(url);
      if (!res.ok || res.body === null) throw new Error(`download failed: ${res.status}`);
      const total = Number(res.headers.get('content-length') ?? '0');
      let received = 0;
      const hash = createHash('sha256');
      const source = Readable.fromWeb(res.body as never);
      source.on('data', (chunk: Buffer) => {
        received += chunk.length;
        hash.update(chunk);
        onProgress(total > 0 ? Math.min(100, (received / total) * 100) : null);
      });
      try {
        await pipeline(source, createWriteStream(file));
        const size = (await stat(file)).size;
        if (size < MIN_INSTALLER_BYTES || (total > 0 && size !== total)) throw new Error('downloaded file is incomplete');
        if (hash.digest('hex') !== sha256) throw new Error('checksum mismatch');
      } catch (e) {
        await rm(file, { force: true });
        throw e;
      }
      const plan = installPlan({ platform: deps.platform, installerPath: file, appExe: deps.execPath, appBundle: macBundleOf(deps.execPath), pid: deps.pid });
      if (plan === null) throw new Error('cannot plan install');
      onInstalling();
      (deps.spawn ?? detached)(plan);
      setTimeout(deps.quit, 400);
    },
  };
}
