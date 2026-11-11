/** 화면·IPC에서 온 값이 docker 인자로 안전하지 않을 때 던진다. message는 사용자에게 그대로 보인다. */
export class DockerInputError extends Error {
  constructor(
    message: string,
    /** confirm: 위험 동작인데 확인 표시가 없다 */
    readonly kind: 'bad-input' | 'confirm' = 'bad-input',
  ) {
    super(message);
    this.name = 'DockerInputError';
  }
}

const NAME_MAX = 128;
const IMAGE_MAX = 255;
/** 컨테이너·볼륨·네트워크 이름(과 ID)에 허용하는 글자. 앞은 영문·숫자라 옵션(-)처럼 읽힐 수 없다. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** 이미지 이름: 레지스트리 주소(host:5000/)·경로·태그(:)·다이제스트(@sha256:…) */
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9_.\-/:@]*$/;

function text(input: unknown, what: string): string {
  if (typeof input !== 'string') throw new DockerInputError(`The ${what} is missing.`);
  const v = input.trim();
  if (v === '') throw new DockerInputError(`The ${what} is empty.`);
  if (v.startsWith('-')) throw new DockerInputError(`The ${what} cannot start with "-": ${v.slice(0, 40)}`);
  return v;
}

function simpleName(input: unknown, what: string): string {
  const v = text(input, what);
  if (v.length > NAME_MAX) throw new DockerInputError(`The ${what} is too long (up to ${NAME_MAX} characters).`);
  if (!NAME.test(v)) throw new DockerInputError(`The ${what} has a character that is not allowed: ${v.slice(0, 40)}`);
  return v;
}

/** 컨테이너 이름 또는 ID 값 객체 */
export class ContainerRef {
  private constructor(readonly value: string) {}
  static parse(input: unknown): ContainerRef {
    return new ContainerRef(simpleName(input, 'container name or ID'));
  }
}

/** 볼륨 이름 값 객체 */
export class VolumeName {
  private constructor(readonly value: string) {}
  static parse(input: unknown): VolumeName {
    return new VolumeName(simpleName(input, 'volume name'));
  }
}

/** 네트워크 이름 또는 ID 값 객체 */
export class NetworkName {
  private constructor(readonly value: string) {}
  static parse(input: unknown): NetworkName {
    return new NetworkName(simpleName(input, 'network name'));
  }
}

/** 이미지 이름(repo:tag, 레지스트리 주소, @digest) 또는 ID 값 객체 */
export class ImageRef {
  private constructor(readonly value: string) {}
  static parse(input: unknown): ImageRef {
    const v = text(input, 'image name');
    if (v.length > IMAGE_MAX) throw new DockerInputError(`The image name is too long (up to ${IMAGE_MAX} characters).`);
    if (!IMAGE.test(v) || v.includes('//') || v.includes('..') || v.endsWith('/')) throw new DockerInputError(`That image name cannot be used: ${v.slice(0, 60)}`);
    return new ImageRef(v);
  }
}

const LINE_MAX = 4000;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 컨테이너 안에서 실행할 한 줄 명령 값 객체. 줄바꿈·제어 문자는 받지 않는다. */
export class ExecLine {
  private constructor(readonly value: string) {}
  static parse(input: unknown): ExecLine {
    if (typeof input !== 'string') throw new DockerInputError('The command is missing.');
    const v = input.trim();
    if (v === '') throw new DockerInputError('The command is empty.');
    if (v.length > LINE_MAX) throw new DockerInputError(`The command is too long (up to ${LINE_MAX} characters).`);
    if (CONTROL.test(v)) throw new DockerInputError('The command has a character that is not allowed. Use one line.');
    return new ExecLine(v);
  }
}

/** 로그에서 가져올 마지막 줄 수. 정수 1..5000, 기본 200 */
export class TailLines {
  private constructor(readonly value: number) {}
  static parse(input: unknown): TailLines {
    if (input === undefined) return new TailLines(200);
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > 5000) throw new DockerInputError('The number of log lines must be between 1 and 5000.');
    return new TailLines(input);
  }
}
