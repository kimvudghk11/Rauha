import { ContainerRef, DockerInputError, ExecLine, ImageRef, NetworkName, TailLines, VolumeName } from './docker-names.js';
import type { ComposeProjectView, ComposeServiceView, ContainerView, ImageView, NetworkView, VolumeView } from './docker-parse.js';

/** Docker 탭 IPC 채널. 화면은 좁은 채널로만 main 과 이야기하고, main 은 docker CLI 를 고정 인자로만 부른다. */
export const DOCKER_IPC = {
  status: 'docker:status',
  containers: 'docker:ps',
  images: 'docker:images',
  volumes: 'docker:volumes',
  networks: 'docker:networks',
  start: 'docker:start',
  stop: 'docker:stop',
  restart: 'docker:restart',
  remove: 'docker:remove',
  inspect: 'docker:inspect',
  logs: 'docker:logs',
  logsStop: 'docker:logs-stop',
  logEvent: 'docker:log-event',
  composeFind: 'docker:compose-find',
  composeList: 'docker:compose-ls',
  compose: 'docker:compose',
  exec: 'docker:exec',
  imageRemove: 'docker:image-rm',
  imagePull: 'docker:image-pull',
  volumeRemove: 'docker:volume-rm',
  networkRemove: 'docker:network-rm',
} as const;

export const DOCKER_INSTALL_URL = 'https://docs.docker.com/get-docker/';

/** 정직한 한계: 화면 위쪽에 늘 보이는 안내 */
export const DOCKER_LIMIT_NOTE = 'Rauha only shows and controls what the docker CLI reports. The engine (Docker Desktop, Colima, OrbStack or Podman) is not part of Rauha and must be installed and running.';
/** exec 칸 안내: 진짜 PTY 가 아직 없다 */
export const DOCKER_EXEC_NOTE = 'Runs one command inside the container with sh -c. This is not an interactive shell (no PTY), so vim, top or password prompts do not work.';

export type DockerFailureKind = 'no-cli' | 'engine-off' | 'permission' | 'timeout' | 'bad-input' | 'confirm' | 'too-large' | 'cancelled' | 'failed';

/** 화면에 그대로 보여도 되는 실패. title 은 짧은 제목, message 는 이유, help 는 해결 방법(없을 수 있다). */
export interface DockerFailure {
  readonly kind: DockerFailureKind;
  readonly title: string;
  readonly message: string;
  readonly help: string | null;
  /** 설치 안내 링크(엔진·CLI 문제일 때만) */
  readonly link: string | null;
}

export type DockerResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: DockerFailure };

export interface FailureFacts {
  /** 실행 파일을 못 찾으면 ENOENT */
  readonly spawnCode?: string | undefined;
  readonly timedOut?: boolean | undefined;
  readonly cancelled?: boolean | undefined;
  readonly tooLarge?: boolean | undefined;
  readonly stderr: string;
}

const firstLines = (text: string, n: number): string => text.trim().split(/\r?\n/).slice(0, n).join('\n');

/** docker 가 실패한 까닭을 가른다: CLI 없음 / 엔진 꺼짐 / 권한 없음 / 시간 초과 / 그 밖. 조용히 실패하지 않게 이유와 링크를 붙인다. */
export function classifyFailure(f: FailureFacts): DockerFailure {
  if (f.spawnCode === 'ENOENT') {
    return { kind: 'no-cli', title: 'docker CLI not found', message: 'The docker command is not installed or is not on your PATH.', help: 'Install Docker (or Colima, OrbStack, Podman with the docker CLI), then restart Rauha.', link: DOCKER_INSTALL_URL };
  }
  if (f.cancelled === true) return { kind: 'cancelled', title: 'Cancelled', message: 'The docker command was cancelled.', help: null, link: null };
  if (f.timedOut === true) return { kind: 'timeout', title: 'Docker did not answer in time', message: 'The docker command took too long and was stopped. The engine may be starting up or stuck.', help: 'Wait a moment and press Refresh.', link: null };
  if (f.tooLarge === true) return { kind: 'too-large', title: 'Output too large', message: 'The docker command printed more than the size limit, so it was stopped.', help: null, link: null };
  const err = f.stderr;
  if (/permission denied/i.test(err) && /(docker(\.sock)?|daemon|socket|pipe)/i.test(err)) {
    return { kind: 'permission', title: 'No permission to use Docker', message: firstLines(err, 3), help: 'Add your user to the docker group (Linux) or start Docker Desktop with your account, then press Refresh.', link: DOCKER_INSTALL_URL };
  }
  if (/(cannot connect to the docker daemon|is the docker daemon running|failed to connect to the docker api|error during connect|docker daemon is not running|connection refused|no such file or directory.*docker\.sock|dockerdesktoplinuxengine|The system cannot find the file specified)/i.test(err)) {
    return { kind: 'engine-off', title: 'Docker engine is not running', message: 'The docker CLI is installed, but it cannot reach an engine.', help: 'Start Docker Desktop, Colima, OrbStack or Podman, then press Refresh.', link: DOCKER_INSTALL_URL };
  }
  return { kind: 'failed', title: 'Docker command failed', message: firstLines(err, 6) || 'The docker command failed without a message.', help: null, link: null };
}

