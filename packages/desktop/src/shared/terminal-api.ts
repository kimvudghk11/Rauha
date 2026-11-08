/** 터미널 IPC 채널. 명령은 main이 셸로 돌리고, 출력은 main → 화면 한 채널(term:event)로 흘려 보낸다. */
export const TERM_IPC = {
  roots: 'term:roots',
  open: 'term:open',
  run: 'term:run',
  stop: 'term:stop',
  close: 'term:close',
  event: 'term:event',
} as const;

/** 새 터미널을 시작할 수 있는 폴더: 작업 폴더와 그 아래 레포들 */
export interface TermRoot {
  /** 작업 폴더 기준 상대 경로('' = 작업 폴더) */
  readonly path: string;
  readonly label: string;
}

export type OpenResult = { readonly ok: true; readonly id: string; readonly cwd: string; readonly shell: string } | { readonly ok: false; readonly message: string };

export type RunFail = 'unknown' | 'busy' | 'blocked' | 'bad-dir' | 'error';
export type RunResult = { readonly ok: true } | { readonly ok: false; readonly reason: RunFail; readonly message: string };

export type TermEvent =
  | { readonly type: 'start'; readonly id: string }
  | { readonly type: 'out'; readonly id: string; readonly data: string }
  /** 명령이 끝났다. cwd는 보여 줄 현재 폴더(작업 폴더 안이면 상대 경로). */
  | { readonly type: 'exit'; readonly id: string; readonly code: number | null; readonly cwd: string; readonly note: string | null };

export interface TerminalApi {
  roots(): Promise<readonly TermRoot[]>;
  open(rootPath: string): Promise<OpenResult>;
  /** 한 줄을 실행한다. 이미 돌고 있으면 그 명령의 입력으로 들어간다. */
  run(id: string, line: string): Promise<RunResult>;
  /** 돌고 있는 명령을 멈춘다 */
  stop(id: string): Promise<void>;
  /** 터미널을 닫는다(돌고 있으면 멈춘다) */
  close(id: string): Promise<void>;
  onEvent(listener: (event: TermEvent) => void): void;
}

/** 화면에 한 줄로 보이는 한계 안내 */
export const TERMINAL_LIMIT_NOTE = '진짜 터미널(PTY)이 아니라서 vim·top·ssh 비밀번호 같은 대화형 프로그램은 안 돼요. 명령 하나마다 새 셸을 띄워요.';
