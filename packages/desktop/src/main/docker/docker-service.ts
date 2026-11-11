import {
  DockerRequest,
  classifyFailure,
  inputFailure,
  type ComposeFileView,
  type ComposeResult,
  type ContainerDetail,
  type ContainerList,
  type DockerFailure,
  type DockerLogEvent,
  type DockerResult,
  type DockerStatus,
  type ExecResult,
  type ImageList,
  type NetworkList,
  type VolumeList,
} from '../../shared/docker-api.js';
import { DockerInputError } from '../../shared/docker-names.js';
import { parseInspect } from '../../shared/docker-inspect.js';
import { parseComposeProjects, parseComposeServices, parseContainers, parseImages, parseNetworks, parseVolumes, type ComposeProjectView } from '../../shared/docker-parse.js';
import type { RunDocker, RunOutcome, StreamDocker, StreamHandle } from './docker-run.js';

export interface DockerServiceDeps {
  readonly run: RunDocker;
  readonly stream: StreamDocker;
  /** 지금 작업 폴더(compose 파일을 찾고 compose 명령을 돌리는 곳). 없으면 null */
  readonly workDir: () => string | null;
  readonly findCompose: (root: string) => readonly ComposeFileView[];
  /** compose 파일이 작업 폴더 안의 진짜 파일인지(없으면 확인하지 않는다: 시험용) */
  readonly resolveCompose?: (root: string, relative: string) => string | null;
  readonly newId: () => string;
  readonly emit: (event: DockerLogEvent) => void;
}

const FORMAT = ['--format', '{{json .}}'] as const;
const SLOW_MS = 60_000;
const PULL_MS = 10 * 60_000;
const COMPOSE_UP_MS = 5 * 60_000;
const EXEC_MS = 30_000;
const EXEC_MAX_BYTES = 1024 * 1024;
const LOG_MAX_BYTES = 8 * 1024 * 1024;
/** 동시에 따라가는 로그 흐름(= docker 프로세스) 상한 */
const MAX_STREAMS = 8;

const fail = (failure: DockerFailure): { readonly ok: false; readonly failure: DockerFailure } => ({ ok: false, failure });
const ok = <T>(data: T): DockerResult<T> => ({ ok: true, data });
const failureOf = (o: RunOutcome): DockerFailure => classifyFailure({ spawnCode: o.spawnCode, timedOut: o.timedOut, cancelled: o.cancelled, tooLarge: o.tooLarge, stderr: o.stderr });
const succeeded = (o: RunOutcome): boolean => o.code === 0 && o.spawnCode === undefined && !o.timedOut && !o.cancelled && !o.tooLarge;

/**
 * Docker 서비스: 요청 검사(DTO) → docker 를 고정 인자로 실행 → 출력 파싱 → 돌려주기만 한다.
 * 도메인 규칙은 shared/docker-*.ts 가 가지고 있고 여기에는 없다. 던지지 않고 DockerResult 로 돌려준다.
 */
export class DockerService {
  private readonly streams = new Map<string, StreamHandle>();

  constructor(private readonly deps: DockerServiceDeps) {}