/** 입력 검사에서 걸린 값을 화면에 보일 실패로 */
export function inputFailure(e: DockerInputError): DockerFailure {
  return e.kind === 'confirm'
    ? { kind: 'confirm', title: 'Confirmation needed', message: e.message, help: null, link: null }
    : { kind: 'bad-input', title: 'That value cannot be used', message: e.message, help: null, link: null };
}

// ── 화면에 넘기는 값 ──

export interface DockerStatus {
  readonly ready: boolean;
  readonly clientVersion: string | null;
  readonly serverVersion: string | null;
  readonly failure: DockerFailure | null;
}

export interface ContainerList {
  readonly containers: readonly ContainerView[];
  readonly skipped: number;
}
export interface ImageList {
  readonly images: readonly ImageView[];
  readonly skipped: number;
}
export interface VolumeList {
  readonly volumes: readonly VolumeView[];
  readonly skipped: number;
}
export interface NetworkList {
  readonly networks: readonly NetworkView[];
  readonly skipped: number;
}

/** docker inspect 에서 보이는 것만 추린 상세. 환경 변수(비밀이 들 수 있다)는 가져오지 않는다. */
export interface ContainerDetail {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly command: string;
  readonly status: string;
  readonly startedAt: string;
  readonly restartCount: number;
  readonly health: string | null;
  readonly ports: readonly string[];
  readonly mounts: readonly string[];
  readonly networks: readonly string[];
}

export type DockerLogEvent =
  | { readonly type: 'out'; readonly streamId: string; readonly data: string }
  /** 끝났다(컨테이너가 멈췄거나 멈춘 것). note 는 크기 상한 같은 사유 */
  | { readonly type: 'end'; readonly streamId: string; readonly code: number | null; readonly note: string | null };

export interface ComposeFileView {
  /** 작업 폴더 기준 상대 경로(/ 로 구분) */
  readonly path: string;
  /** 보여 줄 폴더 이름 */
  readonly folder: string;
}

export type ComposeOp = 'up' | 'down' | 'ps' | 'logs';
export interface ComposeResult {
  readonly output: string;
  readonly services: readonly ComposeServiceView[];
}
export interface ExecResult {
  readonly output: string;
  readonly exitCode: number | null;
}

/** 화면이 쓰는 Docker API(preload 가 채널로 이어 준다) */
export interface DockerApi {
  status(): Promise<DockerStatus>;
  containers(): Promise<DockerResult<ContainerList>>;
  images(): Promise<DockerResult<ImageList>>;
  volumes(): Promise<DockerResult<VolumeList>>;
  networks(): Promise<DockerResult<NetworkList>>;
  start(id: string): Promise<DockerResult<null>>;
  stop(id: string): Promise<DockerResult<null>>;
  restart(id: string): Promise<DockerResult<null>>;
  remove(req: { readonly id: string; readonly force?: boolean; readonly confirm: boolean }): Promise<DockerResult<null>>;
  inspect(id: string): Promise<DockerResult<ContainerDetail>>;
  logs(req: { readonly id: string; readonly tail?: number; readonly follow?: boolean }): Promise<DockerResult<{ readonly streamId: string }>>;
  logsStop(streamId: string): Promise<void>;
  onLogEvent(listener: (event: DockerLogEvent) => void): void;
  composeFind(): Promise<DockerResult<readonly ComposeFileView[]>>;
  composeList(): Promise<DockerResult<readonly ComposeProjectView[]>>;
  compose(req: { readonly file: string; readonly op: ComposeOp; readonly removeVolumes?: boolean; readonly confirm?: boolean; readonly tail?: number }): Promise<DockerResult<ComposeResult>>;
  exec(req: { readonly id: string; readonly line: string }): Promise<DockerResult<ExecResult>>;
  imageRemove(req: { readonly ref: string; readonly confirm: boolean }): Promise<DockerResult<null>>;
  imagePull(req: { readonly ref: string }): Promise<DockerResult<{ readonly output: string }>>;
  volumeRemove(req: { readonly name: string; readonly confirm: boolean }): Promise<DockerResult<null>>;
  networkRemove(req: { readonly name: string; readonly confirm: boolean }): Promise<DockerResult<null>>;
}

