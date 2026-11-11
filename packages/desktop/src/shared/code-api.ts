import type { ChangedFile, LineMark } from './code-changes.js';
import type { LineHit, SearchOptions } from './text-search.js';
import type { Eol } from './code-text.js';
import type { EditorConfigProps } from './indent.js';
import type { BlameView } from './git-blame.js';

/** 코드 탭 IPC 채널. 파일을 읽고 쓰는 일은 전부 main이 한다. 화면은 작업 폴더 기준 상대 경로만 보낸다. */
export const CODE_IPC = {
  tree: 'code:tree',
  read: 'code:read',
  write: 'code:write',
  stat: 'code:stat',
  changes: 'code:changes',
  diff: 'code:diff',
  blame: 'code:blame',
  search: 'code:search',
  searchCancel: 'code:search-cancel',
  files: 'code:files',
  create: 'code:create',
  rename: 'code:rename',
  trash: 'code:trash',
  duplicate: 'code:duplicate',
  move: 'code:move',
  inspect: 'code:inspect',
  reveal: 'code:reveal',
  image: 'code:image',
} as const;

/** 못 하는 까닭. 화면이 문장으로 바꿔 보인다(codeFailText). */
export type CodeFail = 'bad-path' | 'outside' | 'secret' | 'too-big' | 'binary' | 'encoding' | 'missing' | 'not-file' | 'not-dir' | 'conflict' | 'deleted' | 'read-only' | 'no-folder' | 'error'
  | 'bad-name' | 'exists' | 'protected' | 'too-long' | 'too-many' | 'link' | 'trash-failed' | 'same-folder' | 'into-self' | 'not-image' | 'image-too-big';

export interface TreeEntry {
  readonly name: string;
  /** 작업 폴더 기준 상대 경로(슬래시) */
  readonly path: string;
  readonly kind: 'dir' | 'file';
  /** 바로가기(심볼릭 링크)다 */
  readonly link: boolean;
  /** node_modules·dist 같은 생성물 폴더. 접어 두고 흐리게 보인다. */
  readonly heavy: boolean;
  /** 비밀 파일이라 열지 않는다 */
  readonly locked: boolean;
  /** 작업 폴더 밖을 가리키는 바로가기라 열지 않는다 */
  readonly blocked: boolean;
}

export type TreeResult = { readonly ok: true; readonly entries: readonly TreeEntry[]; readonly truncated: boolean } | { readonly ok: false; readonly reason: CodeFail };

export type ReadResult =
  | {
      readonly ok: true;
      readonly path: string;
      /** 줄 바꿈은 \n 하나로 맞춘 글 */
      readonly text: string;
      /** 디스크에서 바뀌었는지 비교하는 값(수정 시각 + 크기) */
      readonly version: string;
      readonly eol: Eol;
      readonly bom: boolean;
      readonly mixedEol: boolean;
      /** 이 파일에 적용되는 .editorconfig 값 */
      readonly editorConfig: EditorConfigProps;
      /** 파일에 쓰기 권한이 없다 */
      readonly readOnly: boolean;
    }
  | { readonly ok: false; readonly reason: CodeFail };

/** 이미지 뷰어용 읽기 결과. 그림은 작업 폴더 안 파일만, data: URL로 보낸다. */
export type ImageResult =
  | { readonly ok: true; readonly path: string; readonly mime: string; readonly bytes: number; readonly dataUrl: string }
  | { readonly ok: false; readonly reason: CodeFail };

export interface WriteRequest {
  readonly path: string;
  readonly text: string;
  readonly eol: Eol;
  readonly bom: boolean;
  /** 읽을 때 받은 version. 디스크가 이 값과 다르면 충돌이다. */
  readonly baseVersion: string;
  /** 사용자가 충돌을 알고도 덮어쓰기를 골랐다 */
  readonly overwrite: boolean;
}

export type WriteResult = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly reason: CodeFail; readonly detail?: string | undefined };

/** 열어 둔 파일들의 디스크 상태. 없으면 null. */
export type StatResult = Readonly<Record<string, string | null>>;

export interface CodeApi extends CodeApi2 {
  tree(path: string): Promise<TreeResult>;
  read(path: string): Promise<ReadResult>;
  /** 그림 파일을 data: URL로 읽는다(이미지 뷰어와 마크다운 미리보기) */
  readImage(path: string): Promise<ImageResult>;
  write(req: WriteRequest): Promise<WriteResult>;
  stat(paths: readonly string[]): Promise<StatResult>;
}

const FAIL_TEXT: Readonly<Record<CodeFail, string>> = {
  'bad-path': 'That path cannot be opened.',
  outside: 'Outside the work folder: not opened.',
  secret: 'Secret file: Rauha does not open it.',
  'too-big': 'Files over 1 MB are not opened.',
  binary: 'Not a text file: not opened.',
  encoding: 'Not UTF-8 text; characters could get garbled. Not opened.',
  missing: 'The file does not exist.',
  'not-file': 'Not a file.',
  'not-dir': 'Not a folder.',
  conflict: 'This file changed on disk.',
  deleted: 'This file was deleted on disk.',
  'read-only': 'No write permission for this file.',
  'no-folder': 'Pick a work folder first (Settings).',
  error: 'Could not handle the file.',
  'bad-name': 'That name cannot be used.',
  exists: 'The same name already exists, so nothing was done (nothing is overwritten).',
  protected: 'The work folder, repo roots, node_modules and .git are not changed here.',
  'too-long': 'The path is too long.',
  'too-many': 'Too many or too large files to duplicate.',
  link: 'Links are not duplicated.',
  'trash-failed': 'Could not move to the trash. The file is unchanged (nothing is deleted for good).',
  'same-folder': 'It is already in that folder.',
  'into-self': 'A folder cannot be moved into itself.',
  'not-image': 'Not an image file.',
  'image-too-big': 'Images over 5 MB are not opened.',
};

