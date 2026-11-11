/** 터미널 IPC 채널. 진짜 PTY(의사 터미널) 하나가 터미널 탭 하나다. 셸은 main이 정하고, 출력은 main → 화면 한 채널(term:event)로 흘려 보낸다. */
export const TERM_IPC = {
  roots: 'term:roots',
  open: 'term:open',
  write: 'term:write',
  resize: 'term:resize',
  ack: 'term:ack',
  close: 'term:close',
  closeAll: 'term:close-all',
  event: 'term:event',
} as const;

/** 한 번에 write 로 보낼 수 있는 글자 수(더 긴 붙여넣기는 화면이 나눠 보낸다) */
export const MAX_WRITE_CHARS = 64 * 1024;

/** 새 터미널을 시작할 수 있는 폴더: 작업 폴더와 그 아래 레포들 */
export interface TermRoot {
  /** 작업 폴더 기준 상대 경로('' = 작업 폴더) */
  readonly path: string;
  readonly label: string;
}

export interface OpenRequest {
  readonly rootPath: string;
  readonly cols: number;
  readonly rows: number;
}

export type OpenResult =
  | { readonly ok: true; readonly id: string; readonly shell: string; readonly cwd: string }
  | { readonly ok: false; readonly message: string };

export type TermEvent =
  | { readonly type: 'data'; readonly id: string; readonly data: string }
  | { readonly type: 'exit'; readonly id: string; readonly code: number | null };

export interface TerminalApi {
  roots(): Promise<readonly TermRoot[]>;
  /** 작업 폴더나 그 아래 레포에서 새 터미널을 연다. 어떤 셸을 쓸지는 main이 정한다. */
  open(req: OpenRequest): Promise<OpenResult>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  /** 화면이 n 글자를 그렸다(흐름 제어) */
  ack(id: string, n: number): Promise<void>;
  /** 터미널을 닫는다(돌고 있는 프로세스 트리도 끝낸다) */
  close(id: string): Promise<void>;
  /** 열려 있는 터미널을 모두 닫는다(작업 폴더가 바뀌거나 화면이 다시 열릴 때) */
  closeAll(): Promise<void>;
  onEvent(listener: (event: TermEvent) => void): void;
}