// ── 바깥 입력 검증(DTO) ──

type Obj = Readonly<Record<string, unknown>>;
const obj = (raw: unknown): Obj => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DockerInputError('The request is not valid.');
  return raw as Obj;
};
const needConfirm = (o: Obj, what: string): void => {
  if (o['confirm'] !== true) throw new DockerInputError(`${what} needs confirmation. Nothing was changed.`, 'confirm');
};
const flag = (v: unknown): boolean => v === true;

const COMPOSE_FILE = /^(docker-compose|compose)(\.[A-Za-z0-9_-]+)?\.ya?ml$/;
/** compose 파일 이름인지(docker-compose.yml · compose.yaml · docker-compose.override.yml …) */
export function isComposeFileName(name: string): boolean {
  return COMPOSE_FILE.test(name);
}

/** 작업 폴더 기준 compose 파일 상대 경로 값 객체. 밖으로 나가는 경로·옵션처럼 읽히는 경로·compose 파일이 아닌 이름은 만들 수 없다. */
export class ComposeFile {
  private constructor(readonly path: string) {}
  static parse(input: unknown): ComposeFile {
    if (typeof input !== 'string' || input.trim() === '') throw new DockerInputError('The compose file is missing.');
    const v = input.replace(/\\/g, '/');
    const parts = v.split('/');
    const bad = v.startsWith('/') || v.startsWith('-') || /^[A-Za-z]:/.test(v) || v.includes('\0') || parts.some((p) => p === '' || p === '..' || p === '.');
    if (bad || !isComposeFileName(parts[parts.length - 1]!)) throw new DockerInputError(`That is not a compose file inside the work folder: ${v.slice(0, 80)}`);
    return new ComposeFile(v);
  }
}

/** 화면에서 온 요청을 검사해 값 객체로 바꾼다. 실패하면 DockerInputError(message 는 화면에 보인다). */
export const DockerRequest = {
  target(id: unknown): ContainerRef {
    return ContainerRef.parse(id);
  },
  remove(raw: unknown): { readonly ref: ContainerRef; readonly force: boolean } {
    const o = obj(raw);
    needConfirm(o, 'Removing a container');
    return { ref: ContainerRef.parse(o['id']), force: flag(o['force']) };
  },
  logs(raw: unknown): { readonly ref: ContainerRef; readonly tail: TailLines; readonly follow: boolean } {
    const o = obj(raw);
    return { ref: ContainerRef.parse(o['id']), tail: TailLines.parse(o['tail']), follow: flag(o['follow']) };
  },
  exec(raw: unknown): { readonly ref: ContainerRef; readonly line: ExecLine } {
    const o = obj(raw);
    return { ref: ContainerRef.parse(o['id']), line: ExecLine.parse(o['line']) };
  },
  compose(raw: unknown): { readonly file: ComposeFile; readonly op: ComposeOp; readonly removeVolumes: boolean; readonly tail: TailLines } {
    const o = obj(raw);
    const op = o['op'];
    if (op !== 'up' && op !== 'down' && op !== 'ps' && op !== 'logs') throw new DockerInputError('That compose action is not supported.');
    const removeVolumes = op === 'down' && flag(o['removeVolumes']);
    if (removeVolumes) needConfirm(o, 'Removing compose volumes (down -v)');
    else if (op === 'down') needConfirm(o, 'Stopping and removing a compose project (down)');
    return { file: ComposeFile.parse(o['file']), op, removeVolumes, tail: TailLines.parse(o['tail']) };
  },
  imageRemove(raw: unknown): ImageRef {
    const o = obj(raw);
    needConfirm(o, 'Removing an image');
    return ImageRef.parse(o['ref']);
  },
  imagePull(raw: unknown): ImageRef {
    return ImageRef.parse(obj(raw)['ref']);
  },
  volumeRemove(raw: unknown): VolumeName {
    const o = obj(raw);
    needConfirm(o, 'Removing a volume');
    return VolumeName.parse(o['name']);
  },
  networkRemove(raw: unknown): NetworkName {
    const o = obj(raw);
    needConfirm(o, 'Removing a network');
    return NetworkName.parse(o['name']);
  },
};