export const codeFailText = (reason: CodeFail): string => FAIL_TEXT[reason];

// ── 2단계: git 변경 표시 · 전체 찾기 · 빠른 열기 ──


/** 레포 한 개: 작업 폴더 기준 상대 경로('' = 작업 폴더 자신)와 절대 경로(git 탭으로 넘길 때 쓴다) */
export interface RepoInfo {
  readonly path: string;
  readonly root: string;
}

export type ChangesResult = { readonly ok: true; readonly files: readonly ChangedFile[]; readonly repos: readonly RepoInfo[] } | { readonly ok: false; readonly reason: CodeFail };

export type DiffResult = { readonly ok: true; readonly marks: readonly LineMark[] } | { readonly ok: false; readonly reason: CodeFail };

/** 한 파일의 줄별 작성자(git blame). view 가 null 이면 까닭(why)이 있다. root 는 그 파일이 든 레포 루트(git 탭으로 넘길 때 쓴다). */
export type BlameResult =
  | { readonly ok: true; readonly view: BlameView; readonly root: string }
  | { readonly ok: true; readonly view: null; readonly why: 'not-repo' | 'not-tracked' | 'too-big' | 'failed' }
  | { readonly ok: false; readonly reason: CodeFail };

export interface SearchFileHits {
  readonly path: string;
  readonly hits: readonly LineHit[];
}

export type SearchResult =
  | { readonly ok: true; readonly files: readonly SearchFileHits[]; readonly truncated: boolean; readonly scanned: number; readonly skipped: number; readonly stopped: SearchStop | null }
  | { readonly ok: false; readonly reason: CodeFail | 'empty' | 'bad-regex' | 'bad-glob' };

/** 검색이 끝까지 가지 못한 까닭: 결과 상한 · 시간 상한 · 사용자가 멈춤 · 정규식이 멈춰 있어 끊음 */
export type SearchStop = 'limit' | 'timeout' | 'cancelled' | 'stalled';

export type FilesResult = { readonly ok: true; readonly paths: readonly string[]; readonly truncated: boolean } | { readonly ok: false; readonly reason: CodeFail };

export type { SearchOptions };

// ── 3단계: 파일 조작(새로 만들기·이름 바꾸기·복제·옮기기·휴지통·경로) ──
// 화면은 작업 폴더 기준 상대 경로만 보내고, 실제 조작과 안전 검사는 전부 main이 한다.

export type NodeKind = 'file' | 'dir';

export interface CreateRequest {
  /** 만들 곳 폴더(''= 작업 폴더) */
  readonly parent: string;
  readonly name: string;
  readonly kind: NodeKind;
}
export interface RenameRequest {
  readonly path: string;
  readonly name: string;
}
export interface PathRequest {
  readonly path: string;
}
export interface DuplicateRequest {
  readonly path: string;
  /** 붙여넣을 폴더. 없으면 같은 폴더에 "이름 복사본" */
  readonly destDir?: string | undefined;
}
export interface MoveRequest {
  readonly path: string;
  readonly destDir: string;
}

/** 조작 결과. 성공하면 새 경로(이름 바꾸기·옮기기·복제·새로 만들기), 휴지통은 지운 경로. */
export type OpResult =
  | { readonly ok: true; readonly path: string; readonly kind: NodeKind }
  | { readonly ok: false; readonly reason: CodeFail; readonly detail?: string | undefined };

export type InspectResult =
  | {
      readonly ok: true;
      readonly kind: NodeKind;
      /** 폴더 안 파일 수(바로가기는 세지 않는다). 너무 많으면 capped */
      readonly files: number;
      readonly capped: boolean;
      readonly link: boolean;
      readonly secret: boolean;
      /** 작업 폴더·레포 루트·조작 금지 구역이라 이름 바꾸기·삭제·옮기기를 막는다 */
      readonly locked: boolean;
    }
  | { readonly ok: false; readonly reason: CodeFail };

export interface CodeApi3 {
  create(req: CreateRequest): Promise<OpResult>;
  rename(req: RenameRequest): Promise<OpResult>;
  /** 영구 삭제가 아니라 휴지통으로 보낸다. 휴지통이 안 되면 지우지 않고 까닭을 알린다. */
  trash(req: PathRequest): Promise<OpResult>;
  duplicate(req: DuplicateRequest): Promise<OpResult>;
  move(req: MoveRequest): Promise<OpResult>;
  inspect(req: PathRequest): Promise<InspectResult>;
  /** 파일 관리자(탐색기·Finder)에서 보여 준다 */
  reveal(req: PathRequest): Promise<{ readonly ok: boolean }>;
}

export interface CodeApi2 extends CodeApi3 {
  /** 작업 폴더 아래 레포들의 바뀐 파일(작업 폴더 기준 경로) */
  changes(): Promise<ChangesResult>;
  /** 한 파일의 저장된 내용이 HEAD와 다른 줄 */
  diff(path: string): Promise<DiffResult>;
  /** 한 파일의 줄별 작성자·날짜·커밋(읽기 전용) */
  blame(path: string): Promise<BlameResult>;
  search(options: SearchOptions): Promise<SearchResult>;
  /** 돌고 있는 전체 찾기를 id 로 멈춘다 */
  cancelSearch(id: string): Promise<void>;
  files(): Promise<FilesResult>;
}
