import type { Eol } from './code-text.js';
import type { EditorConfigProps } from './indent.js';

/** 코드 탭 IPC 채널. 파일을 읽고 쓰는 일은 전부 main이 한다. 화면은 작업 폴더 기준 상대 경로만 보낸다. */
export const CODE_IPC = {
  tree: 'code:tree',
  read: 'code:read',
  write: 'code:write',
  stat: 'code:stat',
} as const;

/** 못 하는 까닭. 화면이 문장으로 바꿔 보인다(codeFailText). */
export type CodeFail = 'bad-path' | 'outside' | 'secret' | 'too-big' | 'binary' | 'encoding' | 'missing' | 'not-file' | 'not-dir' | 'conflict' | 'deleted' | 'read-only' | 'no-folder' | 'error';

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

export interface CodeApi {
  tree(path: string): Promise<TreeResult>;
  read(path: string): Promise<ReadResult>;
  write(req: WriteRequest): Promise<WriteResult>;
  stat(paths: readonly string[]): Promise<StatResult>;
}

const FAIL_TEXT: Readonly<Record<CodeFail, string>> = {
  'bad-path': '열 수 없는 경로예요.',
  outside: '작업 폴더 밖이라 열지 않아요.',
  secret: '비밀 파일이라 rauha가 열지 않아요.',
  'too-big': '1MB를 넘는 파일은 열지 않아요.',
  binary: '글 파일이 아니라서 열지 않아요.',
  encoding: 'UTF-8이 아닌 글이라 열면 글자가 깨질 수 있어요. 열지 않아요.',
  missing: '파일이 없어요.',
  'not-file': '파일이 아니에요.',
  'not-dir': '폴더가 아니에요.',
  conflict: '디스크에서 이 파일이 바뀌었어요.',
  deleted: '디스크에서 이 파일이 지워졌어요.',
  'read-only': '쓰기 권한이 없는 파일이에요.',
  'no-folder': '작업 폴더를 먼저 골라 주세요(설정).',
  error: '파일을 다루지 못했어요.',
};

export const codeFailText = (reason: CodeFail): string => FAIL_TEXT[reason];
