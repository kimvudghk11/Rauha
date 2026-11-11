/** 화면·IPC에서 온 값이 DB 탭 규칙에 맞지 않을 때 던진다. message 는 사용자에게 그대로 보인다. */
export class DbInputError extends Error {
  constructor(
    message: string,
    /** confirm: 위험 동작인데 확인 표시가 없다 · write-mode: 쓰기 모드가 꺼져 있다 · blocked: 막아 둔 문장 */
    readonly kind: 'bad-input' | 'confirm' | 'write-mode' | 'blocked' = 'bad-input',
  ) {
    super(message);
    this.name = 'DbInputError';
  }
}

const PATH_MAX = 1024;
const NAME_MAX = 255;
const PAGE_MAX = 1_000_000;
/* eslint-disable-next-line no-control-regex */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 파일 경로 값 객체(순수 규칙). 절대 경로만, 네트워크·장치·확장 경로와 .. 조각은 만들 수 없다. 파일이 진짜 SQLite 인지는 main 이 연다. */
export class DbFilePath {
  private constructor(readonly value: string) {}
  static parse(input: unknown): DbFilePath {
    if (typeof input !== 'string') throw new DbInputError('The file path is missing.');
    const v = input.trim();
    if (v === '') throw new DbInputError('The file path is empty.');
    if (v.length > PATH_MAX) throw new DbInputError(`The file path is too long (up to ${PATH_MAX} characters).`);
    if (CONTROL.test(v)) throw new DbInputError('The file path has a control character.');
    if (v.startsWith('-')) throw new DbInputError('The file path cannot start with "-".');
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v)) throw new DbInputError('Only a local file path can be opened here (not a URL or connection string).');
    if (/^[\\/]{2}/.test(v)) throw new DbInputError('Network and device paths (\\\\server, //server, \\\\?\\) cannot be opened.');
    const drive = /^[A-Za-z]:[\\/]/.test(v);
    if (!drive && !v.startsWith('/')) throw new DbInputError('Use the full path of the file (starting with a drive letter or /).');
    const rest = drive ? v.slice(3) : v.slice(1);
    const parts = rest.split(/[\\/]/);
    if (parts.some((p) => p === '..' || p === '.')) throw new DbInputError('The file path cannot contain "." or ".." parts.');
    const last = parts[parts.length - 1] ?? '';
    if (last === '') throw new DbInputError('That path is a folder, not a file.');
    return new DbFilePath(v);
  }
  /** 화면에 보일 이름(파일 이름만) */
  fileName(): string {
    return this.value.split(/[\\/]/).pop() ?? this.value;
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** 저장된 연결을 가리키는 id. 화면은 경로가 아니라 이 id 로만 연결을 고른다. */
export class ConnectionId {
  private constructor(readonly value: string) {}
  static parse(input: unknown): ConnectionId {
    if (typeof input !== 'string' || !ID.test(input)) throw new DbInputError('That connection id is not valid.');
    return new ConnectionId(input);
  }
}

function identifier(input: unknown, what: string): string {
  if (typeof input !== 'string') throw new DbInputError(`The ${what} is missing.`);
  if (input.trim() === '') throw new DbInputError(`The ${what} is empty.`);
  if (input.length > NAME_MAX) throw new DbInputError(`The ${what} is too long (up to ${NAME_MAX} characters).`);
  if (input.includes('\0')) throw new DbInputError(`The ${what} has a NUL character.`);
  return input;
}

/** 테이블·뷰 이름. SQLite 는 거의 모든 글자를 이름에 쓸 수 있으니 글자는 막지 않고, 쓸 때 반드시 quoteIdent 를 거친다(main 은 스키마에 있는 이름인지도 다시 본다). */
export class TableName {
  private constructor(readonly value: string) {}
  static parse(input: unknown): TableName {
    return new TableName(identifier(input, 'table name'));
  }
}
/** 열 이름(정렬용) */
export class ColumnName {
  private constructor(readonly value: string) {}
  static parse(input: unknown): ColumnName {
    return new ColumnName(identifier(input, 'column name'));
  }
}

/** SQL 식별자 인용: 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. 이름을 SQL 에 끼워 넣는 유일한 길. */
export function quoteIdent(name: string): string {
  if (name.includes('\0')) throw new DbInputError('The name has a NUL character.');
  return `"${name.replace(/"/g, '""')}"`;
}

/** 쪽 번호(0부터) */
export class PageNumber {
  private constructor(readonly value: number) {}
  static parse(input: unknown): PageNumber {
    if (input === undefined || input === null) return new PageNumber(0);
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > PAGE_MAX) throw new DbInputError('The page number is not valid.');
    return new PageNumber(input);
  }
}

/** 정렬: 열 이름 + 방향 */
export class SortSpec {
  private constructor(
    readonly column: string,
    readonly dir: 'asc' | 'desc',
  ) {}
  static parse(input: unknown): SortSpec | null {
    if (input === undefined || input === null) return null;
    if (typeof input !== 'object' || Array.isArray(input)) throw new DbInputError('The sort is not valid.');
    const o = input as Readonly<Record<string, unknown>>;
    const dir = o['dir'];
    if (dir !== 'asc' && dir !== 'desc') throw new DbInputError('The sort direction must be asc or desc.');
    return new SortSpec(ColumnName.parse(o['column']).value, dir);
  }
}
