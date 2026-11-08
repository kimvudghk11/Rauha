import { unknownBecause, type AccountCheck } from '../../shared/account-state.js';
import type { DiagnosticSnapshot } from '../../shared/diagnostics.js';
import type { UpdateView } from '../../shared/update-record.js';
import { findOnPath } from './find-tool.js';

export interface CollectDeps {
  readonly now: () => Date;
  readonly app: DiagnosticSnapshot['app'];
  readonly os: DiagnosticSnapshot['os'];
  readonly runtime: DiagnosticSnapshot['runtime'];
  readonly workFolder: string | null;
  readonly fs: { exists(path: string): boolean; executable(path: string): boolean };
  /** 레포 탭이 찾은 레포 수 */
  readonly repoCount: () => Promise<number | null>;
  readonly claudePath: string | undefined;
  /** `auth status` 읽기(앱 안 로그인과 같은 길) */
  readonly auth: () => Promise<AccountCheck>;
  readonly pathEnv: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly tools: readonly string[];
  readonly usage: () => { readonly readAt: number | null; readonly failure: string | null };
  readonly update: () => UpdateView | null;
  readonly logs: () => readonly string[];
  readonly window: () => DiagnosticSnapshot['window'];
  readonly mac: () => DiagnosticSnapshot['mac'];
  /** 오래 걸릴 수 있는 읽기(레포 세기)를 기다리는 시간 */
  readonly timeoutMs?: number;
}

const WAIT_MS = 8000;

/** 읽다가 던지거나 오래 걸리면 fallback. 진단은 일부를 못 읽어도 나머지는 보여 줘야 한다. */
async function guarded<T>(read: () => Promise<T> | T, fallback: T, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve().then(read), new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** 진단에 필요한 상태를 모은다. 가리기는 하지 않는다(DiagnosticReport가 한다). */
export async function collectSnapshot(deps: CollectDeps): Promise<DiagnosticSnapshot> {
  const wait = deps.timeoutMs ?? WAIT_MS;
  const [repoCount, auth] = await Promise.all([
    guarded(deps.repoCount, null, wait),
    guarded<AccountCheck | null>(deps.auth, { state: unknownBecause({ kind: 'spawn', message: '확인하다 오류가 났어요' }), configDir: null }, wait + 12_000),
  ]);
  const usage = await guarded(async () => deps.usage(), { readAt: null, failure: '읽지 못했어요' }, wait);
  const claude = deps.claudePath;
  const update = await guarded(async () => deps.update(), null, wait);
  const usable = (path: string): boolean => (deps.os.platform === 'win32' ? deps.fs.exists(path) : deps.fs.exists(path) && deps.fs.executable(path));
  return {
    collectedAt: deps.now().toISOString(),
    app: deps.app,
    os: deps.os,
    runtime: deps.runtime,
    workFolder: { path: deps.workFolder, exists: deps.workFolder === null ? null : deps.fs.exists(deps.workFolder) },
    repoCount,
    claude: claude === undefined ? { path: null, exists: false, executable: false } : { path: claude, exists: deps.fs.exists(claude), executable: deps.fs.exists(claude) && deps.fs.executable(claude) },
    auth,
    tools: deps.tools.map((name) => ({ name, path: findOnPath(name, deps.pathEnv, deps.os.platform, usable, deps.env) })),
    usage: { lastReadAt: usage.readAt === null ? null : new Date(usage.readAt).toISOString(), failure: usage.failure },
    update: update === null ? null : { checkedAt: update.checkedAt, latest: update.latest, newer: update.newer, failed: update.failed },
    logs: await guarded(async () => deps.logs(), [] as readonly string[], wait),
    window: await guarded(async () => deps.window(), null, wait),
    mac: await guarded(async () => deps.mac(), null, wait),
  };
}