  private async guarded<T>(task: () => Promise<DockerResult<T>>): Promise<DockerResult<T>> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof DockerInputError) return fail(inputFailure(error));
      return fail({ kind: 'failed', title: 'Docker command failed', message: 'Something unexpected went wrong.', help: null, link: null });
    }
  }

  private async list<T>(args: readonly string[], parse: (text: string) => T): Promise<DockerResult<T>> {
    const o = await this.deps.run(args);
    return succeeded(o) ? ok(parse(o.stdout)) : fail(failureOf(o));
  }

  private async act(args: readonly string[], timeoutMs = SLOW_MS): Promise<DockerResult<null>> {
    const o = await this.deps.run(args, { timeoutMs });
    return succeeded(o) ? ok(null) : fail(failureOf(o));
  }

  /** 엔진 상태: CLI 가 있는지, 엔진에 닿는지, 버전 */
  async status(): Promise<DockerStatus> {
    const o = await this.deps.run(['version', ...FORMAT], { timeoutMs: 8000 });
    let client: string | null = null;
    let server: string | null = null;
    try {
      const v = JSON.parse(o.stdout) as { Client?: { Version?: unknown }; Server?: { Version?: unknown } | null };
      if (typeof v.Client?.Version === 'string') client = v.Client.Version;
      if (typeof v.Server?.Version === 'string') server = v.Server.Version;
    } catch {
      /* 엔진이 꺼져 있으면 JSON 이 없을 수 있다 */
    }
    if (succeeded(o) && server !== null) return { ready: true, clientVersion: client, serverVersion: server, failure: null };
    return { ready: false, clientVersion: client, serverVersion: server, failure: succeeded(o) ? classifyFailure({ stderr: 'cannot connect to the docker daemon' }) : failureOf(o) };
  }

  containers(): Promise<DockerResult<ContainerList>> {
    return this.list(['ps', '-a', ...FORMAT], (t) => {
      const p = parseContainers(t);
      return { containers: p.items.map((c) => c.toView()), skipped: p.skipped };
    });
  }

  async images(): Promise<DockerResult<ImageList>> {
    const [imgs, ps] = await Promise.all([this.deps.run(['images', ...FORMAT]), this.deps.run(['ps', '-a', ...FORMAT])]);
    if (!succeeded(imgs)) return fail(failureOf(imgs));
    const used = succeeded(ps) ? parseContainers(ps.stdout).items.map((c) => c.toView()) : [];
    const p = parseImages(imgs.stdout);
    return ok({ images: p.items.map((i) => i.toView(used)), skipped: p.skipped });
  }

  volumes(): Promise<DockerResult<VolumeList>> {
    return this.list(['volume', 'ls', ...FORMAT], (t) => {
      const p = parseVolumes(t);
      return { volumes: p.items, skipped: p.skipped };
    });
  }

  networks(): Promise<DockerResult<NetworkList>> {
    return this.list(['network', 'ls', ...FORMAT], (t) => {
      const p = parseNetworks(t);
      return { networks: p.items, skipped: p.skipped };
    });
  }

  start(id: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => this.act(['start', DockerRequest.target(id).value]));
  }
  stop(id: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => this.act(['stop', DockerRequest.target(id).value]));
  }
  restart(id: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => this.act(['restart', DockerRequest.target(id).value]));
  }
  remove(raw: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => {
      const r = DockerRequest.remove(raw);
      return this.act(['rm', ...(r.force ? ['--force'] : []), r.ref.value]);
    });
  }
  imageRemove(raw: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => this.act(['rmi', DockerRequest.imageRemove(raw).value]));
  }
  volumeRemove(raw: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => this.act(['volume', 'rm', DockerRequest.volumeRemove(raw).value]));
  }
  networkRemove(raw: unknown): Promise<DockerResult<null>> {
    return this.guarded(() => this.act(['network', 'rm', DockerRequest.networkRemove(raw).value]));
  }
  imagePull(raw: unknown): Promise<DockerResult<{ readonly output: string }>> {
    return this.guarded(async () => {
      const o = await this.deps.run(['pull', DockerRequest.imagePull(raw).value], { timeoutMs: PULL_MS });
      return succeeded(o) ? ok({ output: o.stdout.trim() }) : fail(failureOf(o));
    });
  }

  inspect(id: unknown): Promise<DockerResult<ContainerDetail>> {
    return this.guarded(async () => {
      const o = await this.deps.run(['inspect', '--type', 'container', DockerRequest.target(id).value]);
      if (!succeeded(o)) return fail(failureOf(o));
      const detail = parseInspect(o.stdout);
      return detail === null ? fail({ kind: 'failed', title: 'Docker command failed', message: 'Could not read the container details.', help: null, link: null }) : ok(detail);
    });
  }

  /** 로그를 한 줄씩이 아니라 조각으로 흘려 보낸다. 마지막 N줄(tail)부터, follow 면 계속 따라간다. */
  logs(raw: unknown): Promise<DockerResult<{ readonly streamId: string }>> {
    return this.guarded(async () => {
      const r = DockerRequest.logs(raw);
      if (this.streams.size >= MAX_STREAMS) return fail({ kind: 'failed', title: 'Too many log streams', message: `At most ${MAX_STREAMS} logs can be open at once. Close one first.`, help: null, link: null });
      const streamId = this.deps.newId();
      const handle = this.deps.stream(
        ['logs', '--tail', String(r.tail.value), ...(r.follow ? ['--follow'] : []), r.ref.value],
        {
          data: (data) => this.deps.emit({ type: 'out', streamId, data }),
          end: (end) => {
            this.streams.delete(streamId);
            const bad = end.code !== 0 && end.code !== null && end.note === null && end.stderr.trim() !== '';
            const note = end.note ?? (end.spawnCode !== undefined || bad ? classifyFailure({ spawnCode: end.spawnCode, stderr: end.stderr }).message : null);
            this.deps.emit({ type: 'end', streamId, code: end.code, note });
          },
        },
        { maxBytes: LOG_MAX_BYTES },
      );
      this.streams.set(streamId, handle);
      return ok({ streamId });
    });
  }

  logsStop(streamId: unknown): void {
    if (typeof streamId !== 'string') return;
    this.streams.get(streamId)?.stop();
    this.streams.delete(streamId);
  }

  /** 앱을 닫을 때 남은 로그 흐름을 모두 멈춘다 */
  stopAll(): void {
    for (const h of this.streams.values()) h.stop();
    this.streams.clear();
  }

  composeFind(): Promise<DockerResult<readonly ComposeFileView[]>> {
    const root = this.deps.workDir();
    return Promise.resolve(ok(root === null ? [] : this.deps.findCompose(root)));
  }

  composeList(): Promise<DockerResult<readonly ComposeProjectView[]>> {
    return this.list(['compose', 'ls', '--all', '--format', 'json'], (t) => parseComposeProjects(t).items);
  }

  compose(raw: unknown): Promise<DockerResult<ComposeResult>> {
    return this.guarded(async () => {
      const r = DockerRequest.compose(raw);
      const root = this.deps.workDir();
      if (root === null) return fail({ kind: 'bad-input', title: 'No work folder', message: 'Pick a work folder first, so Rauha knows where the compose file is.', help: null, link: null });
      if (this.deps.resolveCompose !== undefined && this.deps.resolveCompose(root, r.file.path) === null) return fail({ kind: 'bad-input', title: 'That value cannot be used', message: `That is not a compose file inside the work folder: ${r.file.path.slice(0, 80)}`, help: null, link: null });
      const base = ['compose', '-f', r.file.path];
      const tail = ['--no-color', '--tail', String(r.tail.value)];
      const args =
        r.op === 'ps' ? [...base, 'ps', '--all', '--format', 'json']
        : r.op === 'up' ? [...base, 'up', '-d']
        : r.op === 'down' ? [...base, 'down', ...(r.removeVolumes ? ['--volumes'] : [])]
        : [...base, 'logs', ...tail];
      const o = await this.deps.run(args, { cwd: root, timeoutMs: r.op === 'up' ? COMPOSE_UP_MS : SLOW_MS });
      if (!succeeded(o)) return fail(failureOf(o));
      const output = r.op === 'ps' ? '' : `${o.stdout}${o.stderr}`.trim();
      return ok({ output, services: r.op === 'ps' ? parseComposeServices(o.stdout).items : [] });
    });
  }

  exec(raw: unknown): Promise<DockerResult<ExecResult>> {
    return this.guarded(async () => {
      const r = DockerRequest.exec(raw);
      const o = await this.deps.run(['exec', r.ref.value, 'sh', '-c', r.line.value], { timeoutMs: EXEC_MS, maxBytes: EXEC_MAX_BYTES });
      const f = failureOf(o);
      if (o.code === null || o.code === 125 || f.kind === 'engine-off' || f.kind === 'permission') return fail(f);
      return ok({ output: `${o.stdout}${o.stderr}`, exitCode: o.code });
    });
  }
}
